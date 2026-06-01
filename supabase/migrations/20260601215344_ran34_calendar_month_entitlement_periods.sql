-- RAN-34: use calendar-month membership entitlement periods.
--
-- Manual payments should grant access from the selected payment date through
-- the same calendar day of the following month, inclusive. Example:
-- 2026-06-01 -> 2026-07-01, not 2026-06-30.
--
-- This migration does not delete payments, memberships, students/profiles,
-- plans, bookings, attendance, files or audit logs.

create or replace function public.register_manual_payment(
  student_id uuid,
  membership_id uuid,
  amount numeric,
  method public.payment_method,
  notes text default null,
  payment_date date default current_date
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_actor_id uuid := (select auth.uid());
  v_membership public.memberships%rowtype;
  v_payment public.payments%rowtype;
  v_plan public.plans%rowtype;
  v_student public.profiles%rowtype;
  v_paid_at timestamptz;
  v_next_start date;
  v_next_end date;
  v_previous_approved_payments int;
  v_next_remaining_credits int;
  v_is_active_renewal boolean;
begin
  if not coalesce(private.is_admin(), false) then
    raise exception 'Solo un admin activo puede registrar pagos.';
  end if;

  if v_actor_id is null then
    raise exception 'Sesion requerida.';
  end if;

  if amount is null or amount < 0 then
    raise exception 'Monto invalido.';
  end if;

  if payment_date is null then
    raise exception 'Fecha de pago requerida.';
  end if;

  -- Noon UTC preserves the selected local calendar date for Argentina.
  v_paid_at := (payment_date::timestamp + time '12:00') at time zone 'UTC';

  select *
  into v_student
  from public.profiles p
  where p.id = register_manual_payment.student_id
    and p.role = 'student'::public.user_role;

  if not found then
    raise exception 'Alumno no encontrado.';
  end if;

  select *
  into v_membership
  from public.memberships m
  where m.id = register_manual_payment.membership_id
  for update;

  if not found then
    raise exception 'Membresia no encontrada.';
  end if;

  if v_membership.student_id <> register_manual_payment.student_id then
    raise exception 'La membresia no pertenece al alumno indicado.';
  end if;

  select *
  into v_plan
  from public.plans p
  where p.id = v_membership.plan_id;

  if not found then
    raise exception 'Plan de membresia no encontrado.';
  end if;

  select count(*) into v_previous_approved_payments
  from public.payments p
  where p.membership_id = v_membership.id
    and p.status = 'approved'::public.payment_status;

  v_is_active_renewal :=
    v_previous_approved_payments > 0
    and v_membership.end_date is not null
    and v_membership.end_date >= register_manual_payment.payment_date;

  v_next_start := case
    -- Active renewals keep the current start date so students do not lose
    -- access to classes in the period already paid.
    when v_is_active_renewal and v_membership.start_date is not null
      then v_membership.start_date
    -- First payments and expired memberships start on the selected payment date.
    else register_manual_payment.payment_date
  end;

  v_next_end := case
    -- Active renewals extend the current inclusive end date by one calendar month.
    when v_is_active_renewal
      then (v_membership.end_date + interval '1 month')::date
    -- First payments and expired memberships expire the same calendar day next month.
    else (register_manual_payment.payment_date + interval '1 month')::date
  end;

  v_next_remaining_credits := case
    when v_plan.plan_type = 'package' and v_is_active_renewal
      then coalesce(v_membership.remaining_credits, 0) + coalesce(v_plan.package_class_count, 0)
    when v_plan.plan_type = 'package' then v_plan.package_class_count
    else v_membership.remaining_credits
  end;

  insert into public.payments (
    student_id,
    membership_id,
    amount,
    method,
    status,
    paid_at,
    approved_at,
    approved_by,
    notes
  )
  values (
    register_manual_payment.student_id,
    register_manual_payment.membership_id,
    register_manual_payment.amount,
    register_manual_payment.method,
    'approved'::public.payment_status,
    v_paid_at,
    now(),
    v_actor_id,
    nullif(btrim(register_manual_payment.notes), '')
  )
  returning * into v_payment;

  update public.memberships
  set
    status = 'active'::public.membership_status,
    start_date = v_next_start,
    end_date = v_next_end,
    remaining_credits = v_next_remaining_credits,
    updated_at = now()
  where id = v_membership.id
  returning * into v_membership;

  update public.profiles
  set
    last_payment_at = now(),
    last_real_activity_at = now(),
    updated_at = now()
  where id = v_payment.student_id;

  insert into public.audit_logs (
    actor_id,
    entity_type,
    entity_id,
    action,
    metadata
  )
  values (
    v_actor_id,
    'payment',
    v_payment.id,
    'payment.registered_auto_approved',
    jsonb_build_object(
      'student_id', v_payment.student_id,
      'membership_id', v_payment.membership_id,
      'amount', v_payment.amount,
      'method', v_payment.method,
      'payment_date', register_manual_payment.payment_date,
      'paid_at', v_payment.paid_at,
      'previous_approved_payments', v_previous_approved_payments,
      'active_renewal', v_is_active_renewal,
      'membership_start_date', v_membership.start_date,
      'membership_end_date', v_membership.end_date,
      'remaining_credits', v_membership.remaining_credits
    )
  );

  return jsonb_build_object(
    'payment_id', v_payment.id,
    'payment_status', v_payment.status,
    'student_id', v_payment.student_id,
    'membership_id', v_membership.id,
    'membership_status', v_membership.status,
    'membership_start_date', v_membership.start_date,
    'membership_end_date', v_membership.end_date,
    'remaining_credits', v_membership.remaining_credits,
    'amount', v_payment.amount,
    'method', v_payment.method,
    'paid_at', v_payment.paid_at,
    'payment_date', register_manual_payment.payment_date
  );
end;
$$;

revoke all on function public.register_manual_payment(
  uuid,
  uuid,
  numeric,
  public.payment_method,
  text,
  date
) from public, anon;

grant execute on function public.register_manual_payment(
  uuid,
  uuid,
  numeric,
  public.payment_method,
  text,
  date
) to authenticated;

create or replace function public.register_manual_payment(
  student_id uuid,
  membership_id uuid,
  amount numeric,
  method public.payment_method,
  notes text default null
)
returns jsonb
language sql
security definer
set search_path = public, private
as $$
  select public.register_manual_payment(
    student_id,
    membership_id,
    amount,
    method,
    notes,
    current_date
  );
$$;

revoke all on function public.register_manual_payment(
  uuid,
  uuid,
  numeric,
  public.payment_method,
  text
) from public, anon;

grant execute on function public.register_manual_payment(
  uuid,
  uuid,
  numeric,
  public.payment_method,
  text
) to authenticated;

-- Repair active memberships created by the previous 30-day entitlement logic.
-- The update is limited to first auto-approved payments and keeps credits for
-- non-package plans unchanged.
with first_auto_approved_payment as (
  select
    p.id as payment_id,
    p.membership_id,
    p.paid_at::date as paid_date,
    pl.plan_type,
    pl.package_class_count,
    row_number() over (
      partition by p.membership_id
      order by coalesce(p.approved_at, p.created_at), p.id
    ) as approved_order
  from public.payments p
  join public.audit_logs al
    on al.entity_type = 'payment'
   and al.entity_id = p.id
   and al.action = 'payment.registered_auto_approved'
  join public.memberships m on m.id = p.membership_id
  join public.plans pl on pl.id = m.plan_id
  where p.status = 'approved'::public.payment_status
)
update public.memberships m
set
  start_date = f.paid_date,
  end_date = (f.paid_date + interval '1 month')::date,
  remaining_credits = case
    when f.plan_type = 'package' then f.package_class_count
    else m.remaining_credits
  end,
  updated_at = now()
from first_auto_approved_payment f
where f.membership_id = m.id
  and f.approved_order = 1
  and m.status = 'active'::public.membership_status
  and (
    m.start_date is distinct from f.paid_date
    or m.end_date is distinct from (f.paid_date + interval '1 month')::date
    or (
      f.plan_type = 'package'
      and m.remaining_credits is distinct from f.package_class_count
    )
  );
