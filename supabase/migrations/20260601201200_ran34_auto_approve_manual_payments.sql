-- RAN-34: manual admin payments are approved immediately.
-- This migration only redefines register_manual_payment.
-- It does not delete payments, memberships, students/profiles, plans,
-- bookings, attendance, files or audit logs.

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

  v_next_start := case
    when v_membership.end_date >= register_manual_payment.payment_date
      then v_membership.end_date + 1
    else register_manual_payment.payment_date
  end;
  v_next_end := v_next_start + (v_plan.billing_period_days - 1);

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
      'membership_start_date', v_membership.start_date,
      'membership_end_date', v_membership.end_date
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
