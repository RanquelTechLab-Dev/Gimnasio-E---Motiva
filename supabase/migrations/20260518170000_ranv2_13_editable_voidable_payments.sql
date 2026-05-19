-- RANV2-13: editable and voidable manual payments.
-- Payments are never physically deleted. Admin corrections and voids are audited.

alter type public.payment_status add value if not exists 'voided';

alter table public.payments
  add column if not exists voided_at timestamptz,
  add column if not exists voided_by uuid references public.profiles(id) on delete set null,
  add column if not exists void_reason text;

alter table public.payments
  drop constraint if exists payments_approved_fields,
  drop constraint if exists payments_rejected_fields,
  drop constraint if exists payments_voided_fields;

alter table public.payments
  add constraint payments_approved_fields check (
    (
      status::text = 'approved'
      and approved_at is not null
    )
    or (
      status::text <> 'approved'
      and (
        status::text = 'voided'
        or approved_at is null
      )
    )
  ),
  add constraint payments_rejected_fields check (
    (
      status::text = 'rejected'
      and rejected_at is not null
    )
    or (
      status::text <> 'rejected'
      and (
        status::text = 'voided'
        or rejected_at is null
      )
    )
  ),
  add constraint payments_voided_fields check (
    (
      status::text = 'voided'
      and voided_at is not null
      and void_reason is not null
      and btrim(void_reason) <> ''
    )
    or (
      status::text <> 'voided'
      and voided_at is null
      and voided_by is null
      and void_reason is null
    )
  );

create index if not exists payments_voided_at_idx
  on public.payments (voided_at)
  where voided_at is not null;

create or replace function public.admin_update_payment(
  p_payment_id uuid,
  p_amount numeric,
  p_method public.payment_method,
  p_paid_at date,
  p_notes text default null
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

  -- Noon UTC preserves the selected local calendar date for Argentina.
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
    notes = nullif(btrim(p_notes), ''),
    updated_at = now()
  where id = v_previous.id
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
    'payment.updated',
    jsonb_build_object(
      'student_id', v_payment.student_id,
      'membership_id', v_payment.membership_id,
      'old', jsonb_build_object(
        'amount', v_previous.amount,
        'method', v_previous.method,
        'paid_at', v_previous.paid_at,
        'notes', v_previous.notes,
        'status', v_previous.status
      ),
      'new', jsonb_build_object(
        'amount', v_payment.amount,
        'method', v_payment.method,
        'paid_at', v_payment.paid_at,
        'notes', v_payment.notes,
        'status', v_payment.status
      )
    )
  );

  return jsonb_build_object(
    'action', 'updated',
    'payment_id', v_payment.id,
    'status', v_payment.status
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
      'recalculated_profile', v_previous.status::text = 'approved',
      'last_payment_at', v_last_payment_at,
      'last_attendance_at', v_last_attendance_at,
      'last_real_activity_at', v_last_real_activity_at,
      'membership_requires_manual_review', v_previous.membership_id is not null
    )
  );

  return jsonb_build_object(
    'action', 'voided',
    'payment_id', v_payment.id,
    'status', v_payment.status,
    'membership_id', v_payment.membership_id,
    'membership_requires_manual_review', v_payment.membership_id is not null
  );
end;
$$;

revoke all on function public.admin_update_payment(uuid, numeric, public.payment_method, date, text)
  from public, anon;
revoke all on function public.admin_void_payment(uuid, text)
  from public, anon;

grant execute on function public.admin_update_payment(uuid, numeric, public.payment_method, date, text)
  to authenticated;
grant execute on function public.admin_void_payment(uuid, text)
  to authenticated;
