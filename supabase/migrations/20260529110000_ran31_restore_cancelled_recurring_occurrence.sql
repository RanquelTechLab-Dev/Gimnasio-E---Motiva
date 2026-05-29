create or replace function public.admin_create_class_recurring_rule(
  p_activity_id uuid,
  p_title text,
  p_weekday int,
  p_start_time time,
  p_end_time time,
  p_capacity int,
  p_trainer_name text default null,
  p_notes text default null,
  p_valid_from date default null,
  p_valid_until date default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_actor uuid := auth.uid();
  v_activity public.activities%rowtype;
  v_rule public.class_recurring_rules%rowtype;
  v_existing_rule public.class_recurring_rules%rowtype;
  v_exception public.class_recurring_rule_exceptions%rowtype;
  v_valid_from date := coalesce(p_valid_from, current_date);
  v_valid_until date := p_valid_until;
  v_occurrence_starts_at timestamptz;
  v_occurrence_ends_at timestamptz;
  v_restored_session_id uuid;
  v_has_existing_rule boolean := false;
begin
  if v_actor is null or not private.is_admin() then
    raise exception 'Solo un admin activo puede crear horarios recurrentes.';
  end if;

  select * into v_activity
  from public.activities a
  where a.id = p_activity_id
    and a.active = true;

  if not found then
    raise exception 'El tipo de clase no esta activo.';
  end if;

  if nullif(btrim(coalesce(p_title, '')), '') is null then
    raise exception 'El titulo es obligatorio.';
  end if;

  if p_weekday is null or p_weekday < 0 or p_weekday > 6 then
    raise exception 'El dia de semana no es valido.';
  end if;

  if p_end_time <= p_start_time then
    raise exception 'La hora de fin debe ser posterior a la hora de inicio.';
  end if;

  if v_valid_until is not null and v_valid_until < v_valid_from then
    raise exception 'La fecha final debe ser posterior o igual a la fecha inicial.';
  end if;

  if p_capacity is null or p_capacity <= 0 then
    raise exception 'El cupo debe ser mayor a cero.';
  end if;

  if v_activity.slug = 'personalizado_1_1' and p_capacity > 1 then
    raise exception 'Personalizado 1:1 permite maximo 1 alumno.';
  end if;

  v_occurrence_starts_at :=
    ((v_valid_from + p_start_time) at time zone 'America/Argentina/Buenos_Aires');
  v_occurrence_ends_at :=
    ((v_valid_from + p_end_time) at time zone 'America/Argentina/Buenos_Aires');

  select * into v_existing_rule
  from public.class_recurring_rules r
  where r.active = true
    and r.activity_id = p_activity_id
    and r.weekday = p_weekday
    and r.start_time = p_start_time
    and r.end_time = p_end_time
    and r.valid_from <= coalesce(v_valid_until, date '9999-12-31')
    and v_valid_from <= coalesce(r.valid_until, date '9999-12-31')
  order by (
      r.valid_from = v_valid_from
      and coalesce(r.valid_until, date '9999-12-31') =
        coalesce(v_valid_until, date '9999-12-31')
    ) desc,
    r.valid_from desc,
    r.created_at desc
  limit 1;

  v_has_existing_rule := found;

  if v_has_existing_rule then
    select * into v_exception
    from public.class_recurring_rule_exceptions cre
    where cre.recurring_rule_id = v_existing_rule.id
      and cre.occurrence_starts_at = v_occurrence_starts_at
      and cre.occurrence_ends_at = v_occurrence_ends_at
      and cre.action = 'cancelled'
    for update;

    if found then
      delete from public.class_recurring_rule_exceptions cre
      where cre.id = v_exception.id;

      perform private.materialize_recurring_class_sessions(
        v_occurrence_starts_at,
        v_occurrence_ends_at
      );

      select s.id into v_restored_session_id
      from public.class_sessions s
      where s.recurring_rule_id = v_existing_rule.id
        and s.starts_at = v_occurrence_starts_at
        and s.ends_at = v_occurrence_ends_at
      order by s.created_at desc
      limit 1;

      if v_restored_session_id is null then
        raise exception 'No se pudo restaurar la clase cancelada.';
      end if;

      insert into public.audit_logs (actor_id, entity_type, entity_id, action, metadata)
      values (
        v_actor,
        'class_session',
        v_restored_session_id,
        'class.restored_cancelled_occurrence',
        jsonb_build_object(
          'rule_id', v_existing_rule.id,
          'activity_id', v_existing_rule.activity_id,
          'starts_at', v_occurrence_starts_at,
          'ends_at', v_occurrence_ends_at,
          'removed_exception_id', v_exception.id
        )
      );

      return jsonb_build_object(
        'action', 'restored',
        'rule_id', v_existing_rule.id,
        'session_id', v_restored_session_id
      );
    end if;

    if v_existing_rule.valid_from is distinct from v_valid_from
      or coalesce(v_existing_rule.valid_until, date '9999-12-31') is distinct from
        coalesce(v_valid_until, date '9999-12-31')
    then
      raise exception 'Ya existe un horario recurrente activo para ese tipo, dia y horario. Pausa el anterior antes de crear otro.';
    end if;
  end if;

  insert into public.class_recurring_rules (
    activity_id,
    title,
    weekday,
    start_time,
    end_time,
    capacity,
    trainer_name,
    notes,
    active,
    valid_from,
    valid_until,
    created_by
  )
  values (
    p_activity_id,
    btrim(p_title),
    p_weekday,
    p_start_time,
    p_end_time,
    p_capacity,
    nullif(btrim(coalesce(p_trainer_name, '')), ''),
    nullif(btrim(coalesce(p_notes, '')), ''),
    true,
    v_valid_from,
    v_valid_until,
    v_actor
  )
  on conflict (
    activity_id,
    weekday,
    start_time,
    end_time,
    valid_from,
    (coalesce(valid_until, date '9999-12-31'))
  )
  where active = true
  do update set
    title = excluded.title,
    capacity = excluded.capacity,
    trainer_name = excluded.trainer_name,
    notes = excluded.notes,
    updated_at = now()
  returning * into v_rule;

  insert into public.audit_logs (actor_id, entity_type, entity_id, action, metadata)
  values (
    v_actor,
    'class_recurring_rule',
    v_rule.id,
    'class_recurring_rule.upserted',
    jsonb_build_object(
      'activity_id', v_rule.activity_id,
      'weekday', v_rule.weekday,
      'start_time', v_rule.start_time,
      'end_time', v_rule.end_time,
      'valid_from', v_rule.valid_from,
      'valid_until', v_rule.valid_until
    )
  );

  perform private.materialize_recurring_class_sessions(
    (coalesce(p_valid_from, current_date)::timestamp at time zone 'America/Argentina/Buenos_Aires'),
    ((coalesce(p_valid_from, current_date) + interval '14 days')::timestamp at time zone 'America/Argentina/Buenos_Aires')
  );

  return jsonb_build_object('action', 'created', 'rule_id', v_rule.id);
end;
$$;

revoke all on function public.admin_create_class_recurring_rule(uuid, text, int, time, time, int, text, text, date, date) from public, anon;
grant execute on function public.admin_create_class_recurring_rule(uuid, text, int, time, time, int, text, text, date, date) to authenticated;
