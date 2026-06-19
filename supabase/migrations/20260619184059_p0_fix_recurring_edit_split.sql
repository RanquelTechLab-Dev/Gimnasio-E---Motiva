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
set search_path = public, private
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
  v_weekday_label text;
  v_conflict_valid_until_text text;
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
  v_weekday_label := case v_new_weekday
    when 0 then 'domingo'
    when 1 then 'lunes'
    when 2 then 'martes'
    when 3 then 'miercoles'
    when 4 then 'jueves'
    when 5 then 'viernes'
    when 6 then 'sabado'
    else format('dia %s', v_new_weekday)
  end;

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
    if v_session.ends_at <= now() then
      raise exception 'Esta clase ya paso. Para cambiar el horario hacia adelante, elegi una clase futura de la serie o usa "Dejar de repetir este horario" y crea uno nuevo.';
    end if;

    if v_selected_history_count > 0 then
      raise exception 'Esta clase futura ya tiene reservas/asistencia. No se mueve automaticamente para no romper historial. Cancela o reubica esas reservas primero, o elegi una fecha futura sin reservas para cambiar el horario recurrente.';
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
      v_conflict_valid_until_text := coalesce(
        to_char(v_conflict_rule.valid_until, 'DD/MM/YYYY'),
        'sin fecha de fin'
      );

      raise exception using
        message = format(
          'Ya existe un horario recurrente activo desde %s para %s los %s de %s a %s. Pausa ese horario o elegi reemplazarlo explicitamente. Aunque no aparezca en esta fecha, sigue activo y bloquea la serie.',
          to_char(v_conflict_rule.valid_from, 'DD/MM/YYYY'),
          v_activity.name,
          v_weekday_label,
          to_char(v_new_start_time, 'HH24:MI'),
          to_char(v_new_end_time, 'HH24:MI')
        ),
        detail = format(
          'conflicting_rule_id=%s; activity=%s; weekday=%s; start_time=%s; end_time=%s; valid_from=%s; valid_until=%s',
          v_conflict_rule.id,
          v_activity.name,
          v_weekday_label,
          to_char(v_new_start_time, 'HH24:MI'),
          to_char(v_new_end_time, 'HH24:MI'),
          to_char(v_conflict_rule.valid_from, 'YYYY-MM-DD'),
          v_conflict_valid_until_text
        );
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
      v_session.starts_at,
      v_session.starts_at + interval '90 days'
    );

    insert into public.audit_logs (actor_id, entity_type, entity_id, action, metadata)
    values (
      v_actor,
      'class_recurring_rule',
      v_new_rule.id,
      'class_recurring_rule.updated_from_session',
      jsonb_build_object(
        'previous', v_previous,
        'new_rule_id', v_new_rule.id,
        'new_activity_id', p_activity_id,
        'new_weekday', v_new_weekday,
        'new_start_time', v_new_start_time,
        'new_end_time', v_new_end_time,
        'session_id', v_session.id,
        'reconciled_future_sessions', v_reconciled_sessions,
        'skipped_future_sessions', v_skipped_sessions,
        'skipped_future_sessions_with_bookings', v_skipped_with_bookings,
        'skipped_future_sessions_with_attendance', v_skipped_with_attendance
      )
    );

    return jsonb_build_object(
      'ok', true,
      'action', 'updated',
      'rule_id', v_new_rule.id,
      'session_id', v_session.id,
      'message', 'Horario recurrente actualizado desde esta fecha.',
      'reconciled_future_sessions', v_reconciled_sessions,
      'skipped_future_sessions', v_skipped_sessions,
      'skipped_future_sessions_with_bookings', v_skipped_with_bookings,
      'skipped_future_sessions_with_attendance', v_skipped_with_attendance,
      'warning', v_warning
    );
  end if;

  select count(*)::int
  into v_max_future_consuming_bookings
  from public.bookings b
  join public.class_sessions s on s.id = b.session_id
  where s.recurring_rule_id = v_rule.id
    and s.starts_at >= v_session.starts_at
    and b.status in ('booked', 'attended', 'no_show');

  if p_capacity < v_max_future_consuming_bookings then
    raise exception
      'El cupo no puede ser menor a las reservas futuras existentes del horario (%).',
      v_max_future_consuming_bookings;
  end if;

  update public.class_recurring_rules
  set title = v_new_title,
      capacity = p_capacity,
      trainer_name = nullif(btrim(coalesce(p_trainer_name, '')), ''),
      notes = nullif(btrim(coalesce(p_notes, '')), ''),
      updated_at = now()
  where id = v_rule.id
  returning * into v_rule;

  update public.class_sessions s
  set activity_id = p_activity_id,
      title = v_new_title,
      starts_at = p_starts_at,
      ends_at = p_ends_at,
      capacity = p_capacity,
      trainer_name = nullif(btrim(coalesce(p_trainer_name, '')), ''),
      notes = nullif(btrim(coalesce(p_notes, '')), ''),
      active = coalesce(p_active, true),
      updated_at = now()
  where s.id = p_session_id
  returning * into v_session;

  update public.class_sessions s
  set title = v_new_title,
      capacity = p_capacity,
      trainer_name = nullif(btrim(coalesce(p_trainer_name, '')), ''),
      notes = nullif(btrim(coalesce(p_notes, '')), ''),
      updated_at = now()
  where s.recurring_rule_id = v_rule.id
    and s.starts_at > v_session.starts_at
    and coalesce(s.active, false) = true
    and s.cancelled_at is null
    and not exists (
      select 1
      from public.bookings b
      where b.session_id = s.id
        and b.status in ('booked', 'attended', 'no_show')
    )
    and not exists (
      select 1
      from public.attendance att
      where att.session_id = s.id
    );

  insert into public.audit_logs (actor_id, entity_type, entity_id, action, metadata)
  values (
    v_actor,
    'class_recurring_rule',
    v_rule.id,
    'class_recurring_rule.updated_from_session',
    jsonb_build_object(
      'previous', v_previous,
      'updated_rule_id', v_rule.id,
      'session_id', v_session.id,
      'capacity_only', true
    )
  );

  return jsonb_build_object(
    'ok', true,
    'action', 'updated',
    'rule_id', v_rule.id,
    'session_id', v_session.id,
    'message', 'Horario recurrente actualizado desde esta fecha.'
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