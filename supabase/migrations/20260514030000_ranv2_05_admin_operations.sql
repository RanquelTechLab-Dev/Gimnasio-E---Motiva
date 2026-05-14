-- RANV2-05: admin operations RPCs for memberships and manual payments.
-- Remote application is intentionally deferred to the post-merge block.

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
begin
  if not coalesce(private.is_admin(), false) then
    raise exception 'Solo un admin activo puede asignar membresias.';
  end if;

  if v_actor_id is null then
    raise exception 'Sesion requerida.';
  end if;

  if start_date is null or end_date is null or end_date < start_date then
    raise exception 'Fechas de membresia invalidas.';
  end if;

  if remaining_credits is not null and remaining_credits < 0 then
    raise exception 'Los creditos restantes no pueden ser negativos.';
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

  insert into public.memberships (
    student_id,
    plan_id,
    status,
    start_date,
    end_date,
    remaining_credits
  )
  values (
    assign_membership.student_id,
    assign_membership.plan_id,
    'active'::public.membership_status,
    assign_membership.start_date,
    assign_membership.end_date,
    assign_membership.remaining_credits
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
    'membership.assigned',
    jsonb_build_object(
      'student_id', v_membership.student_id,
      'plan_id', v_membership.plan_id,
      'start_date', v_membership.start_date,
      'end_date', v_membership.end_date,
      'remaining_credits', v_membership.remaining_credits
    )
  );

  return jsonb_build_object(
    'membership_id', v_membership.id,
    'student_id', v_membership.student_id,
    'plan_id', v_membership.plan_id,
    'status', v_membership.status,
    'start_date', v_membership.start_date,
    'end_date', v_membership.end_date,
    'remaining_credits', v_membership.remaining_credits
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
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_actor_id uuid := (select auth.uid());
  v_membership public.memberships%rowtype;
  v_payment public.payments%rowtype;
  v_student public.profiles%rowtype;
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
  where m.id = register_manual_payment.membership_id;

  if not found then
    raise exception 'Membresia no encontrada.';
  end if;

  if v_membership.student_id <> register_manual_payment.student_id then
    raise exception 'La membresia no pertenece al alumno indicado.';
  end if;

  insert into public.payments (
    student_id,
    membership_id,
    amount,
    method,
    status,
    notes
  )
  values (
    register_manual_payment.student_id,
    register_manual_payment.membership_id,
    register_manual_payment.amount,
    register_manual_payment.method,
    'pending'::public.payment_status,
    nullif(btrim(register_manual_payment.notes), '')
  )
  returning * into v_payment;

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
    'payment.registered',
    jsonb_build_object(
      'student_id', v_payment.student_id,
      'membership_id', v_payment.membership_id,
      'amount', v_payment.amount,
      'method', v_payment.method
    )
  );

  return jsonb_build_object(
    'payment_id', v_payment.id,
    'student_id', v_payment.student_id,
    'membership_id', v_payment.membership_id,
    'amount', v_payment.amount,
    'method', v_payment.method,
    'status', v_payment.status
  );
end;
$$;

create or replace function public.approve_manual_payment(
  payment_id uuid,
  effective_date date default current_date
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
  v_next_start date;
  v_next_end date;
begin
  if not coalesce(private.is_admin(), false) then
    raise exception 'Solo un admin activo puede aprobar pagos.';
  end if;

  if v_actor_id is null then
    raise exception 'Sesion requerida.';
  end if;

  if effective_date is null then
    raise exception 'Fecha efectiva requerida.';
  end if;

  select *
  into v_payment
  from public.payments p
  where p.id = approve_manual_payment.payment_id
  for update;

  if not found then
    raise exception 'Pago no encontrado.';
  end if;

  if v_payment.status <> 'pending'::public.payment_status then
    raise exception 'Solo se pueden aprobar pagos pendientes.';
  end if;

  if v_payment.membership_id is null then
    raise exception 'El pago no tiene membresia vinculada.';
  end if;

  select *
  into v_membership
  from public.memberships m
  where m.id = v_payment.membership_id
  for update;

  if not found then
    raise exception 'Membresia vinculada no encontrada.';
  end if;

  if v_membership.student_id <> v_payment.student_id then
    raise exception 'El pago y la membresia pertenecen a alumnos distintos.';
  end if;

  select *
  into v_plan
  from public.plans p
  where p.id = v_membership.plan_id;

  if not found then
    raise exception 'Plan de membresia no encontrado.';
  end if;

  v_next_start := case
    when v_membership.end_date >= approve_manual_payment.effective_date
      then v_membership.end_date + 1
    else approve_manual_payment.effective_date
  end;
  v_next_end := v_next_start + (v_plan.billing_period_days - 1);

  update public.payments
  set
    status = 'approved'::public.payment_status,
    approved_at = now(),
    approved_by = v_actor_id,
    updated_at = now()
  where id = v_payment.id
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
    'payment.approved',
    jsonb_build_object(
      'student_id', v_payment.student_id,
      'membership_id', v_payment.membership_id,
      'amount', v_payment.amount,
      'method', v_payment.method,
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
    'membership_end_date', v_membership.end_date
  );
end;
$$;

create or replace function public.reject_manual_payment(
  payment_id uuid,
  reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_actor_id uuid := (select auth.uid());
  v_payment public.payments%rowtype;
  v_reason text := nullif(btrim(reason), '');
begin
  if not coalesce(private.is_admin(), false) then
    raise exception 'Solo un admin activo puede rechazar pagos.';
  end if;

  if v_actor_id is null then
    raise exception 'Sesion requerida.';
  end if;

  select *
  into v_payment
  from public.payments p
  where p.id = reject_manual_payment.payment_id
  for update;

  if not found then
    raise exception 'Pago no encontrado.';
  end if;

  if v_payment.status <> 'pending'::public.payment_status then
    raise exception 'Solo se pueden rechazar pagos pendientes.';
  end if;

  update public.payments
  set
    status = 'rejected'::public.payment_status,
    rejected_at = now(),
    rejected_by = v_actor_id,
    notes = case
      when v_reason is null then notes
      when notes is null or btrim(notes) = '' then 'Motivo rechazo: ' || v_reason
      else notes || E'\nMotivo rechazo: ' || v_reason
    end,
    updated_at = now()
  where id = v_payment.id
  returning * into v_payment;

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
    'payment.rejected',
    jsonb_build_object(
      'student_id', v_payment.student_id,
      'membership_id', v_payment.membership_id,
      'amount', v_payment.amount,
      'method', v_payment.method,
      'reason', v_reason
    )
  );

  return jsonb_build_object(
    'payment_id', v_payment.id,
    'student_id', v_payment.student_id,
    'membership_id', v_payment.membership_id,
    'status', v_payment.status,
    'reason', v_reason
  );
end;
$$;

revoke all on function public.assign_membership(uuid, uuid, date, date, int) from public, anon;
revoke all on function public.register_manual_payment(uuid, uuid, numeric, public.payment_method, text) from public, anon;
revoke all on function public.approve_manual_payment(uuid, date) from public, anon;
revoke all on function public.reject_manual_payment(uuid, text) from public, anon;

grant execute on function public.assign_membership(uuid, uuid, date, date, int) to authenticated;
grant execute on function public.register_manual_payment(uuid, uuid, numeric, public.payment_method, text) to authenticated;
grant execute on function public.approve_manual_payment(uuid, date) to authenticated;
grant execute on function public.reject_manual_payment(uuid, text) to authenticated;
