-- RAN-34: reconcile payment validity with assigned programs.
--
-- Safety:
-- - No payments, students/profiles, plans, audit logs, files or auth users are
--   deleted.
-- - Payments remain historical rows; voided payments do not count as paid.
-- - Future active bookings are cancelled only when the linked program loses
--   payment validity or falls outside its corrected validity window.

alter table public.payments
add column if not exists membership_start_date date,
add column if not exists membership_end_date date;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'payments_membership_validity_dates'
      and conrelid = 'public.payments'::regclass
  ) then
    alter table public.payments
      add constraint payments_membership_validity_dates
      check (
        membership_start_date is null
        or membership_end_date is null
        or membership_end_date >= membership_start_date
      );
  end if;
end;
$$;

create or replace function private.membership_approved_paid_total(p_membership_id uuid)
returns numeric
language sql
stable
security definer
set search_path = public, private
as $$
  select coalesce(sum(pay.amount), 0)::numeric(12, 2)
  from public.payments pay
  where pay.membership_id = p_membership_id
    and pay.status = 'approved'::public.payment_status;
$$;

create or replace function private.membership_required_amount(p_membership_id uuid)
returns numeric
language sql
stable
security definer
set search_path = public, private
as $$
  select m.required_amount::numeric(12, 2)
  from public.memberships m
  where m.id = p_membership_id;
$$;

create or replace function private.membership_is_fully_paid(p_membership_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, private
as $$
  select coalesce(
    private.membership_approved_paid_total(p_membership_id)
      >= private.membership_required_amount(p_membership_id),
    false
  );
$$;

create or replace function private.payment_validity_start(
  p_payment public.payments,
  p_default_date date
)
returns date
language sql
stable
security definer
set search_path = public, private
as $$
  select coalesce(
    p_payment.membership_start_date,
    (p_payment.paid_at at time zone 'America/Argentina/Buenos_Aires')::date,
    p_default_date
  );
$$;

create or replace function private.payment_validity_end(
  p_payment public.payments,
  p_plan public.plans,
  p_default_date date
)
returns date
language sql
stable
security definer
set search_path = public, private
as $$
  select coalesce(
    p_payment.membership_end_date,
    (private.payment_validity_start(p_payment, p_default_date)
      + interval '1 month')::date,
    p_default_date
  );
$$;

create or replace function private.reconcile_membership_payment_state(
  p_membership_id uuid,
  p_actor_id uuid default null,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_membership public.memberships%rowtype;
  v_previous public.memberships%rowtype;
  v_plan public.plans%rowtype;
  v_approved_paid_total numeric(12, 2) := 0;
  v_required_amount numeric(12, 2) := 0;
  v_pending_amount numeric(12, 2) := 0;
  v_is_fully_paid boolean := false;
  v_latest_payment public.payments%rowtype;
  v_next_start date;
  v_next_end date;
  v_future_active_bookings_count integer := 0;
  v_returned_credits integer := 0;
  v_action text := 'unchanged';
begin
  if p_membership_id is null then
    return jsonb_build_object('action', 'skipped', 'reason', 'no_membership');
  end if;

  select *
  into v_membership
  from public.memberships m
  where m.id = p_membership_id
  for update;

  if not found then
    return jsonb_build_object('action', 'skipped', 'reason', 'membership_not_found');
  end if;

  v_previous := v_membership;

  select *
  into v_plan
  from public.plans p
  where p.id = v_membership.plan_id;

  if not found then
    return jsonb_build_object('action', 'skipped', 'reason', 'plan_not_found');
  end if;

  v_required_amount := private.membership_required_amount(v_membership.id);
  if v_required_amount is null then
    raise exception 'El programa no tiene monto congelado requerido.';
  end if;

  v_approved_paid_total := private.membership_approved_paid_total(v_membership.id);
  v_pending_amount := greatest(v_required_amount - v_approved_paid_total, 0)::numeric(12, 2);
  v_is_fully_paid := v_approved_paid_total >= v_required_amount;

  select *
  into v_latest_payment
  from public.payments pay
  where pay.membership_id = v_membership.id
    and pay.status = 'approved'::public.payment_status
  order by
    coalesce(pay.approved_at, pay.paid_at, pay.created_at) desc,
    pay.created_at desc
  limit 1;

  if v_is_fully_paid and v_membership.status <> 'cancelled'::public.membership_status then
    if found then
      v_next_start := private.payment_validity_start(
        v_latest_payment,
        v_membership.start_date
      );
      v_next_end := private.payment_validity_end(
        v_latest_payment,
        v_plan,
        v_next_start
      );
    else
      v_next_start := v_membership.start_date;
      v_next_end := v_membership.end_date;
    end if;

    if v_membership.status <> 'active'::public.membership_status
      or v_membership.start_date <> v_next_start
      or v_membership.end_date <> v_next_end then
      update public.memberships
      set
        status = 'active'::public.membership_status,
        start_date = v_next_start,
        end_date = v_next_end,
        updated_at = now()
      where id = v_membership.id
      returning * into v_membership;

      v_action := 'activated_or_validity_updated';
    end if;
  elsif v_is_fully_paid is false
    and v_membership.status <> 'cancelled'::public.membership_status
    and v_membership.status <> 'suspended'::public.membership_status then
    update public.memberships
    set
      status = 'suspended'::public.membership_status,
      updated_at = now()
    where id = v_membership.id
    returning * into v_membership;

    v_action := 'suspended_unpaid';
  end if;

  select
    count(*)::int,
    coalesce(sum(b.credits_charged) filter (
      where b.credits_charged > 0 and b.credit_returned_at is null
    ), 0)::int
  into v_future_active_bookings_count, v_returned_credits
  from public.bookings b
  join public.class_sessions s on s.id = b.session_id
  where b.membership_id = v_membership.id
    and b.status = 'booked'::public.booking_status
    and s.starts_at >= now()
    and (
      v_membership.status <> 'active'::public.membership_status
      or s.starts_at::date not between v_membership.start_date and v_membership.end_date
    );

  if v_future_active_bookings_count > 0 then
    update public.bookings b
    set
      status = 'cancelled'::public.booking_status,
      cancelled_at = now(),
      cancelled_by = p_actor_id,
      cancel_reason = coalesce(
        nullif(btrim(p_reason), ''),
        'Programa sin vigencia o pago completo.'
      ),
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
      and s.starts_at >= now()
      and (
        v_membership.status <> 'active'::public.membership_status
        or s.starts_at::date not between v_membership.start_date and v_membership.end_date
      );

    if v_returned_credits > 0 then
      update public.memberships
      set
        remaining_credits = remaining_credits + v_returned_credits,
        updated_at = now()
      where id = v_membership.id
        and remaining_credits is not null
      returning * into v_membership;
    end if;
  end if;

  if v_action <> 'unchanged' or v_future_active_bookings_count > 0 then
    insert into public.audit_logs (actor_id, entity_type, entity_id, action, metadata)
    values (
      p_actor_id,
      'membership',
      v_membership.id,
      'membership.payment_state_reconciled',
      jsonb_build_object(
        'reason', p_reason,
        'previous_status', v_previous.status,
        'current_status', v_membership.status,
        'previous_start_date', v_previous.start_date,
        'previous_end_date', v_previous.end_date,
        'current_start_date', v_membership.start_date,
        'current_end_date', v_membership.end_date,
        'approved_paid_total', v_approved_paid_total,
        'plan_price', v_plan.price,
        'required_amount', v_required_amount,
        'pending_amount', v_pending_amount,
        'is_fully_paid', v_is_fully_paid,
        'latest_approved_payment_id', v_latest_payment.id,
        'future_active_bookings_cancelled', v_future_active_bookings_count,
        'credits_returned', v_returned_credits
      )
    );
  end if;

  return jsonb_build_object(
    'action', v_action,
    'membership_id', v_membership.id,
    'previous_status', v_previous.status,
    'current_status', v_membership.status,
    'previous_start_date', v_previous.start_date,
    'previous_end_date', v_previous.end_date,
    'current_start_date', v_membership.start_date,
    'current_end_date', v_membership.end_date,
    'approved_paid_total', v_approved_paid_total,
    'plan_price', v_plan.price,
    'required_amount', v_required_amount,
    'pending_amount', v_pending_amount,
    'is_fully_paid', v_is_fully_paid,
    'latest_approved_payment_id', v_latest_payment.id,
    'future_active_bookings_cancelled', v_future_active_bookings_count,
    'credits_returned', v_returned_credits
  );
end;
$$;

drop function if exists public.register_manual_payment(
  uuid,
  uuid,
  numeric,
  public.payment_method,
  text,
  date
);

drop function if exists public.register_manual_payment(
  uuid,
  uuid,
  numeric,
  public.payment_method,
  text
);

create or replace function public.register_manual_payment(
  student_id uuid,
  membership_id uuid,
  amount numeric,
  method public.payment_method,
  notes text default null,
  payment_date date default current_date,
  membership_start_date date default null,
  membership_end_date date default null
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
  v_period_start date;
  v_period_end date;
  v_previous_approved_total numeric(12, 2);
  v_approved_paid_total numeric(12, 2);
  v_required_amount numeric(12, 2);
  v_pending_amount numeric(12, 2);
  v_was_fully_paid boolean;
  v_is_fully_paid boolean;
  v_is_active_renewal boolean;
  v_next_remaining_credits int;
  v_membership_reconciliation jsonb := '{}'::jsonb;
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
    raise exception 'Programa no encontrado.';
  end if;

  if v_membership.student_id <> register_manual_payment.student_id then
    raise exception 'El programa no pertenece al alumno indicado.';
  end if;

  if v_membership.status = 'cancelled'::public.membership_status then
    raise exception 'No se puede registrar un pago sobre un programa eliminado.';
  end if;

  select *
  into v_plan
  from public.plans p
  where p.id = v_membership.plan_id;

  if not found then
    raise exception 'Plan de programa no encontrado.';
  end if;

  v_period_start := coalesce(register_manual_payment.membership_start_date, register_manual_payment.payment_date);
  v_period_end := coalesce(
    register_manual_payment.membership_end_date,
    (v_period_start + interval '1 month')::date
  );

  if v_period_end < v_period_start then
    raise exception 'La fecha de fin de vigencia debe ser posterior o igual al inicio.';
  end if;

  v_paid_at := (payment_date::timestamp + time '12:00') at time zone 'UTC';
  v_required_amount := private.membership_required_amount(v_membership.id);
  if v_required_amount is null then
    raise exception 'El programa no tiene monto congelado requerido.';
  end if;

  v_previous_approved_total := private.membership_approved_paid_total(v_membership.id);
  v_was_fully_paid := v_previous_approved_total >= v_required_amount;
  v_approved_paid_total := (v_previous_approved_total + register_manual_payment.amount)::numeric(12, 2);
  v_is_fully_paid := v_approved_paid_total >= v_required_amount;
  v_pending_amount := greatest(v_required_amount - v_approved_paid_total, 0)::numeric(12, 2);
  v_is_active_renewal :=
    v_was_fully_paid
    and v_membership.status = 'active'::public.membership_status
    and v_membership.end_date >= v_period_start;

  insert into public.payments (
    student_id,
    membership_id,
    amount,
    method,
    status,
    paid_at,
    approved_at,
    approved_by,
    membership_start_date,
    membership_end_date,
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
    v_period_start,
    v_period_end,
    nullif(btrim(register_manual_payment.notes), '')
  )
  returning * into v_payment;

  if v_plan.plan_type = 'package' and v_is_fully_paid then
    v_next_remaining_credits := case
      when v_is_active_renewal
        then coalesce(v_membership.remaining_credits, 0) + coalesce(v_plan.package_class_count, 0)
      when v_was_fully_paid is false
        then coalesce(v_plan.package_class_count, 0)
      else v_membership.remaining_credits
    end;

    update public.memberships
    set
      remaining_credits = v_next_remaining_credits,
      updated_at = now()
    where id = v_membership.id
    returning * into v_membership;
  elsif v_plan.plan_type <> 'package' and v_is_fully_paid then
    update public.memberships
    set
      remaining_credits = null,
      updated_at = now()
    where id = v_membership.id
    returning * into v_membership;
  end if;

  v_membership_reconciliation := private.reconcile_membership_payment_state(
    v_membership.id,
    v_actor_id,
    'Pago manual registrado.'
  );

  select *
  into v_membership
  from public.memberships m
  where m.id = register_manual_payment.membership_id;

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
      'approved_paid_total', v_approved_paid_total,
      'plan_price', v_plan.price,
      'required_amount', v_required_amount,
      'pending_amount', v_pending_amount,
      'is_fully_paid', v_is_fully_paid,
      'active_renewal', v_is_active_renewal,
      'payment_membership_start_date', v_payment.membership_start_date,
      'payment_membership_end_date', v_payment.membership_end_date,
      'membership_start_date', v_membership.start_date,
      'membership_end_date', v_membership.end_date,
      'remaining_credits', v_membership.remaining_credits,
      'membership_reconciliation', v_membership_reconciliation
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
    'payment_date', register_manual_payment.payment_date,
    'payment_membership_start_date', v_payment.membership_start_date,
    'payment_membership_end_date', v_payment.membership_end_date,
    'approved_paid_total', v_approved_paid_total,
    'required_amount', v_required_amount,
    'pending_amount', v_pending_amount,
    'is_fully_paid', v_is_fully_paid,
    'membership_reconciliation', v_membership_reconciliation
  );
end;
$$;

drop function if exists public.admin_update_payment(
  uuid,
  numeric,
  public.payment_method,
  date,
  text
);

create or replace function public.admin_update_payment(
  p_payment_id uuid,
  p_amount numeric,
  p_method public.payment_method,
  p_paid_at date,
  p_notes text default null,
  p_membership_start_date date default null,
  p_membership_end_date date default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_actor_id uuid := (select auth.uid());
  v_previous public.payments%rowtype;
  v_payment public.payments%rowtype;
  v_paid_at timestamptz;
  v_membership_reconciliation jsonb := '{}'::jsonb;
begin
  if not coalesce(private.is_admin(), false) then
    raise exception 'Solo un admin activo puede editar pagos.';
  end if;

  if v_actor_id is null then
    raise exception 'Sesion requerida.';
  end if;

  if p_amount is null or p_amount <= 0 then
    raise exception 'El monto debe ser mayor a cero.';
  end if;

  if p_method is null then
    raise exception 'Metodo de pago requerido.';
  end if;

  if p_paid_at is null then
    raise exception 'Fecha de pago requerida.';
  end if;

  if p_membership_start_date is null or p_membership_end_date is null then
    raise exception 'La vigencia del programa es obligatoria.';
  end if;

  if p_membership_end_date < p_membership_start_date then
    raise exception 'La fecha de fin de vigencia debe ser posterior o igual al inicio.';
  end if;

  v_paid_at := (p_paid_at::timestamp + time '12:00') at time zone 'UTC';

  select *
  into v_previous
  from public.payments p
  where p.id = p_payment_id
  for update;

  if not found then
    raise exception 'Pago no encontrado.';
  end if;

  if v_previous.status::text = 'voided' then
    raise exception 'No se pueden editar pagos anulados.';
  end if;

  update public.payments
  set
    amount = p_amount,
    method = p_method,
    paid_at = v_paid_at,
    membership_start_date = p_membership_start_date,
    membership_end_date = p_membership_end_date,
    notes = nullif(btrim(p_notes), ''),
    updated_at = now()
  where id = v_previous.id
  returning * into v_payment;

  if v_payment.membership_id is not null
     and v_payment.status = 'approved'::public.payment_status then
    v_membership_reconciliation := private.reconcile_membership_payment_state(
      v_payment.membership_id,
      v_actor_id,
      'Pago aprobado editado.'
    );
  end if;

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
    'payment.updated',
    jsonb_build_object(
      'student_id', v_payment.student_id,
      'membership_id', v_payment.membership_id,
      'old', jsonb_build_object(
        'amount', v_previous.amount,
        'method', v_previous.method,
        'paid_at', v_previous.paid_at,
        'membership_start_date', v_previous.membership_start_date,
        'membership_end_date', v_previous.membership_end_date,
        'notes', v_previous.notes,
        'status', v_previous.status
      ),
      'new', jsonb_build_object(
        'amount', v_payment.amount,
        'method', v_payment.method,
        'paid_at', v_payment.paid_at,
        'membership_start_date', v_payment.membership_start_date,
        'membership_end_date', v_payment.membership_end_date,
        'notes', v_payment.notes,
        'status', v_payment.status
      ),
      'membership_reconciliation', v_membership_reconciliation
    )
  );

  return jsonb_build_object(
    'action', 'updated',
    'payment_id', v_payment.id,
    'status', v_payment.status,
    'membership_id', v_payment.membership_id,
    'membership_start_date', v_payment.membership_start_date,
    'membership_end_date', v_payment.membership_end_date,
    'membership_reconciliation', v_membership_reconciliation
  );
end;
$$;

create or replace function public.admin_void_payment(
  p_payment_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_actor_id uuid := (select auth.uid());
  v_previous public.payments%rowtype;
  v_payment public.payments%rowtype;
  v_reason text := nullif(btrim(p_reason), '');
  v_last_attendance_at timestamptz;
  v_last_payment_at timestamptz;
  v_last_real_activity_at timestamptz;
  v_membership_reconciliation jsonb := '{}'::jsonb;
begin
  if not coalesce(private.is_admin(), false) then
    raise exception 'Solo un admin activo puede anular pagos.';
  end if;

  if v_actor_id is null then
    raise exception 'Sesion requerida.';
  end if;

  if v_reason is null then
    raise exception 'El motivo de anulacion es obligatorio.';
  end if;

  select *
  into v_previous
  from public.payments p
  where p.id = p_payment_id
  for update;

  if not found then
    raise exception 'Pago no encontrado.';
  end if;

  if v_previous.status::text = 'voided' then
    raise exception 'El pago ya esta anulado.';
  end if;

  update public.payments
  set
    status = 'voided'::public.payment_status,
    voided_at = now(),
    voided_by = v_actor_id,
    void_reason = v_reason,
    updated_at = now()
  where id = v_previous.id
  returning * into v_payment;

  if v_previous.status = 'approved'::public.payment_status
     and v_payment.membership_id is not null then
    v_membership_reconciliation := private.reconcile_membership_payment_state(
      v_payment.membership_id,
      v_actor_id,
      'Pago aprobado anulado: ' || v_reason
    );
  end if;

  if v_previous.status::text = 'approved' then
    select max(att.recorded_at) into v_last_attendance_at
    from public.attendance att
    where att.student_id = v_previous.student_id
      and att.status = 'present'::public.attendance_status;

    select max(payment_activity.activity_at) into v_last_payment_at
    from (
      select coalesce(pay.approved_at, pay.paid_at) as activity_at
      from public.payments pay
      where pay.student_id = v_previous.student_id
        and pay.status = 'approved'::public.payment_status
    ) payment_activity
    where payment_activity.activity_at is not null;

    select max(real_activity.activity_at) into v_last_real_activity_at
    from (
      values (v_last_attendance_at), (v_last_payment_at)
    ) real_activity(activity_at)
    where real_activity.activity_at is not null;

    update public.profiles
    set
      last_payment_at = v_last_payment_at,
      last_attendance_at = v_last_attendance_at,
      last_real_activity_at = v_last_real_activity_at,
      updated_at = now()
    where id = v_previous.student_id;
  end if;

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
    'payment.voided',
    jsonb_build_object(
      'student_id', v_payment.student_id,
      'membership_id', v_payment.membership_id,
      'reason', v_reason,
      'previous_status', v_previous.status,
      'amount', v_previous.amount,
      'method', v_previous.method,
      'paid_at', v_previous.paid_at,
      'membership_start_date', v_previous.membership_start_date,
      'membership_end_date', v_previous.membership_end_date,
      'recalculated_profile', v_previous.status::text = 'approved',
      'last_payment_at', v_last_payment_at,
      'last_attendance_at', v_last_attendance_at,
      'last_real_activity_at', v_last_real_activity_at,
      'membership_reconciliation', v_membership_reconciliation
    )
  );

  return jsonb_build_object(
    'action', 'voided',
    'payment_id', v_payment.id,
    'status', v_payment.status,
    'membership_id', v_payment.membership_id,
    'membership_reconciliation', v_membership_reconciliation
  );
end;
$$;

revoke all on function private.payment_validity_start(public.payments, date) from public, anon;
revoke all on function private.payment_validity_end(public.payments, public.plans, date) from public, anon;
revoke all on function private.membership_required_amount(uuid) from public, anon;
revoke all on function public.register_manual_payment(
  uuid,
  uuid,
  numeric,
  public.payment_method,
  text,
  date,
  date,
  date
) from public, anon;
revoke all on function public.admin_update_payment(
  uuid,
  numeric,
  public.payment_method,
  date,
  text,
  date,
  date
) from public, anon;
revoke all on function public.admin_void_payment(uuid, text) from public, anon;

grant execute on function public.register_manual_payment(
  uuid,
  uuid,
  numeric,
  public.payment_method,
  text,
  date,
  date,
  date
) to authenticated;
grant execute on function public.admin_update_payment(
  uuid,
  numeric,
  public.payment_method,
  date,
  text,
  date,
  date
) to authenticated;
grant execute on function public.admin_void_payment(uuid, text) to authenticated;
