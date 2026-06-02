-- RAN-34: manage assigned student programs from Admin > Students.
--
-- "Program" is the UI name for the existing memberships model.
-- This migration adds admin RPCs to list, edit and remove assigned programs.
--
-- Safety:
-- - No payments, students/profiles, plans, audit logs or files are deleted.
-- - A program with no payments/bookings/attendance can be hard-deleted.
-- - A program with history is marked cancelled and future active bookings are
--   cancelled with audit trail, preserving payments and historical records.

create or replace function public.admin_list_student_programs(p_student_id uuid default null)
returns table (
  program_id uuid,
  student_id uuid,
  plan_id uuid,
  plan_name text,
  plan_type text,
  status public.membership_status,
  start_date date,
  end_date date,
  remaining_credits integer,
  payments_count integer,
  future_active_bookings_count integer,
  future_bookings_count integer,
  past_bookings_count integer,
  attendance_count integer,
  last_payment_at timestamptz,
  has_history boolean,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_actor uuid := auth.uid();
begin
  if v_actor is null or not coalesce(private.is_admin(), false) then
    raise exception 'Solo un admin activo puede ver programas asignados.';
  end if;

  return query
  select
    m.id,
    m.student_id,
    m.plan_id,
    p.name,
    p.plan_type::text,
    m.status,
    m.start_date,
    m.end_date,
    m.remaining_credits,
    coalesce(payments.payments_count, 0)::int,
    coalesce(bookings.future_active_bookings_count, 0)::int,
    coalesce(bookings.future_bookings_count, 0)::int,
    coalesce(bookings.past_bookings_count, 0)::int,
    coalesce(bookings.attendance_count, 0)::int,
    payments.last_payment_at,
    (
      coalesce(payments.payments_count, 0)
      + coalesce(bookings.future_bookings_count, 0)
      + coalesce(bookings.past_bookings_count, 0)
      + coalesce(bookings.attendance_count, 0)
    ) > 0,
    m.created_at,
    m.updated_at
  from public.memberships m
  join public.plans p on p.id = m.plan_id
  left join lateral (
    select
      count(*)::int as payments_count,
      max(pay.paid_at) as last_payment_at
    from public.payments pay
    where pay.membership_id = m.id
  ) payments on true
  left join lateral (
    select
      count(*) filter (where b.status = 'booked'::public.booking_status and s.starts_at >= now())::int as future_active_bookings_count,
      count(*) filter (where s.starts_at >= now())::int as future_bookings_count,
      count(*) filter (where s.starts_at < now())::int as past_bookings_count,
      count(att.id)::int as attendance_count
    from public.bookings b
    join public.class_sessions s on s.id = b.session_id
    left join public.attendance att on att.booking_id = b.id
    where b.membership_id = m.id
  ) bookings on true
  where p_student_id is null or m.student_id = p_student_id
  order by m.created_at desc;
end;
$$;

create or replace function public.admin_update_student_program(
  p_program_id uuid,
  p_plan_id uuid,
  p_status public.membership_status,
  p_start_date date,
  p_end_date date,
  p_remaining_credits integer default null,
  p_confirm_history text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_actor uuid := auth.uid();
  v_membership public.memberships%rowtype;
  v_previous public.memberships%rowtype;
  v_plan public.plans%rowtype;
  v_payments_count integer := 0;
  v_bookings_count integer := 0;
  v_attendance_count integer := 0;
  v_has_history boolean := false;
  v_next_remaining_credits integer;
begin
  if v_actor is null or not coalesce(private.is_admin(), false) then
    raise exception 'Solo un admin activo puede editar programas asignados.';
  end if;

  if p_program_id is null or p_plan_id is null then
    raise exception 'Programa y plan son obligatorios.';
  end if;

  if p_status is null then
    raise exception 'El estado del programa es obligatorio.';
  end if;

  if p_start_date is null or p_end_date is null or p_end_date < p_start_date then
    raise exception 'El rango de fechas del programa no es valido.';
  end if;

  if p_remaining_credits is not null and p_remaining_credits < 0 then
    raise exception 'Las clases disponibles no pueden ser negativas.';
  end if;

  select m.* into v_membership
  from public.memberships m
  where m.id = p_program_id
  for update;

  if not found then
    raise exception 'El programa asignado no existe.';
  end if;

  v_previous := v_membership;

  select p.* into v_plan
  from public.plans p
  where p.id = p_plan_id
    and p.active = true;

  if not found then
    raise exception 'El plan no existe o no esta activo.';
  end if;

  select count(*)::int into v_payments_count
  from public.payments pay
  where pay.membership_id = v_membership.id;

  select count(*)::int into v_bookings_count
  from public.bookings b
  where b.membership_id = v_membership.id;

  select count(*)::int into v_attendance_count
  from public.attendance att
  join public.bookings b on b.id = att.booking_id
  where b.membership_id = v_membership.id;

  v_has_history := (v_payments_count + v_bookings_count + v_attendance_count) > 0;

  if v_has_history and coalesce(p_confirm_history, '') <> 'EDITAR' then
    raise exception 'Este programa tiene historial. Para confirmar la edicion escribi EDITAR.';
  end if;

  v_next_remaining_credits := case
    when v_plan.plan_type = 'weekly' then null
    when p_remaining_credits is not null then p_remaining_credits
    when v_plan.plan_type = 'package' then coalesce(v_membership.remaining_credits, v_plan.package_class_count, 0)
    else v_membership.remaining_credits
  end;

  update public.memberships
  set
    plan_id = p_plan_id,
    status = p_status,
    start_date = p_start_date,
    end_date = p_end_date,
    remaining_credits = v_next_remaining_credits,
    updated_at = now()
  where id = v_membership.id
  returning * into v_membership;

  insert into public.audit_logs (actor_id, entity_type, entity_id, action, metadata)
  values (
    v_actor,
    'membership',
    v_membership.id,
    'membership.program_updated',
    jsonb_build_object(
      'student_id', v_membership.student_id,
      'has_history', v_has_history,
      'payments_count', v_payments_count,
      'bookings_count', v_bookings_count,
      'attendance_count', v_attendance_count,
      'previous', jsonb_build_object(
        'plan_id', v_previous.plan_id,
        'status', v_previous.status,
        'start_date', v_previous.start_date,
        'end_date', v_previous.end_date,
        'remaining_credits', v_previous.remaining_credits
      ),
      'current', jsonb_build_object(
        'plan_id', v_membership.plan_id,
        'status', v_membership.status,
        'start_date', v_membership.start_date,
        'end_date', v_membership.end_date,
        'remaining_credits', v_membership.remaining_credits
      )
    )
  );

  return jsonb_build_object(
    'action', 'updated',
    'membership_id', v_membership.id,
    'student_id', v_membership.student_id,
    'plan_id', v_membership.plan_id,
    'has_history', v_has_history
  );
end;
$$;

create or replace function public.admin_delete_student_program(
  p_program_id uuid,
  p_confirm text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_actor uuid := auth.uid();
  v_membership public.memberships%rowtype;
  v_payments_count integer := 0;
  v_bookings_count integer := 0;
  v_attendance_count integer := 0;
  v_future_active_bookings_count integer := 0;
  v_returned_credits integer := 0;
  v_has_history boolean := false;
  v_deleted_physically boolean := false;
begin
  if v_actor is null or not coalesce(private.is_admin(), false) then
    raise exception 'Solo un admin activo puede eliminar programas asignados.';
  end if;

  if p_program_id is null then
    raise exception 'El programa asignado es obligatorio.';
  end if;

  if coalesce(p_confirm, '') <> 'ELIMINAR' then
    raise exception 'Para eliminar el programa asignado escribi ELIMINAR.';
  end if;

  select m.* into v_membership
  from public.memberships m
  where m.id = p_program_id
  for update;

  if not found then
    raise exception 'El programa asignado no existe.';
  end if;

  select count(*)::int into v_payments_count
  from public.payments pay
  where pay.membership_id = v_membership.id;

  select count(*)::int into v_bookings_count
  from public.bookings b
  where b.membership_id = v_membership.id;

  select count(*)::int into v_attendance_count
  from public.attendance att
  join public.bookings b on b.id = att.booking_id
  where b.membership_id = v_membership.id;

  select count(*)::int into v_future_active_bookings_count
  from public.bookings b
  join public.class_sessions s on s.id = b.session_id
  where b.membership_id = v_membership.id
    and b.status = 'booked'::public.booking_status
    and s.starts_at >= now();

  v_has_history := (v_payments_count + v_bookings_count + v_attendance_count) > 0;

  if not v_has_history then
    insert into public.audit_logs (actor_id, entity_type, entity_id, action, metadata)
    values (
      v_actor,
      'membership',
      v_membership.id,
      'membership.program_deleted',
      jsonb_build_object(
        'student_id', v_membership.student_id,
        'plan_id', v_membership.plan_id,
        'has_history', false,
        'deleted_physically', true
      )
    );

    delete from public.memberships m
    where m.id = v_membership.id;

    v_deleted_physically := true;
  else
    select coalesce(sum(b.credits_charged), 0)::int into v_returned_credits
    from public.bookings b
    join public.class_sessions s on s.id = b.session_id
    where b.membership_id = v_membership.id
      and b.status = 'booked'::public.booking_status
      and s.starts_at >= now()
      and b.credits_charged > 0
      and b.credit_returned_at is null;

    if v_returned_credits > 0 then
      update public.memberships
      set
        remaining_credits = remaining_credits + v_returned_credits,
        updated_at = now()
      where id = v_membership.id
        and remaining_credits is not null
      returning * into v_membership;
    end if;

    update public.bookings b
    set
      status = 'cancelled'::public.booking_status,
      cancelled_at = now(),
      cancelled_by = v_actor,
      cancel_reason = 'Programa asignado eliminado desde ficha del alumno.',
      charged_as_attended = false,
      credit_returned_at = case
        when b.credits_charged > 0 and b.credit_returned_at is null then now()
        else b.credit_returned_at
      end,
      updated_at = now()
    from public.class_sessions s
    where s.id = b.session_id
      and b.membership_id = v_membership.id
      and b.status = 'booked'::public.booking_status
      and s.starts_at >= now();

    update public.memberships
    set
      status = 'cancelled'::public.membership_status,
      updated_at = now()
    where id = v_membership.id
    returning * into v_membership;

    insert into public.audit_logs (actor_id, entity_type, entity_id, action, metadata)
    values (
      v_actor,
      'membership',
      v_membership.id,
      'membership.program_deleted',
      jsonb_build_object(
        'student_id', v_membership.student_id,
        'plan_id', v_membership.plan_id,
        'has_history', true,
        'deleted_physically', false,
        'stored_status', v_membership.status,
        'payments_count', v_payments_count,
        'bookings_count', v_bookings_count,
        'attendance_count', v_attendance_count,
        'future_active_bookings_cancelled', v_future_active_bookings_count,
        'credits_returned', v_returned_credits
      )
    );
  end if;

  return jsonb_build_object(
    'action', 'deleted',
    'membership_id', p_program_id,
    'student_id', v_membership.student_id,
    'plan_id', v_membership.plan_id,
    'has_history', v_has_history,
    'deleted_physically', v_deleted_physically,
    'future_active_bookings_cancelled', v_future_active_bookings_count,
    'credits_returned', v_returned_credits
  );
end;
$$;

revoke all on function public.admin_list_student_programs(uuid) from public, anon;
revoke all on function public.admin_update_student_program(uuid, uuid, public.membership_status, date, date, integer, text) from public, anon;
revoke all on function public.admin_delete_student_program(uuid, text) from public, anon;

grant execute on function public.admin_list_student_programs(uuid) to authenticated;
grant execute on function public.admin_update_student_program(uuid, uuid, public.membership_status, date, date, integer, text) to authenticated;
grant execute on function public.admin_delete_student_program(uuid, text) to authenticated;
