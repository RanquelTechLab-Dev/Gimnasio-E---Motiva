-- RAN-34 follow-up:
-- Align the operational recurring calendar with "Plan de Actividades (2)" and
-- make "Eliminar tipo" hard-delete activities with their operational links.
--
-- This migration does not touch plans/prices, students, payments, Drive,
-- Mailjet, auth, or secrets.

create or replace function public.admin_delete_activity(p_activity_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_actor uuid;
  v_activity public.activities%rowtype;
  v_plan_links integer;
  v_recurring_rules integer;
  v_rule_exceptions integer;
  v_session_exceptions integer;
  v_sessions integer;
  v_bookings integer;
  v_attendance integer;
  v_rule_ids uuid[];
  v_session_ids uuid[];
begin
  v_actor := private.ensure_admin();

  select * into v_activity
  from public.activities a
  where a.id = p_activity_id
  for update;

  if not found then
    raise exception 'No se encontro la actividad.';
  end if;

  select count(*) into v_plan_links
  from public.plan_activities pa
  where pa.activity_id = p_activity_id;

  select coalesce(array_agg(r.id), array[]::uuid[]) into v_rule_ids
  from public.class_recurring_rules r
  where r.activity_id = p_activity_id;

  v_recurring_rules := cardinality(v_rule_ids);

  select coalesce(array_agg(s.id), array[]::uuid[]) into v_session_ids
  from public.class_sessions s
  where s.activity_id = p_activity_id
     or s.recurring_rule_id = any(v_rule_ids);

  v_sessions := cardinality(v_session_ids);

  select count(*) into v_rule_exceptions
  from public.class_recurring_rule_exceptions e
  where e.recurring_rule_id = any(v_rule_ids);

  select count(*) into v_session_exceptions
  from public.class_recurring_rule_exceptions e
  where e.class_session_id = any(v_session_ids);

  select count(*) into v_bookings
  from public.bookings b
  where b.session_id = any(v_session_ids);

  select count(*) into v_attendance
  from public.attendance att
  where att.session_id = any(v_session_ids);

  insert into public.audit_logs (actor_id, entity_type, entity_id, action, metadata)
  values (
    v_actor,
    'activity',
    p_activity_id,
    'activity.deleted_with_operational_cleanup',
    jsonb_build_object(
      'name', v_activity.name,
      'slug', v_activity.slug,
      'plan_links', v_plan_links,
      'recurring_rules', v_recurring_rules,
      'rule_exceptions', v_rule_exceptions,
      'session_exceptions', v_session_exceptions,
      'sessions', v_sessions,
      'bookings', v_bookings,
      'attendance', v_attendance
    )
  );

  delete from public.class_recurring_rule_exceptions e
  where e.recurring_rule_id = any(v_rule_ids)
     or e.class_session_id = any(v_session_ids);

  delete from public.attendance att
  where att.session_id = any(v_session_ids);

  delete from public.bookings b
  where b.session_id = any(v_session_ids);

  delete from public.class_sessions s
  where s.id = any(v_session_ids);

  delete from public.class_recurring_rules r
  where r.id = any(v_rule_ids);

  delete from public.plan_activities pa
  where pa.activity_id = p_activity_id;

  delete from public.activities a
  where a.id = p_activity_id;

  return jsonb_build_object(
    'action', 'deleted',
    'activity_id', p_activity_id,
    'deleted_plan_links', v_plan_links,
    'deleted_recurring_rules', v_recurring_rules,
    'deleted_rule_exceptions', v_rule_exceptions,
    'deleted_session_exceptions', v_session_exceptions,
    'deleted_sessions', v_sessions,
    'deleted_bookings', v_bookings,
    'deleted_attendance', v_attendance
  );
end;
$$;

do $$
declare
  v_future_from timestamptz := timestamptz '2026-05-30 00:00:00-03';
  v_desired_count integer;
  v_missing_activity_count integer;
begin
  create temporary table ran34_plan2_desired (
    weekday int not null,
    start_time time not null,
    end_time time not null,
    slug text not null,
    capacity int not null
  ) on commit drop;

  insert into ran34_plan2_desired (weekday, start_time, end_time, slug, capacity)
  values
    -- 07:00-08:00
    (1, time '07:00', time '08:00', 'semi_personalizado', 10),
    (3, time '07:00', time '08:00', 'semi_personalizado', 10),
    (5, time '07:00', time '08:00', 'semi_personalizado', 10),
    (2, time '07:00', time '08:00', 'personalizado', 10),
    (4, time '07:00', time '08:00', 'personalizado', 10),
    -- 08:00-09:00
    (1, time '08:00', time '09:00', 'neurofuncional', 10),
    (3, time '08:00', time '09:00', 'neurofuncional', 10),
    (5, time '08:00', time '09:00', 'neurofuncional', 10),
    (2, time '08:00', time '09:00', 'semi_personalizado', 10),
    (4, time '08:00', time '09:00', 'semi_personalizado', 10),
    -- 09:00-10:00
    (1, time '09:00', time '10:00', 'semi_personalizado', 10),
    (3, time '09:00', time '10:00', 'semi_personalizado', 10),
    (5, time '09:00', time '10:00', 'semi_personalizado', 10),
    (2, time '09:00', time '10:00', 'semi_personalizado', 10),
    (4, time '09:00', time '10:00', 'semi_personalizado', 10),
    -- 10:00-11:00
    (1, time '10:00', time '11:00', 'personalizado', 10),
    (3, time '10:00', time '11:00', 'personalizado', 10),
    (5, time '10:00', time '11:00', 'personalizado', 10),
    (2, time '10:00', time '11:00', 'personalizado', 10),
    (4, time '10:00', time '11:00', 'personalizado', 10),
    -- 11:00-15:00 is receso/cerrado: no class is created.
    -- 14:00-15:00
    (1, time '14:00', time '15:00', 'cognitivo', 5),
    (3, time '14:00', time '15:00', 'cognitivo', 5),
    (5, time '14:00', time '15:00', 'cognitivo', 5),
    (2, time '14:00', time '15:00', 'semi_personalizado', 5),
    (4, time '14:00', time '15:00', 'semi_personalizado', 5),
    -- 15:00-16:00
    (1, time '15:00', time '16:00', 'semi_personalizado', 10),
    (3, time '15:00', time '16:00', 'semi_personalizado', 10),
    (5, time '15:00', time '16:00', 'semi_personalizado', 10),
    (2, time '15:00', time '16:00', 'semi_personalizado', 10),
    (4, time '15:00', time '16:00', 'semi_personalizado', 10),
    -- 16:00-17:00
    (1, time '16:00', time '17:00', 'semi_personalizado', 10),
    (3, time '16:00', time '17:00', 'semi_personalizado', 10),
    (5, time '16:00', time '17:00', 'semi_personalizado', 10),
    (2, time '16:00', time '17:00', 'semi_personalizado', 10),
    (4, time '16:00', time '17:00', 'semi_personalizado', 10),
    -- 17:00-18:00
    (1, time '17:00', time '18:00', 'semi_personalizado', 10),
    (3, time '17:00', time '18:00', 'semi_personalizado', 10),
    (5, time '17:00', time '18:00', 'semi_personalizado', 10),
    (2, time '17:00', time '18:00', 'personalizado', 10),
    (4, time '17:00', time '18:00', 'personalizado', 10),
    -- 18:00-19:00
    (1, time '18:00', time '19:00', 'neurofuncional', 10),
    (3, time '18:00', time '19:00', 'neurofuncional', 10),
    (5, time '18:00', time '19:00', 'neurofuncional', 10),
    (2, time '18:00', time '19:00', 'semi_personalizado', 10),
    (4, time '18:00', time '19:00', 'semi_personalizado', 10),
    -- 19:00-20:00
    (1, time '19:00', time '20:00', 'semi_personalizado', 10),
    (3, time '19:00', time '20:00', 'semi_personalizado', 10),
    (5, time '19:00', time '20:00', 'semi_personalizado', 10),
    (2, time '19:00', time '20:00', 'semi_personalizado', 10),
    (4, time '19:00', time '20:00', 'semi_personalizado', 10);

  select count(*) into v_desired_count
  from ran34_plan2_desired;

  if v_desired_count <> 50 then
    raise exception 'RAN-34 Plan de Actividades 2 esperaba 50 reglas, encontro %.', v_desired_count;
  end if;

  select count(*) into v_missing_activity_count
  from ran34_plan2_desired d
  left join public.activities a on a.slug = d.slug and a.active = true
  where a.id is null;

  if v_missing_activity_count > 0 then
    raise exception 'Faltan actividades activas para Plan de Actividades 2.';
  end if;

  create temporary table ran34_plan2_desired_rules on commit drop as
  select
    d.weekday,
    d.start_time,
    d.end_time,
    d.slug,
    d.capacity,
    a.id as activity_id,
    a.name as activity_name
  from ran34_plan2_desired d
  join public.activities a on a.slug = d.slug and a.active = true;

  create temporary table ran34_plan2_wrong_rules on commit drop as
  select
    r.id as rule_id,
    r.activity_id,
    a.slug,
    a.name as activity_name,
    r.weekday,
    r.start_time,
    r.end_time
  from public.class_recurring_rules r
  join public.activities a on a.id = r.activity_id
  left join ran34_plan2_desired_rules d
    on d.activity_id = r.activity_id
   and d.weekday = r.weekday
   and d.start_time = r.start_time
   and d.end_time = r.end_time
  where r.active = true
    and a.slug in ('semi_personalizado', 'personalizado', 'neurofuncional', 'cognitivo')
    and d.activity_id is null;

  -- Normalize existing desired rules without changing deleted/inactive rules.
  update public.class_recurring_rules r
  set
    title = d.activity_name,
    capacity = d.capacity,
    valid_until = null,
    updated_at = now()
  from ran34_plan2_desired_rules d
  where r.active = true
    and r.activity_id = d.activity_id
    and r.weekday = d.weekday
    and r.start_time = d.start_time
    and r.end_time = d.end_time;

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
  select
    d.activity_id,
    d.activity_name,
    d.weekday,
    d.start_time,
    d.end_time,
    d.capacity,
    null,
    'Cronograma semanal definitivo - Plan de Actividades 2',
    true,
    date '2026-05-18',
    null,
    null
  from ran34_plan2_desired_rules d
  where not exists (
    select 1
    from public.class_recurring_rules r
    where r.active = true
      and r.activity_id = d.activity_id
      and r.weekday = d.weekday
      and r.start_time = d.start_time
      and r.end_time = d.end_time
      and r.valid_from <= date '9999-12-31'
      and date '2026-05-18' <= coalesce(r.valid_until, date '9999-12-31')
  );

  create temporary table ran34_plan2_rule_map on commit drop as
  select distinct on (d.activity_id, d.weekday, d.start_time, d.end_time)
    d.*,
    r.id as desired_rule_id
  from ran34_plan2_desired_rules d
  join public.class_recurring_rules r
    on r.active = true
   and r.activity_id = d.activity_id
   and r.weekday = d.weekday
   and r.start_time = d.start_time
   and r.end_time = d.end_time
  order by d.activity_id, d.weekday, d.start_time, d.end_time, r.valid_from desc, r.created_at desc;

  create temporary table ran34_plan2_wrong_sessions on commit drop as
  select
    s.id as session_id,
    s.recurring_rule_id as old_rule_id,
    s.starts_at,
    s.ends_at,
    s.activity_id as current_activity_id,
    coalesce(bookings.count, 0) as bookings_count,
    coalesce(attendance.count, 0) as attendance_count,
    exists (
      select 1
      from public.class_recurring_rule_exceptions e
      where e.class_session_id = s.id
        and e.action = 'edited'
    ) as has_edited_exception,
    d.desired_rule_id,
    d.activity_id as desired_activity_id,
    d.activity_name as desired_activity_name,
    d.capacity as desired_capacity
  from public.class_sessions s
  join ran34_plan2_wrong_rules wr on wr.rule_id = s.recurring_rule_id
  left join lateral (
    select count(*)::int as count
    from public.bookings b
    where b.session_id = s.id
  ) bookings on true
  left join lateral (
    select count(*)::int as count
    from public.attendance att
    where att.session_id = s.id
  ) attendance on true
  left join ran34_plan2_rule_map d
    on d.weekday = extract(dow from s.starts_at at time zone 'America/Argentina/Buenos_Aires')::int
   and d.start_time = ((s.starts_at at time zone 'America/Argentina/Buenos_Aires')::time)
   and d.end_time = ((s.ends_at at time zone 'America/Argentina/Buenos_Aires')::time)
  where s.starts_at >= v_future_from;

  -- Preserve manually edited future occurrences by moving them to the rule that
  -- now owns their day/time in Plan de Actividades 2. This keeps the session id
  -- and avoids leaving active sessions attached to archived rules.
  update public.class_sessions s
  set
    recurring_rule_id = ws.desired_rule_id,
    activity_id = ws.desired_activity_id,
    title = ws.desired_activity_name,
    capacity = ws.desired_capacity,
    active = true,
    cancelled_at = null,
    cancelled_by = null,
    cancel_reason = null,
    updated_at = now()
  from ran34_plan2_wrong_sessions ws
  where s.id = ws.session_id
    and ws.has_edited_exception = true
    and ws.bookings_count = 0
    and ws.attendance_count = 0
    and ws.desired_rule_id is not null
    and not exists (
      select 1
      from public.class_sessions existing
      where existing.id <> s.id
        and existing.activity_id = ws.desired_activity_id
        and existing.starts_at = s.starts_at
        and existing.ends_at = s.ends_at
        and existing.active = true
        and existing.cancelled_at is null
    );

  -- Future sessions from rules that no longer match the approved matrix are
  -- safe to remove only when they do not carry bookings, attendance, or an
  -- edited exception that was rehomed above.
  delete from public.class_sessions s
  using ran34_plan2_wrong_sessions ws
  where s.id = ws.session_id
    and ws.bookings_count = 0
    and ws.attendance_count = 0
    and (
      ws.has_edited_exception is false
      or ws.desired_rule_id is null
      or exists (
        select 1
        from public.class_sessions existing
        where existing.id <> s.id
          and existing.activity_id = coalesce(ws.desired_activity_id, s.activity_id)
          and existing.starts_at = s.starts_at
          and existing.ends_at = s.ends_at
          and existing.active = true
          and existing.cancelled_at is null
      )
    );

  update public.class_sessions s
  set
    active = false,
    cancelled_at = coalesce(s.cancelled_at, now()),
    cancel_reason = coalesce(s.cancel_reason, 'Horario fuera de Plan de Actividades 2'),
    updated_at = now()
  from ran34_plan2_wrong_sessions ws
  where s.id = ws.session_id
    and (ws.bookings_count > 0 or ws.attendance_count > 0);

  update public.class_recurring_rules r
  set active = false,
      updated_at = now()
  from ran34_plan2_wrong_rules wr
  where r.id = wr.rule_id;
end;
$$;

revoke all on function public.admin_delete_activity(uuid) from public, anon;
grant execute on function public.admin_delete_activity(uuid) to authenticated;
