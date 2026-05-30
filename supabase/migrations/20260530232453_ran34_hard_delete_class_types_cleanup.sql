-- RAN-34 follow-up:
-- Hard delete class types and their operational children.
--
-- Scope intentionally limited to activities/class type cleanup.
-- This does not delete plans, prices, students, real payments, memberships,
-- files, Drive data, Mailjet data, auth users, or audit logs.

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

  select coalesce(array_agg(distinct s.id), array[]::uuid[]) into v_session_ids
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
      'attendance', v_attendance,
      'plans_deleted', 0,
      'students_deleted', 0,
      'payments_deleted', 0,
      'memberships_deleted', 0
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
    'deleted_attendance', v_attendance,
    'deleted_plans', 0,
    'deleted_students', 0,
    'deleted_payments', 0,
    'deleted_memberships', 0
  );
end;
$$;

do $$
begin
  -- Keep only class types used by Plan de Actividades 2.
  create temporary table ran34_activity_delete_scope as
  select a.id, a.name, a.slug
  from public.activities a
  where a.slug not in (
    'semi_personalizado',
    'neurofuncional',
    'personalizado_1_1',
    'cognitivo'
  );

  create temporary table ran34_rule_delete_scope as
  select r.id, r.activity_id
  from public.class_recurring_rules r
  join ran34_activity_delete_scope a on a.id = r.activity_id;

  create temporary table ran34_session_delete_scope as
  select distinct s.id
  from public.class_sessions s
  left join ran34_activity_delete_scope a on a.id = s.activity_id
  left join ran34_rule_delete_scope r on r.id = s.recurring_rule_id
  where a.id is not null
     or r.id is not null;

  insert into public.audit_logs (actor_id, entity_type, entity_id, action, metadata)
  select
    null,
    'activity',
    a.id,
    'activity.deleted_with_operational_cleanup',
    jsonb_build_object(
      'name', a.name,
      'slug', a.slug,
      'plan_links', (
        select count(*)
        from public.plan_activities pa
        where pa.activity_id = a.id
      ),
      'recurring_rules', (
        select count(*)
        from public.class_recurring_rules r
        where r.activity_id = a.id
      ),
      'sessions', (
        select count(distinct s.id)
        from public.class_sessions s
        left join public.class_recurring_rules r on r.id = s.recurring_rule_id
        where s.activity_id = a.id
           or r.activity_id = a.id
      ),
      'bookings', (
        select count(*)
        from public.bookings b
        where b.session_id in (
          select s.id
          from public.class_sessions s
          left join public.class_recurring_rules r on r.id = s.recurring_rule_id
          where s.activity_id = a.id
             or r.activity_id = a.id
        )
      ),
      'attendance', (
        select count(*)
        from public.attendance att
        where att.session_id in (
          select s.id
          from public.class_sessions s
          left join public.class_recurring_rules r on r.id = s.recurring_rule_id
          where s.activity_id = a.id
             or r.activity_id = a.id
        )
      ),
      'plans_deleted', 0,
      'students_deleted', 0,
      'payments_deleted', 0,
      'memberships_deleted', 0,
      'cleanup_source', 'RAN-34 Plan de Actividades 2'
    )
  from ran34_activity_delete_scope a;

  delete from public.class_recurring_rule_exceptions e
  where e.recurring_rule_id in (select id from ran34_rule_delete_scope)
     or e.class_session_id in (select id from ran34_session_delete_scope);

  delete from public.attendance att
  where att.session_id in (select id from ran34_session_delete_scope);

  delete from public.bookings b
  where b.session_id in (select id from ran34_session_delete_scope);

  delete from public.class_sessions s
  where s.id in (select id from ran34_session_delete_scope);

  delete from public.class_recurring_rules r
  where r.id in (select id from ran34_rule_delete_scope);

  delete from public.plan_activities pa
  where pa.activity_id in (select id from ran34_activity_delete_scope);

  delete from public.activities a
  where a.id in (select id from ran34_activity_delete_scope);
end;
$$;

revoke all on function public.admin_delete_activity(uuid) from public, anon;
grant execute on function public.admin_delete_activity(uuid) to authenticated;
