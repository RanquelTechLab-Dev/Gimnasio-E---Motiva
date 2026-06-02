-- RAN-34: lock the required payment amount when a program is assigned.
--
-- "Program" is the UI name for memberships.
--
-- Safety:
-- - No payments, students/profiles, plans, bookings, attendance, audit logs or
--   files are deleted.
-- - Existing active programs are backfilled with their approved paid total when
--   available, so a later plan price increase cannot make them incomplete.
-- - New assigned programs freeze the current plan price in memberships.required_amount.
-- - Payment state is reconciled against the frozen required_amount, not the
--   mutable plans.price.

alter table public.memberships
add column if not exists required_amount numeric(12, 2);

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
  select coalesce(m.required_amount, p.price, 0)::numeric(12, 2)
  from public.memberships m
  join public.plans p on p.id = m.plan_id
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

create or replace function private.enforce_paid_active_membership()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_required_amount numeric(12, 2);
  v_approved_paid_total numeric(12, 2);
begin
  if new.status = 'active'::public.membership_status then
    select coalesce(new.required_amount, p.price, 0)::numeric(12, 2)
    into v_required_amount
    from public.plans p
    where p.id = new.plan_id;

    v_approved_paid_total := private.membership_approved_paid_total(new.id);

    if coalesce(v_approved_paid_total, 0) < coalesce(v_required_amount, 0) then
      raise exception 'Este programa todavía no está pagado completo.';
    end if;
  end if;

  return new;
end;
$$;

with approved_totals as (
  select
    m.id as membership_id,
    coalesce(sum(pay.amount) filter (
      where pay.status = 'approved'::public.payment_status
    ), 0)::numeric(12, 2) as approved_paid_total
  from public.memberships m
  left join public.payments pay on pay.membership_id = m.id
  group by m.id
)
update public.memberships m
set
  required_amount = case
    when m.status = 'active'::public.membership_status
      and approved_totals.approved_paid_total > 0
      then approved_totals.approved_paid_total
    when approved_totals.approved_paid_total >= p.price
      then approved_totals.approved_paid_total
    else p.price::numeric(12, 2)
  end,
  updated_at = now()
from public.plans p, approved_totals
where p.id = m.plan_id
  and approved_totals.membership_id = m.id
  and m.required_amount is null;

alter table public.memberships
alter column required_amount set not null;

alter table public.memberships
drop constraint if exists memberships_required_amount_nonnegative;

alter table public.memberships
add constraint memberships_required_amount_nonnegative
check (required_amount >= 0);

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
  v_plan public.plans%rowtype;
  v_previous_status public.membership_status;
  v_approved_paid_total numeric(12, 2) := 0;
  v_required_amount numeric(12, 2) := 0;
  v_pending_amount numeric(12, 2) := 0;
  v_is_fully_paid boolean := false;
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

  v_previous_status := v_membership.status;

  select *
  into v_plan
  from public.plans p
  where p.id = v_membership.plan_id;

  if not found then
    return jsonb_build_object('action', 'skipped', 'reason', 'plan_not_found');
  end if;

  v_required_amount := private.membership_required_amount(v_membership.id);
  v_approved_paid_total := private.membership_approved_paid_total(v_membership.id);
  v_pending_amount := greatest(v_required_amount - v_approved_paid_total, 0)::numeric(12, 2);
  v_is_fully_paid := v_approved_paid_total >= v_required_amount;

  if v_is_fully_paid and v_membership.status = 'suspended'::public.membership_status then
    update public.memberships
    set
      status = 'active'::public.membership_status,
      updated_at = now()
    where id = v_membership.id
    returning * into v_membership;

    v_action := 'activated';
  elsif v_is_fully_paid is false and v_membership.status = 'active'::public.membership_status then
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
      and s.starts_at >= now();

    if v_future_active_bookings_count > 0 then
      update public.bookings b
      set
        status = 'cancelled'::public.booking_status,
        cancelled_at = now(),
        cancelled_by = p_actor_id,
        cancel_reason = coalesce(
          nullif(btrim(p_reason), ''),
          'Programa sin pago completo.'
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
        and s.starts_at >= now();
    end if;

    update public.memberships
    set
      status = 'suspended'::public.membership_status,
      remaining_credits = case
        when remaining_credits is not null then remaining_credits + v_returned_credits
        else remaining_credits
      end,
      updated_at = now()
    where id = v_membership.id
    returning * into v_membership;

    v_action := 'suspended_unpaid';
  end if;

  if v_action <> 'unchanged' then
    insert into public.audit_logs (actor_id, entity_type, entity_id, action, metadata)
    values (
      p_actor_id,
      'membership',
      v_membership.id,
      'membership.payment_state_reconciled',
      jsonb_build_object(
        'reason', p_reason,
        'previous_status', v_previous_status,
        'current_status', v_membership.status,
        'approved_paid_total', v_approved_paid_total,
        'plan_price', v_plan.price,
        'required_amount', v_required_amount,
        'pending_amount', v_pending_amount,
        'is_fully_paid', v_is_fully_paid,
        'future_active_bookings_cancelled', v_future_active_bookings_count,
        'credits_returned', v_returned_credits
      )
    );
  end if;

  return jsonb_build_object(
    'action', v_action,
    'membership_id', v_membership.id,
    'previous_status', v_previous_status,
    'current_status', v_membership.status,
    'approved_paid_total', v_approved_paid_total,
    'plan_price', v_plan.price,
    'required_amount', v_required_amount,
    'pending_amount', v_pending_amount,
    'is_fully_paid', v_is_fully_paid,
    'future_active_bookings_cancelled', v_future_active_bookings_count,
    'credits_returned', v_returned_credits
  );
end;
$$;

create or replace function public.assign_membership(
  student_id uuid,
  plan_id uuid,
  start_date date,
  end_date date,
  remaining_credits int default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_actor_id uuid := (select auth.uid());
  v_membership public.memberships%rowtype;
  v_plan public.plans%rowtype;
  v_student public.profiles%rowtype;
  v_required_amount numeric(12, 2);
begin
  if not coalesce(private.is_admin(), false) then
    raise exception 'Solo un admin activo puede asignar programas.';
  end if;

  if v_actor_id is null then
    raise exception 'Sesion requerida.';
  end if;

  if start_date is null or end_date is null or end_date < start_date then
    raise exception 'Fechas de programa invalidas.';
  end if;

  if remaining_credits is not null and remaining_credits < 0 then
    raise exception 'Las clases disponibles no pueden ser negativas.';
  end if;

  select *
  into v_student
  from public.profiles p
  where p.id = assign_membership.student_id
    and p.role = 'student'::public.user_role;

  if not found then
    raise exception 'Alumno no encontrado.';
  end if;

  select *
  into v_plan
  from public.plans p
  where p.id = assign_membership.plan_id
    and p.active = true;

  if not found then
    raise exception 'Plan activo no encontrado.';
  end if;

  v_required_amount := coalesce(v_plan.price, 0)::numeric(12, 2);

  insert into public.memberships (
    student_id,
    plan_id,
    status,
    start_date,
    end_date,
    remaining_credits,
    required_amount
  )
  values (
    assign_membership.student_id,
    assign_membership.plan_id,
    'suspended'::public.membership_status,
    assign_membership.start_date,
    assign_membership.end_date,
    case
      when v_plan.plan_type = 'weekly' then null
      else assign_membership.remaining_credits
    end,
    v_required_amount
  )
  returning * into v_membership;

  insert into public.audit_logs (
    actor_id,
    entity_type,
    entity_id,
    action,
    metadata
  )
  values (
    v_actor_id,
    'membership',
    v_membership.id,
    'membership.program_assigned_pending_payment',
    jsonb_build_object(
      'student_id', v_membership.student_id,
      'plan_id', v_membership.plan_id,
      'start_date', v_membership.start_date,
      'end_date', v_membership.end_date,
      'remaining_credits', v_membership.remaining_credits,
      'status', v_membership.status,
      'plan_price', v_plan.price,
      'required_amount', v_required_amount
    )
  );

  return jsonb_build_object(
    'membership_id', v_membership.id,
    'student_id', v_membership.student_id,
    'plan_id', v_membership.plan_id,
    'status', v_membership.status,
    'start_date', v_membership.start_date,
    'end_date', v_membership.end_date,
    'remaining_credits', v_membership.remaining_credits,
    'required_amount', v_required_amount,
    'is_fully_paid', false,
    'pending_amount', v_required_amount
  );
end;
$$;

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
  v_previous_approved_total numeric(12, 2);
  v_approved_paid_total numeric(12, 2);
  v_required_amount numeric(12, 2);
  v_pending_amount numeric(12, 2);
  v_next_remaining_credits int;
  v_was_fully_paid boolean;
  v_is_fully_paid boolean;
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

  v_required_amount := private.membership_required_amount(v_membership.id);

  select
    count(*)::int,
    coalesce(sum(p.amount), 0)::numeric(12, 2)
  into v_previous_approved_payments, v_previous_approved_total
  from public.payments p
  where p.membership_id = v_membership.id
    and p.status = 'approved'::public.payment_status;

  v_was_fully_paid := v_previous_approved_total >= v_required_amount;
  v_approved_paid_total := (v_previous_approved_total + register_manual_payment.amount)::numeric(12, 2);
  v_is_fully_paid := v_approved_paid_total >= v_required_amount;
  v_pending_amount := greatest(v_required_amount - v_approved_paid_total, 0)::numeric(12, 2);

  v_is_active_renewal :=
    v_was_fully_paid
    and v_membership.status = 'active'::public.membership_status
    and v_membership.end_date is not null
    and v_membership.end_date >= register_manual_payment.payment_date;

  v_next_start := case
    when v_is_active_renewal and v_membership.start_date is not null
      then v_membership.start_date
    else register_manual_payment.payment_date
  end;

  v_next_end := case
    when v_is_active_renewal
      then (v_membership.end_date + interval '1 month')::date
    else (register_manual_payment.payment_date + interval '1 month')::date
  end;

  v_next_remaining_credits := case
    when v_plan.plan_type = 'package' and v_is_active_renewal
      then coalesce(v_membership.remaining_credits, 0) + coalesce(v_plan.package_class_count, 0)
    when v_plan.plan_type = 'package' and v_is_fully_paid then v_plan.package_class_count
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

  if v_is_fully_paid then
    update public.memberships
    set
      status = 'active'::public.membership_status,
      start_date = v_next_start,
      end_date = v_next_end,
      remaining_credits = v_next_remaining_credits,
      updated_at = now()
    where id = v_membership.id
    returning * into v_membership;
  else
    update public.memberships
    set
      status = 'suspended'::public.membership_status,
      updated_at = now()
    where id = v_membership.id
    returning * into v_membership;
  end if;

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
      'previous_approved_total', v_previous_approved_total,
      'approved_paid_total', v_approved_paid_total,
      'plan_price', v_plan.price,
      'required_amount', v_required_amount,
      'pending_amount', v_pending_amount,
      'is_fully_paid', v_is_fully_paid,
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
    'payment_date', register_manual_payment.payment_date,
    'approved_paid_total', v_approved_paid_total,
    'required_amount', v_required_amount,
    'pending_amount', v_pending_amount,
    'is_fully_paid', v_is_fully_paid
  );
end;
$$;

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

create or replace function public.admin_list_student_programs(p_student_id uuid default null)
returns table (
  program_id uuid,
  student_id uuid,
  plan_id uuid,
  plan_name text,
  plan_type text,
  plan_price numeric,
  approved_paid_total numeric,
  pending_amount numeric,
  is_fully_paid boolean,
  payment_state text,
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
    private.membership_required_amount(m.id),
    coalesce(payments.approved_paid_total, 0)::numeric(12, 2),
    greatest(
      private.membership_required_amount(m.id) - coalesce(payments.approved_paid_total, 0),
      0
    )::numeric(12, 2),
    coalesce(payments.approved_paid_total, 0) >= private.membership_required_amount(m.id),
    case
      when coalesce(payments.approved_paid_total, 0) >= private.membership_required_amount(m.id) then 'paid'
      when coalesce(payments.approved_paid_total, 0) > 0 then 'partial'
      else 'unpaid'
    end,
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
      coalesce(sum(pay.amount) filter (where pay.status = 'approved'::public.payment_status), 0)::numeric(12, 2) as approved_paid_total,
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
  v_cancelled_future_bookings_count integer := 0;
  v_returned_credits integer := 0;
  v_has_history boolean := false;
  v_next_remaining_credits integer;
  v_approved_paid_total numeric(12, 2) := 0;
  v_required_amount numeric(12, 2) := 0;
  v_pending_amount numeric(12, 2) := 0;
  v_is_fully_paid boolean := false;
  v_next_status public.membership_status;
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

  v_required_amount := case
    when p_plan_id <> v_membership.plan_id then coalesce(v_plan.price, 0)::numeric(12, 2)
    else private.membership_required_amount(v_membership.id)
  end;

  select count(*)::int into v_payments_count
  from public.payments pay
  where pay.membership_id = v_membership.id;

  select coalesce(sum(pay.amount), 0)::numeric(12, 2) into v_approved_paid_total
  from public.payments pay
  where pay.membership_id = v_membership.id
    and pay.status = 'approved'::public.payment_status;

  v_is_fully_paid := v_approved_paid_total >= v_required_amount;
  v_pending_amount := greatest(v_required_amount - v_approved_paid_total, 0)::numeric(12, 2);
  v_next_status := case
    when p_status = 'active'::public.membership_status and v_is_fully_paid is false
      then 'suspended'::public.membership_status
    else p_status
  end;

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
    status = v_next_status,
    start_date = p_start_date,
    end_date = p_end_date,
    remaining_credits = v_next_remaining_credits,
    required_amount = v_required_amount,
    updated_at = now()
  where id = v_membership.id
  returning * into v_membership;

  select
    count(*)::int,
    coalesce(sum(b.credits_charged) filter (
      where b.credits_charged > 0 and b.credit_returned_at is null
    ), 0)::int
  into v_cancelled_future_bookings_count, v_returned_credits
  from public.bookings b
  join public.class_sessions s on s.id = b.session_id
  where b.membership_id = v_membership.id
    and b.status = 'booked'::public.booking_status
    and s.starts_at >= now()
    and (
      v_membership.status <> 'active'::public.membership_status
      or s.starts_at::date not between v_membership.start_date and v_membership.end_date
      or not exists (
        select 1
        from public.plan_activities pa
        where pa.plan_id = v_membership.plan_id
          and pa.activity_id = s.activity_id
      )
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

  if v_cancelled_future_bookings_count > 0 then
    update public.bookings b
    set
      status = 'cancelled'::public.booking_status,
      cancelled_at = now(),
      cancelled_by = v_actor,
      cancel_reason = 'Programa asignado editado desde ficha del alumno.',
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
        or not exists (
          select 1
          from public.plan_activities pa
          where pa.plan_id = v_membership.plan_id
            and pa.activity_id = s.activity_id
        )
      );
  end if;

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
      'approved_paid_total', v_approved_paid_total,
      'plan_price', v_plan.price,
      'required_amount', v_required_amount,
      'pending_amount', v_pending_amount,
      'is_fully_paid', v_is_fully_paid,
      'requested_status', p_status,
      'stored_status', v_membership.status,
      'future_active_bookings_cancelled', v_cancelled_future_bookings_count,
      'credits_returned', v_returned_credits,
      'previous', jsonb_build_object(
        'plan_id', v_previous.plan_id,
        'status', v_previous.status,
        'start_date', v_previous.start_date,
        'end_date', v_previous.end_date,
        'remaining_credits', v_previous.remaining_credits,
        'required_amount', v_previous.required_amount
      ),
      'current', jsonb_build_object(
        'plan_id', v_membership.plan_id,
        'status', v_membership.status,
        'start_date', v_membership.start_date,
        'end_date', v_membership.end_date,
        'remaining_credits', v_membership.remaining_credits,
        'required_amount', v_membership.required_amount
      )
    )
  );

  return jsonb_build_object(
    'action', 'updated',
    'membership_id', v_membership.id,
    'student_id', v_membership.student_id,
    'plan_id', v_membership.plan_id,
    'has_history', v_has_history,
    'is_fully_paid', v_is_fully_paid,
    'required_amount', v_required_amount,
    'pending_amount', v_pending_amount,
    'stored_status', v_membership.status,
    'future_active_bookings_cancelled', v_cancelled_future_bookings_count,
    'credits_returned', v_returned_credits
  );
end;
$$;

with unpaid_active_programs as (
  select
    m.id,
    m.student_id,
    m.plan_id,
    p.price,
    private.membership_required_amount(m.id) as required_amount,
    private.membership_approved_paid_total(m.id) as approved_paid_total
  from public.memberships m
  join public.plans p on p.id = m.plan_id
  where m.status = 'active'::public.membership_status
    and private.membership_is_fully_paid(m.id) is false
), updated_programs as (
  update public.memberships m
  set
    status = 'suspended'::public.membership_status,
    updated_at = now()
  from unpaid_active_programs u
  where m.id = u.id
  returning
    m.id,
    m.student_id,
    m.plan_id,
    u.price,
    u.required_amount,
    u.approved_paid_total,
    greatest(u.required_amount - u.approved_paid_total, 0)::numeric(12, 2) as pending_amount
)
insert into public.audit_logs (actor_id, entity_type, entity_id, action, metadata)
select
  null,
  'membership',
  up.id,
  'membership.program_suspended_unpaid',
  jsonb_build_object(
    'student_id', up.student_id,
    'plan_id', up.plan_id,
    'approved_paid_total', up.approved_paid_total,
    'plan_price', up.price,
    'required_amount', up.required_amount,
    'pending_amount', up.pending_amount,
    'reason', 'Programa activo sin pago completo no puede habilitar reservas.'
  )
from updated_programs up;

drop trigger if exists memberships_require_paid_active on public.memberships;

create trigger memberships_require_paid_active
before insert or update on public.memberships
for each row
execute function private.enforce_paid_active_membership();

revoke all on function private.membership_required_amount(uuid) from public, anon;
revoke all on function public.assign_membership(uuid, uuid, date, date, integer) from public, anon;
revoke all on function public.register_manual_payment(uuid, uuid, numeric, public.payment_method, text, date) from public, anon;
revoke all on function public.register_manual_payment(uuid, uuid, numeric, public.payment_method, text) from public, anon;
revoke all on function public.admin_list_student_programs(uuid) from public, anon;
revoke all on function public.admin_update_student_program(uuid, uuid, public.membership_status, date, date, integer, text) from public, anon;

grant execute on function public.assign_membership(uuid, uuid, date, date, integer) to authenticated;
grant execute on function public.register_manual_payment(uuid, uuid, numeric, public.payment_method, text, date) to authenticated;
grant execute on function public.register_manual_payment(uuid, uuid, numeric, public.payment_method, text) to authenticated;
grant execute on function public.admin_list_student_programs(uuid) to authenticated;
grant execute on function public.admin_update_student_program(uuid, uuid, public.membership_status, date, date, integer, text) to authenticated;
