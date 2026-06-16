create or replace function private.reconcile_future_recurring_sessions(
  p_rule_id uuid,
  p_from_starts_at timestamptz,
  p_actor uuid,
  p_cancel_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $function$
declare
  v_reconciled_sessions integer := 0;
  v_skipped_sessions integer := 0;
  v_skipped_with_bookings integer := 0;
  v_skipped_with_attendance integer := 0;
begin
  if p_rule_id is null then
    raise exception 'La regla recurrente es obligatoria.';
  end if;

  if p_from_starts_at is null then
    raise exception 'La fecha desde la cual reconciliar es obligatoria.';
  end if;

  with future_sessions as (
    select
      s.id,
      exists (
        select 1
        from public.bookings b
        where b.session_id = s.id
          and b.status in ('booked', 'attended', 'no_show')
      ) as has_consuming_bookings,
      exists (
        select 1
        from public.attendance att
        where att.session_id = s.id
      ) as has_attendance
    from public.class_sessions s
    where s.recurring_rule_id = p_rule_id
      and s.starts_at >= p_from_starts_at
      and coalesce(s.active, true) = true
      and s.cancelled_at is null
  ),
  reconciled as (
    update public.class_sessions s
    set active = false,
        cancelled_at = now(),
        cancelled_by = coalesce(s.cancelled_by, p_actor),
        cancel_reason = coalesce(
          s.cancel_reason,
          nullif(btrim(coalesce(p_cancel_reason, '')), '')
        ),
        updated_at = now()
    from future_sessions fs
    where s.id = fs.id
      and fs.has_consuming_bookings is false
      and fs.has_attendance is false
    returning s.id
  )
  select count(*)::int
  into v_reconciled_sessions
  from reconciled;

  with future_sessions as (
    select
      s.id,
      exists (
        select 1
        from public.bookings b
        where b.session_id = s.id
          and b.status in ('booked', 'attended', 'no_show')
      ) as has_consuming_bookings,
      exists (
        select 1
        from public.attendance att
        where att.session_id = s.id
      ) as has_attendance
    from public.class_sessions s
    where s.recurring_rule_id = p_rule_id
      and s.starts_at >= p_from_starts_at
      and coalesce(s.active, true) = true
      and s.cancelled_at is null
  )
  select
    count(*)::int,
    count(*) filter (where has_consuming_bookings)::int,
    count(*) filter (where has_attendance)::int
  into
    v_skipped_sessions,
    v_skipped_with_bookings,
    v_skipped_with_attendance
  from future_sessions
  where has_consuming_bookings or has_attendance;

  return jsonb_build_object(
    'reconciled_sessions', coalesce(v_reconciled_sessions, 0),
    'skipped_sessions', coalesce(v_skipped_sessions, 0),
    'skipped_with_bookings', coalesce(v_skipped_with_bookings, 0),
    'skipped_with_attendance', coalesce(v_skipped_with_attendance, 0)
  );
end;
$function$;

create or replace function public.admin_archive_class_recurring_rule(p_rule_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $function$
declare
  v_actor uuid := auth.uid();
  v_rule public.class_recurring_rules%rowtype;
  v_from_starts_at timestamptz := now();
  v_from_date date;
  v_reconcile jsonb;
  v_reconciled_sessions integer := 0;
  v_skipped_sessions integer := 0;
  v_skipped_with_bookings integer := 0;
  v_skipped_with_attendance integer := 0;
  v_warning text := null;
begin
  if v_actor is null or not private.is_admin() then
    raise exception 'Solo un admin activo puede pausar horarios recurrentes.';
  end if;

  select *
  into v_rule
  from public.class_recurring_rules r
  where r.id = p_rule_id
  for update;

  if not found then
    raise exception 'La regla recurrente no existe.';
  end if;

  v_from_date :=
    (v_from_starts_at at time zone 'America/Argentina/Buenos_Aires')::date;

  update public.class_recurring_rules r
  set active = false,
      valid_until = least(
        coalesce(r.valid_until, v_from_date),
        greatest(r.valid_from, v_from_date)
      ),
      updated_at = now()
  where r.id = p_rule_id
  returning * into v_rule;

  v_reconcile := private.reconcile_future_recurring_sessions(
    p_rule_id,
    v_from_starts_at,
    v_actor,
    'Horario recurrente pausado por administracion'
  );

  v_reconciled_sessions :=
    coalesce((v_reconcile ->> 'reconciled_sessions')::integer, 0);
  v_skipped_sessions :=
    coalesce((v_reconcile ->> 'skipped_sessions')::integer, 0);
  v_skipped_with_bookings :=
    coalesce((v_reconcile ->> 'skipped_with_bookings')::integer, 0);
  v_skipped_with_attendance :=
    coalesce((v_reconcile ->> 'skipped_with_attendance')::integer, 0);

  if v_skipped_sessions > 0 then
    v_warning :=
      'Se pauso el horario recurrente. Algunas clases futuras con reservas/asistencia no se modificaron y deben revisarse manualmente.';
  end if;

  insert into public.audit_logs (actor_id, entity_type, entity_id, action, metadata)
  values (
    v_actor,
    'class_recurring_rule',
    v_rule.id,
    'class_recurring_rule.archived',
    jsonb_build_object(
      'activity_id', v_rule.activity_id,
      'from_starts_at', v_from_starts_at,
      'reconciled_future_sessions', v_reconciled_sessions,
      'skipped_future_sessions', v_skipped_sessions,
      'skipped_future_sessions_with_bookings', v_skipped_with_bookings,
      'skipped_future_sessions_with_attendance', v_skipped_with_attendance
    )
  );

  return jsonb_build_object(
    'action', 'archived',
    'rule_id', v_rule.id,
    'reconciled_future_sessions', v_reconciled_sessions,
    'skipped_future_sessions', v_skipped_sessions,
    'skipped_future_sessions_with_bookings', v_skipped_with_bookings,
    'skipped_future_sessions_with_attendance', v_skipped_with_attendance,
    'warning', v_warning
  );
end;
$function$;

create or replace function public.admin_delete_class_session(
  p_session_id uuid,
  p_scope text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $function$
declare
  v_actor uuid;
  v_session public.class_sessions%rowtype;
  v_rule public.class_recurring_rules%rowtype;
  v_bookings integer;
  v_attendance integer;
  v_requested_scope text := lower(nullif(btrim(coalesce(p_scope, '')), ''));
  v_scope text;
  v_reconcile jsonb;
  v_reconciled_sessions integer := 0;
  v_skipped_sessions integer := 0;
  v_skipped_with_bookings integer := 0;
  v_skipped_with_attendance integer := 0;
  v_warning text := null;
begin
  v_actor := private.ensure_admin();

  select *
  into v_session
  from public.class_sessions s
  where s.id = p_session_id
  for update;

  if not found then
    raise exception 'La clase no existe.';
  end if;

  v_scope := coalesce(
    v_requested_scope,
    case
      when v_session.recurring_rule_id is not null then 'series'
      else 'single'
    end
  );

  if v_scope not in ('single', 'series') then
    raise exception 'El alcance de eliminacion no es valido.';
  end if;

  select count(*) into v_bookings
  from public.bookings b
  where b.session_id = p_session_id;

  select count(*) into v_attendance
  from public.attendance a
  where a.session_id = p_session_id;

  if v_scope = 'series' then
    if v_session.recurring_rule_id is null then
      raise exception 'Esta clase no pertenece a un horario recurrente.';
    end if;

    select *
    into v_rule
    from public.class_recurring_rules r
    where r.id = v_session.recurring_rule_id
    for update;

    if not found then
      raise exception 'El horario recurrente no existe.';
    end if;

    update public.class_recurring_rules r
    set active = false,
        valid_until = greatest(
          r.valid_from,
          ((v_session.starts_at at time zone 'America/Argentina/Buenos_Aires')::date - 1)
        ),
        updated_at = now()
    where r.id = v_session.recurring_rule_id
    returning * into v_rule;

    v_reconcile := private.reconcile_future_recurring_sessions(
      v_session.recurring_rule_id,
      v_session.starts_at,
      v_actor,
      'Horario recurrente pausado por administracion'
    );

    v_reconciled_sessions :=
      coalesce((v_reconcile ->> 'reconciled_sessions')::integer, 0);
    v_skipped_sessions :=
      coalesce((v_reconcile ->> 'skipped_sessions')::integer, 0);
    v_skipped_with_bookings :=
      coalesce((v_reconcile ->> 'skipped_with_bookings')::integer, 0);
    v_skipped_with_attendance :=
      coalesce((v_reconcile ->> 'skipped_with_attendance')::integer, 0);

    if v_skipped_sessions > 0 then
      v_warning :=
        'Se pauso el horario recurrente. Algunas clases futuras con reservas/asistencia no se modificaron y deben revisarse manualmente.';
    end if;

    insert into public.audit_logs (actor_id, entity_type, entity_id, action, metadata)
    values (
      v_actor,
      'class_recurring_rule',
      v_session.recurring_rule_id,
      'class_recurring_rule.deleted_series',
      jsonb_build_object(
        'activity_id', v_rule.activity_id,
        'weekday', v_rule.weekday,
        'start_time', v_rule.start_time,
        'end_time', v_rule.end_time,
        'reconciled_future_sessions', v_reconciled_sessions,
        'skipped_future_sessions', v_skipped_sessions,
        'skipped_future_sessions_with_bookings', v_skipped_with_bookings,
        'skipped_future_sessions_with_attendance', v_skipped_with_attendance,
        'defaulted_scope', v_requested_scope is null
      )
    );

    return jsonb_build_object(
      'action', 'deleted_series',
      'rule_id', v_session.recurring_rule_id,
      'session_id', p_session_id,
      'reconciled_future_sessions', v_reconciled_sessions,
      'skipped_future_sessions', v_skipped_sessions,
      'skipped_future_sessions_with_bookings', v_skipped_with_bookings,
      'skipped_future_sessions_with_attendance', v_skipped_with_attendance,
      'warning', v_warning
    );
  end if;

  if v_session.recurring_rule_id is not null then
    insert into public.class_recurring_rule_exceptions (
      recurring_rule_id,
      occurrence_starts_at,
      occurrence_ends_at,
      action,
      class_session_id,
      created_by
    )
    values (
      v_session.recurring_rule_id,
      v_session.starts_at,
      v_session.ends_at,
      'cancelled',
      null,
      v_actor
    )
    on conflict (
      recurring_rule_id,
      occurrence_starts_at,
      occurrence_ends_at
    )
    do update set
      action = excluded.action,
      class_session_id = null,
      created_by = excluded.created_by;
  end if;

  if v_bookings + v_attendance = 0 then
    update public.class_sessions s
    set active = false,
        cancelled_at = coalesce(s.cancelled_at, now()),
        cancelled_by = coalesce(s.cancelled_by, v_actor),
        cancel_reason = coalesce(s.cancel_reason, 'Clase eliminada por administracion'),
        updated_at = now()
    where s.id = p_session_id;

    insert into public.audit_logs (actor_id, entity_type, entity_id, action, metadata)
    values (
      v_actor,
      'class_session',
      p_session_id,
      'class.deleted',
      jsonb_build_object(
        'activity_id', v_session.activity_id,
        'starts_at', v_session.starts_at,
        'ends_at', v_session.ends_at,
        'capacity', v_session.capacity,
        'recurring_rule_id', v_session.recurring_rule_id,
        'recurring_exception', v_session.recurring_rule_id is not null
      )
    );

    return jsonb_build_object(
      'action', 'deleted',
      'session_id', p_session_id,
      'recurring_exception', v_session.recurring_rule_id is not null
    );
  end if;

  update public.class_sessions s
  set active = false,
      cancelled_at = coalesce(s.cancelled_at, now()),
      cancelled_by = coalesce(s.cancelled_by, v_actor),
      cancel_reason = coalesce(s.cancel_reason, 'Clase eliminada por administracion'),
      updated_at = now()
  where s.id = p_session_id;

  insert into public.audit_logs (actor_id, entity_type, entity_id, action, metadata)
  values (
    v_actor,
    'class_session',
    p_session_id,
    'class.cancelled_by_delete',
    jsonb_build_object(
      'activity_id', v_session.activity_id,
      'starts_at', v_session.starts_at,
      'ends_at', v_session.ends_at,
      'bookings', v_bookings,
      'attendance', v_attendance,
      'recurring_rule_id', v_session.recurring_rule_id,
      'recurring_exception', v_session.recurring_rule_id is not null
    )
  );

  return jsonb_build_object(
    'action', 'cancelled',
    'session_id', p_session_id,
    'has_history', true,
    'recurring_exception', v_session.recurring_rule_id is not null
  );
end;
$function$;

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
  v_max_future_consuming_bookings integer := 0;
  v_reconciled_sessions integer := 0;
  v_skipped_sessions integer := 0;
  v_skipped_with_bookings integer := 0;
  v_skipped_with_attendance integer := 0;
  v_warning text := null;
  v_previous jsonb;
  v_reconcile jsonb;
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
        valid_until = greatest(v_rule.valid_from, v_new_valid_from - 1),
        updated_at = now()
    where id = v_rule.id;

    v_reconcile := private.reconcile_future_recurring_sessions(
      v_rule.id,
      v_session.starts_at,
      v_actor,
      'Horario recurrente reemplazado por administracion'
    );

    v_reconciled_sessions :=
      coalesce((v_reconcile ->> 'reconciled_sessions')::integer, 0);
    v_skipped_sessions :=
      coalesce((v_reconcile ->> 'skipped_sessions')::integer, 0);
    v_skipped_with_bookings :=
      coalesce((v_reconcile ->> 'skipped_with_bookings')::integer, 0);
    v_skipped_with_attendance :=
      coalesce((v_reconcile ->> 'skipped_with_attendance')::integer, 0);

    if v_skipped_sessions > 0 then
      v_warning :=
        'Se actualizo el horario recurrente. Algunas clases futuras con reservas/asistencia no se modificaron y deben revisarse manualmente.';
    end if;

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
        'reconciled_future_sessions', v_reconciled_sessions,
        'skipped_future_sessions', v_skipped_sessions,
        'skipped_future_sessions_with_bookings', v_skipped_with_bookings,
        'skipped_future_sessions_with_attendance', v_skipped_with_attendance,
        'new_rule_id', v_new_rule.id,
        'session_id', v_session.id
      )
    );

    return jsonb_build_object(
      'action', 'updated',
      'rule_id', v_new_rule.id,
      'session_id', v_session.id,
      'reconciled_future_sessions', v_reconciled_sessions,
      'skipped_future_sessions', v_skipped_sessions,
      'skipped_future_sessions_with_bookings', v_skipped_with_bookings,
      'skipped_future_sessions_with_attendance', v_skipped_with_attendance,
      'warning', v_warning
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

revoke all on function private.reconcile_future_recurring_sessions(uuid, timestamptz, uuid, text) from public, anon, authenticated;
