create extension if not exists pg_cron;

create extension if not exists pg_net with schema extensions;

revoke all
on table net.http_request_queue
from public, anon, authenticated;

revoke all
on sequence net.http_request_queue_id_seq
from public, anon, authenticated;

revoke all
on function net.http_post(text, jsonb, jsonb, jsonb, integer)
from public, anon, authenticated;

grant insert
on table net.http_request_queue
to postgres;

grant select (id)
on table net.http_request_queue
to postgres;

grant usage
on sequence net.http_request_queue_id_seq
to postgres;

grant execute
on function net.http_post(text, jsonb, jsonb, jsonb, integer)
to postgres;

create schema if not exists private;

create table if not exists private.payment_reminder_scheduler_dispatches (
  local_date date primary key,
  request_id bigint,
  created_at timestamptz not null default pg_catalog.now()
);

revoke all
on table private.payment_reminder_scheduler_dispatches
from public, anon, authenticated;

create or replace function private.invoke_payment_reminder_scheduler()
returns table (
  local_date date,
  dispatched boolean,
  request_id bigint
)
language plpgsql
volatile
security invoker
set search_path = ''
as $function$
declare
  v_local_timestamp timestamp without time zone;
  v_local_date date;
  v_local_hour integer;
  v_expected_project_ref constant text := 'kmfxgeqxulwaauracyzs';
  v_project_url text;
  v_publishable_key text;
  v_cron_secret text;
  v_request_id bigint;
begin
  v_local_timestamp := pg_catalog.timezone(
    'America/Argentina/Cordoba',
    pg_catalog.now()
  );
  v_local_date := v_local_timestamp::date;
  v_local_hour := extract(hour from v_local_timestamp)::integer;

  if v_local_hour <> 10 then
    return query select v_local_date, false, null::bigint;
    return;
  end if;

  select secret.decrypted_secret
  into v_project_url
  from vault.decrypted_secrets as secret
  where secret.name = 'emotiva_project_url';

  select secret.decrypted_secret
  into v_publishable_key
  from vault.decrypted_secrets as secret
  where secret.name = 'emotiva_publishable_key';

  select secret.decrypted_secret
  into v_cron_secret
  from vault.decrypted_secrets as secret
  where secret.name = 'emotiva_payment_reminder_cron_secret';

  v_project_url := nullif(
    pg_catalog.rtrim(pg_catalog.btrim(v_project_url), '/'),
    ''
  );
  v_publishable_key := nullif(
    pg_catalog.btrim(v_publishable_key),
    ''
  );
  v_cron_secret := nullif(
    pg_catalog.btrim(v_cron_secret),
    ''
  );

  if v_project_url is null
    or v_publishable_key is null
    or v_cron_secret is null then
    raise exception using
      errcode = '22023',
      message = 'Payment reminder scheduler configuration is missing or invalid';
  end if;

  if v_project_url is distinct from pg_catalog.format(
    'https://%s.supabase.co',
    v_expected_project_ref
  ) then
    raise exception using
      errcode = '22023',
      message = 'Payment reminder scheduler configuration is missing or invalid';
  end if;

  insert into private.payment_reminder_scheduler_dispatches (local_date)
  values (v_local_date)
  on conflict on constraint payment_reminder_scheduler_dispatches_pkey
  do nothing;

  if not found then
    return query select v_local_date, false, null::bigint;
    return;
  end if;

  select net.http_post(
    url := v_project_url || '/functions/v1/send-payment-reminders',
    body := pg_catalog.jsonb_build_object(
      'dryRun', true,
      'mode', 'scheduled_preview'
    ),
    headers := pg_catalog.jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', v_publishable_key,
      'x-e-motiva-cron-secret', v_cron_secret
    ),
    timeout_milliseconds := 5000
  )
  into v_request_id;

  if v_request_id is null then
    raise exception using
      errcode = '55000',
      message = 'Payment reminder scheduler request was not enqueued';
  end if;

  update private.payment_reminder_scheduler_dispatches as dispatch
  set request_id = v_request_id
  where dispatch.local_date = v_local_date;

  return query select v_local_date, true, v_request_id;
end;
$function$;

revoke all
on function private.invoke_payment_reminder_scheduler()
from public, anon, authenticated;

grant execute
on function private.invoke_payment_reminder_scheduler()
to postgres;

do $scheduler$
declare
  v_job_id bigint;
begin
  v_job_id := cron.schedule(
    'emotiva-payment-reminders',
    '0 * * * *',
    $cron$
      select private.invoke_payment_reminder_scheduler();
    $cron$
  );

  perform cron.alter_job(
    job_id => v_job_id,
    active => true
  );
end;
$scheduler$;
