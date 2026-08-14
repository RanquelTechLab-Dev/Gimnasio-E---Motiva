-- RAN-36 B2A: atomic payment reminder delivery claims and finalization.

create or replace function public.claim_payment_reminder_delivery(
  p_student_id uuid,
  p_recipient_email text,
  p_subject text,
  p_idempotency_key text,
  p_membership_id uuid,
  p_due_date date,
  p_offset_days integer,
  p_synthetic_e2e boolean default false
)
returns table (
  claimed boolean,
  log_id uuid,
  reason text,
  attempt integer
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_log public.email_logs%rowtype;
  v_attempt integer;
  v_expected_idempotency_key text;
begin
  if nullif(pg_catalog.btrim(p_recipient_email), '') is null then
    raise exception using
      errcode = '22023',
      message = 'El email destinatario es obligatorio.';
  end if;

  if nullif(pg_catalog.btrim(p_subject), '') is null then
    raise exception using
      errcode = '22023',
      message = 'El asunto es obligatorio.';
  end if;

  if p_membership_id is null or p_due_date is null then
    raise exception using
      errcode = '22023',
      message = 'La membresia y su fecha de vencimiento son obligatorias.';
  end if;

  if p_offset_days is null or p_offset_days not in (5, 3, 1, 0) then
    raise exception using
      errcode = '22023',
      message = 'El offset del recordatorio no esta permitido.';
  end if;

  if p_synthetic_e2e is null then
    raise exception using
      errcode = '22023',
      message = 'El indicador synthetic_e2e es obligatorio.';
  end if;

  if p_synthetic_e2e and p_student_id is not null then
    raise exception using
      errcode = '22023',
      message = 'Un recordatorio sintetico no puede usar un alumno real.';
  end if;

  if not p_synthetic_e2e and p_student_id is null then
    raise exception using
      errcode = '22023',
      message = 'Un recordatorio real requiere un alumno.';
  end if;

  v_expected_idempotency_key :=
    'payment_due_reminder:'
    || p_membership_id::text
    || ':'
    || pg_catalog.to_char(p_due_date, 'YYYY-MM-DD')
    || ':'
    || p_offset_days::text;

  if p_idempotency_key is distinct from v_expected_idempotency_key then
    raise exception using
      errcode = '22023',
      message = 'La clave de idempotencia no coincide con el recordatorio.';
  end if;

  insert into public.email_logs as email_log (
    student_id,
    recipient_email,
    subject,
    provider,
    status,
    sent_at,
    metadata,
    idempotency_key
  )
  values (
    p_student_id,
    p_recipient_email,
    p_subject,
    'mailjet',
    'pending',
    null,
    pg_catalog.jsonb_build_object(
      'notification_type', 'payment_due_reminder',
      'membership_id', p_membership_id,
      'due_date', p_due_date,
      'offset_days', p_offset_days,
      'idempotency_key', p_idempotency_key,
      'attempt', 1,
      'provider', 'mailjet',
      'synthetic_e2e', p_synthetic_e2e
    ),
    p_idempotency_key
  )
  on conflict (idempotency_key)
    where idempotency_key is not null
  do nothing
  returning email_log.* into v_log;

  if found then
    return query
    select true, v_log.id, 'claimed'::text, 1;
    return;
  end if;

  select email_log.*
  into v_log
  from public.email_logs as email_log
  where email_log.idempotency_key = p_idempotency_key
  for update;

  if not found then
    raise exception using
      errcode = '40001',
      message = 'La entrega cambio durante el claim; vuelva a intentar.';
  end if;

  v_attempt := case
    when coalesce(v_log.metadata ->> 'attempt', '')
      ~ '^[1-9][0-9]{0,8}$'
      then (v_log.metadata ->> 'attempt')::integer
    else 1
  end;

  if v_log.status = 'sent' then
    return query
    select false, v_log.id, 'already_sent'::text, v_attempt;
    return;
  end if;

  if v_log.status = 'pending' then
    return query
    select false, v_log.id, 'in_progress'::text, v_attempt;
    return;
  end if;

  if v_log.status = 'failed' then
    v_attempt := v_attempt + 1;

    update public.email_logs as email_log
    set
      student_id = p_student_id,
      recipient_email = p_recipient_email,
      subject = p_subject,
      provider = 'mailjet',
      status = 'pending',
      sent_at = null,
      metadata = (
        (email_log.metadata - 'provider_message_id') - 'error'
      ) || pg_catalog.jsonb_build_object(
        'notification_type', 'payment_due_reminder',
        'membership_id', p_membership_id,
        'due_date', p_due_date,
        'offset_days', p_offset_days,
        'idempotency_key', p_idempotency_key,
        'attempt', v_attempt,
        'provider', 'mailjet',
        'synthetic_e2e', p_synthetic_e2e
      )
    where email_log.id = v_log.id
      and email_log.status = 'failed'
    returning email_log.* into v_log;

    if not found then
      raise exception using
        errcode = '40001',
        message = 'La entrega cambio durante el retry; vuelva a intentar.';
    end if;

    return query
    select true, v_log.id, 'retry_claimed'::text, v_attempt;
    return;
  end if;

  return query
  select false, v_log.id, 'unsupported_status'::text, v_attempt;
end;
$function$;

create or replace function public.finalize_payment_reminder_delivery(
  p_log_id uuid,
  p_idempotency_key text,
  p_status text,
  p_provider_message_id text default null,
  p_error text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns table (
  finalized boolean,
  log_id uuid,
  reason text,
  final_status text
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_finalized_log_id uuid;
  v_metadata jsonb := coalesce(p_metadata, '{}'::jsonb);
begin
  if p_log_id is null or nullif(pg_catalog.btrim(p_idempotency_key), '') is null then
    raise exception using
      errcode = '22023',
      message = 'La identidad de la entrega es obligatoria.';
  end if;

  if p_status is null or p_status not in ('sent', 'failed') then
    raise exception using
      errcode = '22023',
      message = 'El estado final debe ser sent o failed.';
  end if;

  if pg_catalog.jsonb_typeof(v_metadata) <> 'object' then
    raise exception using
      errcode = '22023',
      message = 'La metadata final debe ser un objeto JSON.';
  end if;

  update public.email_logs as email_log
  set
    status = p_status,
    sent_at = case
      when p_status = 'sent' then pg_catalog.now()
      else null
    end,
    metadata = v_metadata
      || email_log.metadata
      || pg_catalog.jsonb_build_object(
        'provider_message_id', p_provider_message_id,
        'error', p_error
      )
  where email_log.id = p_log_id
    and email_log.idempotency_key = p_idempotency_key
    and email_log.status = 'pending'
  returning email_log.id into v_finalized_log_id;

  if not found then
    return query
    select
      false,
      p_log_id,
      'not_pending_or_identity_mismatch'::text,
      null::text;
    return;
  end if;

  return query
  select true, v_finalized_log_id, 'finalized'::text, p_status;
end;
$function$;

revoke all on function public.claim_payment_reminder_delivery(
  uuid,
  text,
  text,
  text,
  uuid,
  date,
  integer,
  boolean
) from public, anon, authenticated;

grant execute on function public.claim_payment_reminder_delivery(
  uuid,
  text,
  text,
  text,
  uuid,
  date,
  integer,
  boolean
) to service_role;

revoke all on function public.finalize_payment_reminder_delivery(
  uuid,
  text,
  text,
  text,
  text,
  jsonb
) from public, anon, authenticated;

grant execute on function public.finalize_payment_reminder_delivery(
  uuid,
  text,
  text,
  text,
  text,
  jsonb
) to service_role;

comment on function public.claim_payment_reminder_delivery(
  uuid,
  text,
  text,
  text,
  uuid,
  date,
  integer,
  boolean
) is 'Atomically claims one logical payment reminder delivery or one controlled failed retry.';

comment on function public.finalize_payment_reminder_delivery(
  uuid,
  text,
  text,
  text,
  text,
  jsonb
) is 'Finalizes an exact pending payment reminder delivery as sent or failed.';
