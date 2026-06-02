-- RAN-34 follow-up:
-- Require explicit backend confirmation before hard-deleting a class activity.
-- The operational cleanup behavior is intentionally unchanged.

drop function if exists public.admin_delete_activity(uuid);

create or replace function public.admin_delete_activity(
  p_activity_id uuid,
  p_confirm text
)
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

  if p_confirm is distinct from 'ELIMINAR' then
    raise exception 'Para eliminar la actividad principal escribi ELIMINAR.';
  end if;

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
      'memberships_deleted', 0,
      'confirm_required', true
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

revoke all on function public.admin_delete_activity(uuid, text) from public, anon;
grant execute on function public.admin_delete_activity(uuid, text) to authenticated;
