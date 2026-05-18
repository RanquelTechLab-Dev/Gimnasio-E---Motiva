-- RANV2-13: safe admin archive/delete helpers.
-- Admin-only RPCs. Physical delete is allowed only when there is no operational history.

create or replace function public.admin_deactivate_student(p_student_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_actor uuid;
  v_student public.profiles%rowtype;
begin
  v_actor := private.ensure_admin();

  select * into v_student
  from public.profiles p
  where p.id = p_student_id
    and p.role = 'student'
  for update;

  if not found then
    raise exception 'No se encontro el alumno.';
  end if;

  update public.profiles p
  set active = false
  where p.id = p_student_id;

  insert into public.audit_logs (actor_id, entity_type, entity_id, action, metadata)
  values (
    v_actor,
    'student',
    p_student_id,
    'student.deactivated',
    jsonb_build_object('email', v_student.email)
  );

  return jsonb_build_object('action', 'deactivated', 'student_id', p_student_id);
end;
$$;

create or replace function public.admin_delete_student(p_student_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_actor uuid;
  v_student public.profiles%rowtype;
  v_memberships integer;
  v_payments integer;
  v_bookings integer;
  v_attendance integer;
  v_files integer;
  v_training_notes integer;
  v_audit_logs integer;
  v_total_history integer;
begin
  v_actor := private.ensure_admin();

  select * into v_student
  from public.profiles p
  where p.id = p_student_id
    and p.role = 'student'
  for update;

  if not found then
    raise exception 'No se encontro el alumno.';
  end if;

  select count(*) into v_memberships from public.memberships m where m.student_id = p_student_id;
  select count(*) into v_payments from public.payments p where p.student_id = p_student_id;
  select count(*) into v_bookings from public.bookings b where b.student_id = p_student_id;
  select count(*) into v_attendance from public.attendance a where a.student_id = p_student_id;
  select count(*) into v_files from public.files f where f.student_id = p_student_id;
  select count(*) into v_training_notes from public.training_notes tn where tn.student_id = p_student_id;
  select count(*) into v_audit_logs
  from public.audit_logs al
  where al.actor_id = p_student_id
     or (al.entity_type in ('student', 'profile') and al.entity_id = p_student_id);

  v_total_history :=
    v_memberships + v_payments + v_bookings + v_attendance +
    v_files + v_training_notes + v_audit_logs;

  if v_total_history > 0 then
    raise exception 'Este alumno tiene historial. No se puede eliminar sin romper registros. Podes desactivarlo.';
  end if;

  delete from public.profiles p
  where p.id = p_student_id;

  insert into public.audit_logs (actor_id, entity_type, entity_id, action, metadata)
  values (
    v_actor,
    'student',
    p_student_id,
    'student.deleted',
    jsonb_build_object('email', v_student.email)
  );

  return jsonb_build_object('action', 'deleted', 'student_id', p_student_id);
end;
$$;

create or replace function public.admin_archive_plan(p_plan_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_actor uuid;
  v_plan public.plans%rowtype;
begin
  v_actor := private.ensure_admin();

  select * into v_plan
  from public.plans p
  where p.id = p_plan_id
  for update;

  if not found then
    raise exception 'No se encontro el plan.';
  end if;

  update public.plans p
  set active = false
  where p.id = p_plan_id;

  insert into public.audit_logs (actor_id, entity_type, entity_id, action, metadata)
  values (
    v_actor,
    'plan',
    p_plan_id,
    'plan.archived',
    jsonb_build_object('name', v_plan.name, 'slug', v_plan.slug)
  );

  return jsonb_build_object('action', 'archived', 'plan_id', p_plan_id);
end;
$$;

create or replace function public.admin_delete_plan(p_plan_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_actor uuid;
  v_plan public.plans%rowtype;
  v_memberships integer;
  v_payments integer;
begin
  v_actor := private.ensure_admin();

  select * into v_plan
  from public.plans p
  where p.id = p_plan_id
  for update;

  if not found then
    raise exception 'No se encontro el plan.';
  end if;

  select count(*) into v_memberships
  from public.memberships m
  where m.plan_id = p_plan_id;

  select count(*) into v_payments
  from public.payments p
  join public.memberships m on m.id = p.membership_id
  where m.plan_id = p_plan_id;

  if v_memberships + v_payments > 0 then
    raise exception 'Este plan tiene historial. No se puede eliminar, pero podes archivarlo para que no aparezca en nuevas asignaciones.';
  end if;

  delete from public.plans p
  where p.id = p_plan_id;

  insert into public.audit_logs (actor_id, entity_type, entity_id, action, metadata)
  values (
    v_actor,
    'plan',
    p_plan_id,
    'plan.deleted',
    jsonb_build_object('name', v_plan.name, 'slug', v_plan.slug)
  );

  return jsonb_build_object('action', 'deleted', 'plan_id', p_plan_id);
end;
$$;

create or replace function public.admin_delete_class_session(p_session_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_actor uuid;
  v_session public.class_sessions%rowtype;
  v_bookings integer;
  v_attendance integer;
begin
  v_actor := private.ensure_admin();

  select * into v_session
  from public.class_sessions s
  where s.id = p_session_id
  for update;

  if not found then
    raise exception 'La clase no existe.';
  end if;

  select count(*) into v_bookings
  from public.bookings b
  where b.session_id = p_session_id;

  select count(*) into v_attendance
  from public.attendance a
  where a.session_id = p_session_id;

  if v_bookings + v_attendance > 0 then
    raise exception 'Esta clase tiene historial. No se puede eliminar; podes cancelarla.';
  end if;

  delete from public.class_sessions s
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
      'capacity', v_session.capacity
    )
  );

  return jsonb_build_object('action', 'deleted', 'session_id', p_session_id);
end;
$$;

revoke all on function public.admin_deactivate_student(uuid) from public, anon;
revoke all on function public.admin_delete_student(uuid) from public, anon;
revoke all on function public.admin_archive_plan(uuid) from public, anon;
revoke all on function public.admin_delete_plan(uuid) from public, anon;
revoke all on function public.admin_delete_class_session(uuid) from public, anon;

grant execute on function public.admin_deactivate_student(uuid) to authenticated;
grant execute on function public.admin_delete_student(uuid) to authenticated;
grant execute on function public.admin_archive_plan(uuid) to authenticated;
grant execute on function public.admin_delete_plan(uuid) to authenticated;
grant execute on function public.admin_delete_class_session(uuid) to authenticated;
