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
  v_first_occurrence_date date;
  v_occurrence_starts_at timestamptz;
  v_occurrence_ends_at timestamptz;
  v_restored_session_id uuid;
  v_has_existing_rule boolean := false;
  v_materialize_from timestamptz;
  v_materialize_to timestamptz;
  v_created_sessions integer := 0;
  v_warning text := null;
  v_existing_rule_label text := null;
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

  v_first_occurrence_date :=
    v_valid_from + ((p_weekday - extract(dow from v_valid_from)::int + 7) % 7);

  v_occurrence_starts_at :=
    ((v_first_occurrence_date + p_start_time) at time zone 'America/Argentina/Buenos_Aires');
  v_occurrence_ends_at :=
    ((v_first_occurrence_date + p_end_time) at time zone 'America/Argentina/Buenos_Aires');

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

  if v_has_existing_rule and v_first_occurrence_date < v_existing_rule.valid_from then
    v_valid_until := v_existing_rule.valid_from - 1;
    v_has_existing_rule := false;
    v_warning := format(
      'Ya habia un horario recurrente activo desde %s. Se creo este horario solo hasta %s para no duplicar la serie futura.',
      v_existing_rule.valid_from,
      v_valid_until
    );
  end if;

  if v_has_existing_rule then
    select * into v_exception
    from public.class_recurring_rule_exceptions cre
    where cre.recurring_rule_id = v_existing_rule.id
      and cre.occurrence_starts_at = v_occurrence_starts_at
      and cre.occurrence_ends_at = v_occurrence_ends_at
      and cre.action = 'cancelled'
    for update;

    if found then
      update public.class_sessions s
      set
        activity_id = v_existing_rule.activity_id,
        title = v_existing_rule.title,
        starts_at = v_occurrence_starts_at,
        ends_at = v_occurrence_ends_at,
        capacity = v_existing_rule.capacity,
        trainer_name = v_existing_rule.trainer_name,
        notes = v_existing_rule.notes,
        active = true,
        cancelled_at = null,
        cancelled_by = null,
        cancel_reason = null,
        recurring_rule_id = v_existing_rule.id,
        updated_at = now()
      where s.id = (
        select candidate.id
        from public.class_sessions candidate
        where candidate.recurring_rule_id = v_existing_rule.id
          and candidate.starts_at = v_occurrence_starts_at
          and candidate.ends_at = v_occurrence_ends_at
        order by
          (candidate.active is true and candidate.cancelled_at is null) desc,
          candidate.updated_at desc,
          candidate.created_at desc
        limit 1
      )
      returning s.id into v_restored_session_id;

      if v_restored_session_id is null then
        insert into public.class_sessions (
          activity_id,
          title,
          starts_at,
          ends_at,
          capacity,
          trainer_name,
          notes,
          active,
          recurring_rule_id
        )
        values (
          v_existing_rule.activity_id,
          v_existing_rule.title,
          v_occurrence_starts_at,
          v_occurrence_ends_at,
          v_existing_rule.capacity,
          v_existing_rule.trainer_name,
          v_existing_rule.notes,
          true,
          v_existing_rule.id
        )
        returning id into v_restored_session_id;
      end if;

      if v_restored_session_id is null then
        raise exception 'No se pudo restaurar la clase cancelada.';
      end if;

      update public.class_recurring_rule_exceptions cre
      set action = 'edited',
          class_session_id = v_restored_session_id,
          created_by = v_actor
      where cre.id = v_exception.id;

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
          'restored_exception_id', v_exception.id
        )
      );

      return jsonb_build_object(
        'ok', true,
        'action', 'restored_occurrence',
        'message', 'Clase restaurada correctamente.',
        'rule_id', v_existing_rule.id,
        'session_id', v_restored_session_id,
        'affected_sessions', 1
      );
    end if;

    v_existing_rule_label := format(
      'Regla %s, %s de %s a %s, vigente desde %s%s.',
      left(v_existing_rule.id::text, 8),
      case v_existing_rule.weekday
        when 0 then 'domingo'
        when 1 then 'lunes'
        when 2 then 'martes'
        when 3 then 'miercoles'
        when 4 then 'jueves'
        when 5 then 'viernes'
        when 6 then 'sabado'
      end,
      v_existing_rule.start_time,
      v_existing_rule.end_time,
      v_existing_rule.valid_from,
      case
        when v_existing_rule.valid_until is null then ' sin fecha de fin'
        else format(' hasta %s', v_existing_rule.valid_until)
      end
    );

    raise exception
      'Ya existe un horario recurrente activo para ese tipo, dia y horario. %. Si no se ve en esta fecha, la ocurrencia puntual puede estar cancelada: elegi esa fecha como inicio para restaurarla o pausa el horario existente antes de crear otro.',
      v_existing_rule_label;
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
  do nothing
  returning * into v_rule;

  if v_rule.id is null then
    raise exception 'Ya existe un horario recurrente activo para ese tipo, dia y horario. Pausa el anterior antes de crear otro.';
  end if;

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
      'valid_until', v_rule.valid_until,
      'warning', v_warning
    )
  );

  v_materialize_from :=
    (v_valid_from::timestamp at time zone 'America/Argentina/Buenos_Aires');
  v_materialize_to :=
    ((v_valid_from + 60)::timestamp at time zone 'America/Argentina/Buenos_Aires');

  v_created_sessions := private.materialize_recurring_class_sessions(
    v_materialize_from,
    v_materialize_to
  );

  return jsonb_build_object(
    'ok', true,
    'action', 'created',
    'message', 'Horario recurrente creado. Se materializaron las proximas semanas visibles del calendario.',
    'warning', v_warning,
    'rule_id', v_rule.id,
    'valid_until', v_rule.valid_until,
    'affected_sessions', v_created_sessions,
    'created_sessions', v_created_sessions
  );
end;
$$;

revoke all on function public.admin_create_class_recurring_rule(
  uuid,
  text,
  int,
  time,
  time,
  int,
  text,
  text,
  date,
  date
) from public, anon;

grant execute on function public.admin_create_class_recurring_rule(
  uuid,
  text,
  int,
  time,
  time,
  int,
  text,
  text,
  date,
  date
) to authenticated;