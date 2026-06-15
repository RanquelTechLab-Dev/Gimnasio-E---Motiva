create or replace function public.admin_update_class_recurring_rule_from_session(
  p_session_id uuid,
  p_activity_id uuid,
  p_title text,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_capacity integer,
  p_trainer_name text default null,
  p_notes text default null,
  p_active boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'private'
as $function$
declare
  v_actor uuid := auth.uid();
  v_session public.class_sessions%rowtype;
  v_rule public.class_recurring_rules%rowtype;
  v_activity public.activities%rowtype;
  v_conflict_rule public.class_recurring_rules%rowtype;
  v_new_rule public.class_recurring_rules%rowtype;
  v_new_title text;
  v_original_weekday int;
  v_new_weekday int;
  v_new_start_time time;
  v_new_end_time time;
  v_new_valid_from date;
  v_structural_change boolean;
  v_consuming_bookings integer := 0;
  v_selected_history_count integer := 0;
  v_future_history_count integer := 0;
  v_max_future_consuming_bookings integer := 0;
  v_deleted_sessions integer := 0;
  v_cancelled_sessions integer := 0;
  v_previous jsonb;
begin
  if v_actor is null or not private.is_admin() then
    raise exception 'Solo un admin activo puede editar horarios recurrentes.';
  end if;

  select *
  into v_session
  from public.class_sessions s
  where s.id = p_session_id
  for update;

  if not found then
    raise exception 'La clase no existe.';
  end if;

  if v_session.recurring_rule_id is null then
    raise exception 'La clase seleccionada no pertenece a un horario recurrente.';
  end if;

  if v_session.cancelled_at is not null then
    raise exception 'No se puede editar un horario recurrente desde una clase cancelada.';
  end if;

  select *
  into v_rule
  from public.class_recurring_rules r
  where r.id = v_session.recurring_rule_id
  for update;

  if not found then
    raise exception 'La regla recurrente no existe.';
  end if;

  if p_starts_at is null or p_ends_at is null or p_ends_at <= p_starts_at then
    raise exception 'El horario de la clase no es valido.';
  end if;

  if p_capacity is null or p_capacity <= 0 then
    raise exception 'El cupo debe ser mayor a cero.';
  end if;

  select *
  into v_activity
  from public.activities a
  where a.id = p_activity_id
    and a.active = true;

  if not found then
    raise exception 'La actividad no existe o esta inactiva.';
  end if;

  if v_activity.slug = 'personalizado_1_1' and p_capacity > 1 then
    raise exception 'Personalizado 1:1 permite maximo 1 alumno.';
  end if;

  select count(*)::int
  into v_consuming_bookings
  from public.bookings b
  where b.session_id = p_session_id
    and b.status in ('booked', 'attended', 'no_show');

  if p_capacity < v_consuming_bookings then
    raise exception 'El cupo no puede ser menor a las reservas existentes (%).', v_consuming_bookings;
  end if;

  select count(*)::int
  into v_selected_history_count
  from public.bookings b
  where b.session_id = p_session_id
    and (
      b.status in ('booked', 'attended', 'no_show')
      or exists (
        select 1
        from public.attendance att
        where att.booking_id = b.id
      )
    );

  v_new_weekday :=
    extract(dow from (p_starts_at at time zone 'America/Argentina/Buenos_Aires'))::int;
  v_original_weekday :=
    extract(dow from (v_session.starts_at at time zone 'America/Argentina/Buenos_Aires'))::int;
  v_new_start_time :=
    to_char(p_starts_at at time zone 'America/Argentina/Buenos_Aires', 'HH24:MI:SS')::time;
  v_new_end_time :=
    to_char(p_ends_at at time zone 'America/Argentina/Buenos_Aires', 'HH24:MI:SS')::time;
  v_new_valid_from := (p_starts_at at time zone 'America/Argentina/Buenos_Aires')::date;
  v_new_title := coalesce(nullif(btrim(coalesce(p_title, '')), ''), v_activity.name);

  v_structural_change :=
    p_activity_id is distinct from v_rule.activity_id
    or v_new_weekday is distinct from v_rule.weekday
    or v_new_start_time is distinct from v_rule.start_time
    or v_new_end_time is distinct from v_rule.end_time;

  v_previous := jsonb_build_object(
    'rule_id', v_rule.id,
    'activity_id', v_rule.activity_id,
    'title', v_rule.title,
    'weekday', v_rule.weekday,
    'start_time', v_rule.start_time,
    'end_time', v_rule.end_time,
    'capacity', v_rule.capacity,
    'valid_from', v_rule.valid_from,
    'session_id', v_session.id,
    'session_starts_at', v_session.starts_at,
    'session_ends_at', v_session.ends_at
  );

  if v_structural_change then
    if v_session.ends_at <= now() or v_selected_history_count > 0 then
      raise exception 'No se puede cambiar horario o actividad de una clase recurrente pasada o con historial. Usa \"Editar solo esta clase\" o pausa el horario recurrente anterior.';
    end if;

    select count(*)::int
    into v_future_history_count
    from public.class_sessions s
    where s.recurring_rule_id = v_rule.id
      and s.id <> v_session.id
      and s.starts_at >= v_session.starts_at
      and (
        exists (
          select 1
          from public.bookings b
          where b.session_id = s.id
            and b.status in ('booked', 'attended', 'no_show')
        )
        or exists (
          select 1
          from public.attendance att
          where att.session_id = s.id
        )
      );

    if v_future_history_count > 0 then
      raise exception 'No se puede reemplazar este horario recurrente porque ya hay clases futuras con reservas o asistencia. Primero resolve esas clases o usa \"Editar solo esta clase\".';
    end if;

    select *
    into v_conflict_rule
    from public.class_recurring_rules r
    where r.id <> v_rule.id
      and r.active = true
      and r.activity_id = p_activity_id
      and r.weekday = v_new_weekday
      and r.start_time = v_new_start_time
      and r.end_time = v_new_end_time
      and r.valid_from <= date '9999-12-31'
      and v_new_valid_from <= coalesce(r.valid_until, date '9999-12-31')
    order by r.valid_from desc, r.created_at desc
    limit 1;

    if found then
      raise exception
        'Ya existe un horario recurrente activo para % el dia % a las %.',
        v_activity.name,
        v_new_weekday,
        to_char(v_new_start_time, 'HH24:MI');
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
      v_new_title,
      v_new_weekday,
      v_new_start_time,
      v_new_end_time,
      p_capacity,
      nullif(btrim(coalesce(p_trainer_name, '')), ''),
      nullif(btrim(coalesce(p_notes, '')), ''),
      true,
      v_new_valid_from,
      null,
      v_actor
    )
    returning * into v_new_rule;

    insert into public.class_recurring_rule_exceptions (
      recurring_rule_id,
      occurrence_starts_at,
      occurrence_ends_at,
      action,
      class_session_id,
      created_by
    )
    values (
      v_rule.id,
      v_session.starts_at,
      v_session.ends_at,
      'edited',
      v_session.id,
      v_actor
    )
    on conflict (
      recurring_rule_id,
      occurrence_starts_at,
      occurrence_ends_at
    )
    do update set
      action = excluded.action,
      class_session_id = excluded.class_session_id,
      created_by = excluded.created_by;

    update public.class_recurring_rules
    set active = false,
        updated_at = now()
    where id = v_rule.id;

    with future_old_sessions as (
      select s.id
      from public.class_sessions s
      where s.recurring_rule_id = v_rule.id
        and s.id <> v_session.id
        and s.starts_at >= v_session.starts_at
    ),
    deleted as (
      delete from public.class_sessions s
      using future_old_sessions fos
      where s.id = fos.id
        and not exists (
          select 1
          from public.bookings b
          where b.session_id = s.id
        )
        and not exists (
          select 1
          from public.attendance att
          where att.session_id = s.id
        )
      returning s.id
    ),
    cancelled as (
      update public.class_sessions s
      set active = false,
          cancelled_at = coalesce(s.cancelled_at, now()),
          cancelled_by = coalesce(s.cancelled_by, v_actor),
          cancel_reason = coalesce(
            s.cancel_reason,
            'Horario recurrente reemplazado por administracion'
          ),
          updated_at = now()
      from future_old_sessions fos
      where s.id = fos.id
        and exists (
          select 1
          from public.bookings b
          where b.session_id = s.id
        )
      returning s.id
    )
    select
      coalesce((select count(*)::int from deleted), 0),
      coalesce((select count(*)::int from cancelled), 0)
    into v_deleted_sessions, v_cancelled_sessions;

    update public.class_sessions
    set recurring_rule_id = v_new_rule.id,
        activity_id = p_activity_id,
        title = v_new_title,
        starts_at = p_starts_at,
        ends_at = p_ends_at,
        capacity = p_capacity,
        trainer_name = nullif(btrim(coalesce(p_trainer_name, '')), ''),
        notes = nullif(btrim(coalesce(p_notes, '')), ''),
        active = coalesce(p_active, true),
        updated_at = now()
    where id = p_session_id
    returning * into v_session;

    perform private.materialize_recurring_class_sessions(
      p_starts_at,
      p_starts_at + interval '30 days'
    );

    insert into public.audit_logs (actor_id, entity_type, entity_id, action, metadata)
    values (
      v_actor,
      'class_recurring_rule',
      v_new_rule.id,
      'class_recurring_rule.replaced_from_session',
      jsonb_build_object(
        'previous', v_previous,
        'deleted_future_sessions', v_deleted_sessions,
        'cancelled_future_sessions', v_cancelled_sessions,
        'new_rule_id', v_new_rule.id,
        'session_id', v_session.id
      )
    );

    return jsonb_build_object(
      'action', 'updated',
      'rule_id', v_new_rule.id,
      'session_id', v_session.id,
      'deleted_future_sessions', v_deleted_sessions,
      'cancelled_future_sessions', v_cancelled_sessions
    );
  end if;

  select coalesce(max(consuming_bookings), 0)::int
  into v_max_future_consuming_bookings
  from (
    select (
      select count(*)::int
      from public.bookings b
      where b.session_id = s.id
        and b.status in ('booked', 'attended', 'no_show')
    ) as consuming_bookings
    from public.class_sessions s
    where s.recurring_rule_id = v_rule.id
      and s.starts_at >= v_session.starts_at
      and s.cancelled_at is null
      and s.active = true
  ) future_sessions;

  if p_capacity < v_max_future_consuming_bookings then
    raise exception 'El cupo no puede quedar por debajo de las reservas activas de las proximas clases (%).', v_max_future_consuming_bookings;
  end if;

  update public.class_recurring_rules
  set title = v_new_title,
      capacity = p_capacity,
      trainer_name = nullif(btrim(coalesce(p_trainer_name, '')), ''),
      notes = nullif(btrim(coalesce(p_notes, '')), ''),
      updated_at = now()
  where id = v_rule.id
  returning * into v_new_rule;

  update public.class_sessions s
  set title = v_new_title,
      capacity = p_capacity,
      trainer_name = nullif(btrim(coalesce(p_trainer_name, '')), ''),
      notes = nullif(btrim(coalesce(p_notes, '')), ''),
      updated_at = now()
  where s.recurring_rule_id = v_rule.id
    and s.starts_at >= v_session.starts_at
    and s.cancelled_at is null;

  insert into public.audit_logs (actor_id, entity_type, entity_id, action, metadata)
  values (
    v_actor,
    'class_recurring_rule',
    v_rule.id,
    'class_recurring_rule.updated_from_session',
    jsonb_build_object(
      'previous', v_previous,
      'current', jsonb_build_object(
        'activity_id', v_new_rule.activity_id,
        'title', v_new_rule.title,
        'weekday', v_new_rule.weekday,
        'start_time', v_new_rule.start_time,
        'end_time', v_new_rule.end_time,
        'capacity', v_new_rule.capacity
      ),
      'session_id', v_session.id
    )
  );

  return jsonb_build_object(
    'action', 'updated',
    'rule_id', v_rule.id,
    'session_id', v_session.id
  );
end;
$function$;

revoke all on function public.admin_update_class_recurring_rule_from_session(
  uuid,
  uuid,
  text,
  timestamptz,
  timestamptz,
  integer,
  text,
  text,
  boolean
) from public, anon;

grant execute on function public.admin_update_class_recurring_rule_from_session(
  uuid,
  uuid,
  text,
  timestamptz,
  timestamptz,
  integer,
  text,
  text,
  boolean
) to authenticated;
