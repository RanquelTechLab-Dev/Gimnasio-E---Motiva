create or replace function private.calendar_drift_rows(
  p_from_date timestamptz,
  p_to_date timestamptz
)
returns table (
  session_id uuid,
  session_starts_at timestamptz,
  recurring_rule_id uuid,
  rule_active boolean,
  session_activity_id uuid,
  rule_activity_id uuid,
  session_activity_slug text,
  rule_activity_slug text,
  session_local_date date,
  session_local_start time,
  session_local_end time,
  rule_weekday integer,
  rule_start_time time,
  rule_end_time time,
  session_active boolean,
  cancelled_at timestamptz,
  bookings_count integer,
  attendance_count integer,
  drift_kind text,
  repairability text
)
language sql
stable
security definer
set search_path = public, private
as $function$
  with scoped_sessions as (
    select
      s.id as session_id,
      s.starts_at as session_starts_at,
      s.recurring_rule_id,
      s.activity_id as session_activity_id,
      s.active as session_active,
      s.cancelled_at,
      (s.starts_at at time zone 'America/Argentina/Buenos_Aires')::date as session_local_date,
      to_char(
        s.starts_at at time zone 'America/Argentina/Buenos_Aires',
        'HH24:MI:SS'
      )::time as session_local_start,
      to_char(
        s.ends_at at time zone 'America/Argentina/Buenos_Aires',
        'HH24:MI:SS'
      )::time as session_local_end,
      extract(
        dow
        from (s.starts_at at time zone 'America/Argentina/Buenos_Aires')
      )::int as session_weekday
    from public.class_sessions s
    where s.recurring_rule_id is not null
      and s.starts_at >= p_from_date
      and s.starts_at < p_to_date
  )
  select
    ss.session_id,
    ss.session_starts_at,
    ss.recurring_rule_id,
    coalesce(r.active, false) as rule_active,
    ss.session_activity_id,
    r.activity_id as rule_activity_id,
    sa.slug as session_activity_slug,
    ra.slug as rule_activity_slug,
    ss.session_local_date,
    ss.session_local_start,
    ss.session_local_end,
    r.weekday as rule_weekday,
    r.start_time as rule_start_time,
    r.end_time as rule_end_time,
    coalesce(ss.session_active, false) as session_active,
    ss.cancelled_at,
    coalesce(b.bookings_count, 0)::int as bookings_count,
    coalesce(att.attendance_count, 0)::int as attendance_count,
    case
      when coalesce(ss.session_active, false) = true
        and ss.cancelled_at is not null
        then 'ACTIVE_CANCELLED_MISMATCH'
      when r.id is null
        then 'ORPHAN_RECURRING_RULE'
      when coalesce(r.active, false) = false
        then 'INACTIVE_RULE_VISIBLE'
      when ss.session_local_date < r.valid_from
        or (
          r.valid_until is not null
          and ss.session_local_date > r.valid_until
        )
        then 'RULE_VALIDITY_MISMATCH'
      when ss.session_activity_id is distinct from r.activity_id
        then 'ACTIVITY_MISMATCH'
      when ss.session_weekday is distinct from r.weekday
        or ss.session_local_start is distinct from r.start_time
        or ss.session_local_end is distinct from r.end_time
        then 'DAY_OR_TIME_MISMATCH'
      else 'OTHER'
    end as drift_kind,
    case
      when ss.session_starts_at <= now()
        then 'DO_NOT_TOUCH'
      when coalesce(b.bookings_count, 0) > 0
        or coalesce(att.attendance_count, 0) > 0
        then 'PROTECTED_WITH_BOOKING_OR_ATTENDANCE'
      else 'SAFE_REPAIR_NO_HISTORY'
    end as repairability
  from scoped_sessions ss
  left join public.class_recurring_rules r
    on r.id = ss.recurring_rule_id
  left join public.activities sa
    on sa.id = ss.session_activity_id
  left join public.activities ra
    on ra.id = r.activity_id
  left join lateral (
    select count(*)::int as bookings_count
    from public.bookings b
    where b.session_id = ss.session_id
      and b.status in ('booked', 'attended', 'no_show')
  ) b on true
  left join lateral (
    select count(*)::int as attendance_count
    from public.attendance att
    where att.session_id = ss.session_id
  ) att on true
  where
    (
      coalesce(ss.session_active, false) = true
      and ss.cancelled_at is not null
    )
    or (
      coalesce(ss.session_active, false) = true
      and ss.cancelled_at is null
      and (
        r.id is null
        or coalesce(r.active, false) = false
        or ss.session_local_date < r.valid_from
        or (r.valid_until is not null and ss.session_local_date > r.valid_until)
        or ss.session_activity_id is distinct from r.activity_id
        or ss.session_weekday is distinct from r.weekday
        or ss.session_local_start is distinct from r.start_time
        or ss.session_local_end is distinct from r.end_time
      )
    );
$function$;

revoke all on function private.calendar_drift_rows(
  timestamptz,
  timestamptz
) from public, anon, authenticated;

create or replace function public.admin_preview_calendar_drift(
  p_from_date timestamptz,
  p_to_date timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $function$
declare
  v_actor uuid := auth.uid();
  v_local_from_date date;
  v_local_to_date date;
  v_drift_sessions jsonb := '[]'::jsonb;
  v_active_rules jsonb := '[]'::jsonb;
  v_blocking_rules jsonb := '[]'::jsonb;
  v_safe_repair_count integer := 0;
  v_protected_count integer := 0;
  v_do_not_touch_count integer := 0;
  v_activity_mismatch_count integer := 0;
  v_day_time_mismatch_count integer := 0;
  v_inactive_rule_count integer := 0;
  v_active_cancelled_count integer := 0;
begin
  if v_actor is null or not private.is_admin() then
    raise exception 'Solo un admin activo puede auditar el drift del calendario.';
  end if;

  if p_from_date is null or p_to_date is null or p_to_date <= p_from_date then
    raise exception 'El rango de calendario no es valido.';
  end if;

  if p_to_date - p_from_date > interval '90 days' then
    raise exception 'El rango de auditoria no puede superar 90 dias.';
  end if;

  v_local_from_date :=
    (p_from_date at time zone 'America/Argentina/Buenos_Aires')::date;
  v_local_to_date :=
    ((p_to_date - interval '1 millisecond') at time zone 'America/Argentina/Buenos_Aires')::date;

  select
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'session_id', d.session_id,
          'recurring_rule_id', d.recurring_rule_id,
          'session_activity', d.session_activity_slug,
          'rule_activity', d.rule_activity_slug,
          'session_local_date', d.session_local_date,
          'session_local_start', d.session_local_start,
          'session_local_end', d.session_local_end,
          'rule_weekday', d.rule_weekday,
          'rule_start_time', d.rule_start_time,
          'rule_end_time', d.rule_end_time,
          'active', d.session_active,
          'cancelled_at', d.cancelled_at,
          'bookings_count', d.bookings_count,
          'attendance_count', d.attendance_count,
          'drift_kind', d.drift_kind,
          'repairability', d.repairability
        )
        order by d.session_local_date, d.session_local_start, d.session_id
      ),
      '[]'::jsonb
    ),
    count(*) filter (
      where d.repairability = 'SAFE_REPAIR_NO_HISTORY'
    )::int,
    count(*) filter (
      where d.repairability = 'PROTECTED_WITH_BOOKING_OR_ATTENDANCE'
    )::int,
    count(*) filter (
      where d.repairability = 'DO_NOT_TOUCH'
    )::int,
    count(*) filter (
      where d.drift_kind = 'ACTIVITY_MISMATCH'
    )::int,
    count(*) filter (
      where d.drift_kind = 'DAY_OR_TIME_MISMATCH'
    )::int,
    count(*) filter (
      where d.drift_kind = 'INACTIVE_RULE_VISIBLE'
    )::int,
    count(*) filter (
      where d.drift_kind = 'ACTIVE_CANCELLED_MISMATCH'
    )::int
  into
    v_drift_sessions,
    v_safe_repair_count,
    v_protected_count,
    v_do_not_touch_count,
    v_activity_mismatch_count,
    v_day_time_mismatch_count,
    v_inactive_rule_count,
    v_active_cancelled_count
  from private.calendar_drift_rows(p_from_date, p_to_date) d;

  with rule_summary as (
    select
      r.id as rule_id,
      a.slug as activity_slug,
      a.name as activity_name,
      r.weekday,
      r.start_time,
      r.end_time,
      r.valid_from,
      r.valid_until,
      r.active,
      count(*) filter (
        where s.starts_at >= p_from_date
          and s.starts_at < p_to_date
          and coalesce(s.active, false) = true
          and s.cancelled_at is null
      )::int as future_visible_sessions,
      count(*) filter (
        where s.starts_at >= p_from_date
          and s.starts_at < p_to_date
          and (
            coalesce(s.active, false) = false
            or s.cancelled_at is not null
          )
      )::int as future_cancelled_or_inactive_sessions,
      count(*) filter (
        where s.starts_at >= p_from_date
          and s.starts_at < p_to_date
          and exists (
            select 1
            from public.bookings b
            where b.session_id = s.id
              and b.status in ('booked', 'attended', 'no_show')
          )
      )::int as future_sessions_with_bookings,
      count(*) filter (
        where s.starts_at >= p_from_date
          and s.starts_at < p_to_date
          and exists (
            select 1
            from public.attendance att
            where att.session_id = s.id
          )
      )::int as future_sessions_with_attendance
    from public.class_recurring_rules r
    join public.activities a
      on a.id = r.activity_id
    left join public.class_sessions s
      on s.recurring_rule_id = r.id
    where r.active = true
    group by
      r.id,
      a.slug,
      a.name,
      r.weekday,
      r.start_time,
      r.end_time,
      r.valid_from,
      r.valid_until,
      r.active
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'rule_id', rs.rule_id,
        'activity_slug', rs.activity_slug,
        'activity_name', rs.activity_name,
        'weekday', rs.weekday,
        'start_time', rs.start_time,
        'end_time', rs.end_time,
        'valid_from', rs.valid_from,
        'valid_until', rs.valid_until,
        'active', rs.active,
        'future_visible_sessions', rs.future_visible_sessions,
        'future_cancelled_or_inactive_sessions',
          rs.future_cancelled_or_inactive_sessions,
        'future_sessions_with_bookings', rs.future_sessions_with_bookings,
        'future_sessions_with_attendance', rs.future_sessions_with_attendance
      )
      order by
        rs.activity_slug,
        rs.weekday,
        rs.start_time,
        rs.valid_from
    ),
    '[]'::jsonb
  )
  into v_active_rules
  from rule_summary rs;

  with params as (
    select
      v_local_from_date as local_from_date,
      v_local_to_date as local_to_date
  ),
  blocking_rules as (
    select
      r.id as rule_id,
      a.slug as activity_slug,
      a.name as activity_name,
      r.weekday,
      r.start_time,
      r.end_time,
      r.valid_from,
      r.valid_until,
      occ.next_occurrence_date
    from public.class_recurring_rules r
    join public.activities a
      on a.id = r.activity_id
    cross join params p
    left join lateral (
      select gs::date as next_occurrence_date
      from generate_series(
        greatest(r.valid_from, p.local_from_date),
        least(
          coalesce(r.valid_until, p.local_from_date + 120),
          p.local_to_date + 120
        ),
        interval '1 day'
      ) gs
      where extract(dow from gs)::int = r.weekday
      order by gs
      limit 1
    ) occ on true
    where r.active = true
      and occ.next_occurrence_date is not null
      and r.valid_from > p.local_from_date
      and occ.next_occurrence_date > p.local_from_date
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'rule_id', br.rule_id,
        'activity_slug', br.activity_slug,
        'activity_name', br.activity_name,
        'weekday', br.weekday,
        'start_time', br.start_time,
        'end_time', br.end_time,
        'valid_from', br.valid_from,
        'valid_until', br.valid_until,
        'next_occurrence_date', br.next_occurrence_date,
        'message',
          format(
            'Hay un horario recurrente activo que empieza el %s y puede bloquear esta combinacion aunque no aparezca en la fecha actual.',
            to_char(br.valid_from, 'DD/MM/YYYY')
          )
      )
      order by br.activity_slug, br.weekday, br.start_time, br.valid_from
    ),
    '[]'::jsonb
  )
  into v_blocking_rules
  from blocking_rules br;

  return jsonb_build_object(
    'ok', true,
    'dry_run', true,
    'from_date', p_from_date,
    'to_date', p_to_date,
    'summary', jsonb_build_object(
      'safe_repair_no_history', v_safe_repair_count,
      'protected_with_booking_or_attendance', v_protected_count,
      'do_not_touch', v_do_not_touch_count,
      'activity_mismatch', v_activity_mismatch_count,
      'day_or_time_mismatch', v_day_time_mismatch_count,
      'inactive_rule_visible', v_inactive_rule_count,
      'active_cancelled_mismatch', v_active_cancelled_count
    ),
    'active_rules', v_active_rules,
    'drift_sessions', v_drift_sessions,
    'blocking_rules', v_blocking_rules
  );
end;
$function$;

revoke all on function public.admin_preview_calendar_drift(
  timestamptz,
  timestamptz
) from public, anon;
grant execute on function public.admin_preview_calendar_drift(
  timestamptz,
  timestamptz
) to authenticated;

create or replace function public.admin_repair_calendar_drift(
  p_from_date timestamptz,
  p_to_date timestamptz,
  p_dry_run boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $function$
declare
  v_actor uuid := auth.uid();
  v_safe_count integer := 0;
  v_protected_count integer := 0;
  v_do_not_touch_count integer := 0;
  v_affected_count integer := 0;
  v_materialized_count integer := 0;
  v_safe_details jsonb := '[]'::jsonb;
  v_protected_details jsonb := '[]'::jsonb;
  v_warnings jsonb := '[]'::jsonb;
begin
  if v_actor is null or not private.is_admin() then
    raise exception 'Solo un admin activo puede reparar el drift del calendario.';
  end if;

  if p_from_date is null or p_to_date is null or p_to_date <= p_from_date then
    raise exception 'El rango de calendario no es valido.';
  end if;

  if p_to_date - p_from_date > interval '90 days' then
    raise exception 'El rango de reparacion no puede superar 90 dias.';
  end if;

  select
    count(*) filter (
      where d.repairability = 'SAFE_REPAIR_NO_HISTORY'
    )::int,
    count(*) filter (
      where d.repairability = 'PROTECTED_WITH_BOOKING_OR_ATTENDANCE'
    )::int,
    count(*) filter (
      where d.repairability = 'DO_NOT_TOUCH'
    )::int,
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'session_id', d.session_id,
          'recurring_rule_id', d.recurring_rule_id,
          'drift_kind', d.drift_kind,
          'session_local_date', d.session_local_date,
          'session_local_start', d.session_local_start,
          'session_activity', d.session_activity_slug,
          'rule_activity', d.rule_activity_slug
        )
        order by d.session_local_date, d.session_local_start, d.session_id
      ) filter (
        where d.repairability = 'SAFE_REPAIR_NO_HISTORY'
      ),
      '[]'::jsonb
    ),
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'session_id', d.session_id,
          'recurring_rule_id', d.recurring_rule_id,
          'drift_kind', d.drift_kind,
          'session_local_date', d.session_local_date,
          'session_local_start', d.session_local_start,
          'bookings_count', d.bookings_count,
          'attendance_count', d.attendance_count
        )
        order by d.session_local_date, d.session_local_start, d.session_id
      ) filter (
        where d.repairability = 'PROTECTED_WITH_BOOKING_OR_ATTENDANCE'
      ),
      '[]'::jsonb
    )
  into
    v_safe_count,
    v_protected_count,
    v_do_not_touch_count,
    v_safe_details,
    v_protected_details
  from private.calendar_drift_rows(p_from_date, p_to_date) d;

  if v_protected_count > 0 then
    v_warnings := v_warnings || jsonb_build_array(
      'Hay sesiones protegidas con reservas/asistencia que no se tocaran automaticamente.'
    );
  end if;

  if coalesce(p_dry_run, true) then
    return jsonb_build_object(
      'ok', true,
      'dry_run', true,
      'affected_sessions', v_safe_count,
      'skipped_sessions', v_do_not_touch_count,
      'protected_sessions', v_protected_count,
      'warnings', v_warnings,
      'details', v_safe_details,
      'protected_details', v_protected_details
    );
  end if;

  with repairable as (
    select d.session_id
    from private.calendar_drift_rows(p_from_date, p_to_date) d
    where d.repairability = 'SAFE_REPAIR_NO_HISTORY'
      and d.session_starts_at > now()
  ),
  updated as (
    update public.class_sessions s
    set active = false,
        cancelled_at = coalesce(s.cancelled_at, now()),
        cancelled_by = coalesce(s.cancelled_by, v_actor),
        cancel_reason = coalesce(
          nullif(btrim(coalesce(s.cancel_reason, '')), ''),
          'Calendar drift repair'
        ),
        updated_at = now()
    from repairable r
    where s.id = r.session_id
    returning s.id
  )
  select count(*)::int
  into v_affected_count
  from updated;

  v_materialized_count := private.materialize_recurring_class_sessions(
    p_from_date,
    p_to_date
  );

  insert into public.audit_logs (
    actor_id,
    entity_type,
    entity_id,
    action,
    metadata
  )
  values (
    v_actor,
    'calendar_engine',
    null,
    'calendar_drift.repaired',
    jsonb_build_object(
      'from_date', p_from_date,
      'to_date', p_to_date,
      'dry_run', false,
      'affected_sessions', v_affected_count,
      'protected_sessions', v_protected_count,
      'skipped_sessions', v_do_not_touch_count,
      'materialized_sessions', v_materialized_count,
      'details', v_safe_details,
      'protected_details', v_protected_details
    )
  );

  return jsonb_build_object(
    'ok', true,
    'dry_run', false,
    'affected_sessions', v_affected_count,
    'skipped_sessions', v_do_not_touch_count,
    'protected_sessions', v_protected_count,
    'materialized_sessions', v_materialized_count,
    'warnings', v_warnings,
    'details', v_safe_details,
    'protected_details', v_protected_details
  );
end;
$function$;

revoke all on function public.admin_repair_calendar_drift(
  timestamptz,
  timestamptz,
  boolean
) from public, anon;
grant execute on function public.admin_repair_calendar_drift(
  timestamptz,
  timestamptz,
  boolean
) to authenticated;

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
    if v_session.ends_at <= now() or v_selected_history_count > 0 then
      raise exception 'No se puede cambiar horario o actividad de una clase recurrente pasada o con historial. Usa "Editar solo esta clase" o pausa el horario recurrente anterior.';
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
