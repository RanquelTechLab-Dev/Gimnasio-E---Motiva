-- RAN-36 B1A: additive foundation for membership payment reminders.

alter table public.profiles
  add column receives_payment_reminders boolean not null default true;

comment on column public.profiles.receives_payment_reminders is
  'Independent opt-in for membership payment due reminders.';

alter table public.email_logs
  add column idempotency_key text null;

comment on column public.email_logs.idempotency_key is
  'Optional operation key used to prevent duplicate email delivery.';

create unique index email_logs_idempotency_key_unique_idx
  on public.email_logs (idempotency_key)
  where idempotency_key is not null;

create or replace function public.get_my_profile_summary()
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_actor uuid := auth.uid();
  v_profile public.profiles%rowtype;
  v_membership jsonb;
  v_next_booking jsonb;
  v_last_payment jsonb;
  v_last_attendance jsonb;
begin
  if v_actor is null then
    raise exception 'Se requiere sesion activa.';
  end if;

  select * into v_profile
  from public.profiles p
  where p.id = v_actor
    and p.role = 'student'
    and p.active = true;

  if not found then
    raise exception 'No se encontro un perfil de alumno activo.';
  end if;

  select jsonb_build_object(
    'membership_id', m.id,
    'status', m.status,
    'start_date', m.start_date,
    'end_date', m.end_date,
    'remaining_credits', m.remaining_credits,
    'plan_id', p.id,
    'plan_name', p.name,
    'plan_slug', p.slug,
    'plan_type', p.plan_type,
    'package_class_count', p.package_class_count,
    'billing_period_days', p.billing_period_days
  )
  into v_membership
  from public.memberships m
  join public.plans p on p.id = m.plan_id
  where m.student_id = v_actor
    and m.status = 'active'
    and current_date between m.start_date and m.end_date
  order by m.end_date asc, m.created_at desc
  limit 1;

  select jsonb_build_object(
    'booking_id', b.id,
    'session_id', s.id,
    'activity_name', a.name,
    'title', s.title,
    'starts_at', s.starts_at,
    'ends_at', s.ends_at,
    'status', b.status
  )
  into v_next_booking
  from public.bookings b
  join public.class_sessions s on s.id = b.session_id
  join public.activities a on a.id = s.activity_id
  where b.student_id = v_actor
    and b.status = 'booked'
    and s.starts_at > now()
    and s.cancelled_at is null
  order by s.starts_at asc
  limit 1;

  select jsonb_build_object(
    'payment_id', pay.id,
    'amount', pay.amount,
    'method', pay.method,
    'status', pay.status,
    'paid_at', pay.paid_at,
    'notes', pay.notes
  )
  into v_last_payment
  from public.payments pay
  where pay.student_id = v_actor
  order by pay.paid_at desc, pay.created_at desc
  limit 1;

  select jsonb_build_object(
    'attendance_id', att.id,
    'status', att.status,
    'recorded_at', att.recorded_at,
    'activity_name', a.name,
    'title', s.title
  )
  into v_last_attendance
  from public.attendance att
  join public.class_sessions s on s.id = att.session_id
  join public.activities a on a.id = s.activity_id
  where att.student_id = v_actor
    and att.status = 'present'
  order by att.recorded_at desc
  limit 1;

  return jsonb_build_object(
    'profile', jsonb_build_object(
      'id', v_profile.id,
      'first_name', v_profile.first_name,
      'last_name', v_profile.last_name,
      'email', v_profile.email,
      'phone', v_profile.phone,
      'active', v_profile.active,
      'receives_emails', v_profile.receives_emails,
      'receives_payment_reminders', v_profile.receives_payment_reminders,
      'last_payment_at', v_profile.last_payment_at,
      'last_real_activity_at', v_profile.last_real_activity_at,
      'last_attendance_at', v_profile.last_attendance_at
    ),
    'active_membership', v_membership,
    'next_booking', v_next_booking,
    'last_payment', v_last_payment,
    'last_attendance', v_last_attendance
  );
end;
$$;

revoke all on function public.get_my_profile_summary() from public, anon;
grant execute on function public.get_my_profile_summary() to authenticated;

create or replace function public.update_my_profile_preferences_v2(
  p_phone text default null,
  p_receives_emails boolean default null,
  p_receives_payment_reminders boolean default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_actor uuid := auth.uid();
  v_profile public.profiles%rowtype;
  v_previous_phone text;
  v_previous_receives_emails boolean;
  v_previous_receives_payment_reminders boolean;
begin
  if v_actor is null then
    raise exception 'Se requiere sesion activa.';
  end if;

  select * into v_profile
  from public.profiles p
  where p.id = v_actor
    and p.role = 'student'
    and p.active = true
  for update;

  if not found then
    raise exception 'No se encontro un perfil de alumno activo.';
  end if;

  v_previous_phone := v_profile.phone;
  v_previous_receives_emails := v_profile.receives_emails;
  v_previous_receives_payment_reminders :=
    v_profile.receives_payment_reminders;

  update public.profiles
  set
    phone = case
      when p_phone is null then v_profile.phone
      else nullif(btrim(p_phone), '')
    end,
    receives_emails = coalesce(
      p_receives_emails,
      v_profile.receives_emails
    ),
    receives_payment_reminders = coalesce(
      p_receives_payment_reminders,
      v_profile.receives_payment_reminders
    ),
    updated_at = now()
  where id = v_actor
  returning * into v_profile;

  insert into public.audit_logs (
    actor_id,
    entity_type,
    entity_id,
    action,
    metadata
  )
  values (
    v_actor,
    'profile',
    v_actor,
    'profile.updated_by_student',
    jsonb_build_object(
      'previous_phone', v_previous_phone,
      'phone', v_profile.phone,
      'previous_receives_emails', v_previous_receives_emails,
      'receives_emails', v_profile.receives_emails,
      'previous_receives_payment_reminders',
        v_previous_receives_payment_reminders,
      'receives_payment_reminders',
        v_profile.receives_payment_reminders
    )
  );

  return jsonb_build_object(
    'id', v_profile.id,
    'first_name', v_profile.first_name,
    'last_name', v_profile.last_name,
    'email', v_profile.email,
    'phone', v_profile.phone,
    'active', v_profile.active,
    'receives_emails', v_profile.receives_emails,
    'receives_payment_reminders', v_profile.receives_payment_reminders
  );
end;
$$;

revoke all on function public.update_my_profile_preferences_v2(
  text,
  boolean,
  boolean
) from public, anon;

grant execute on function public.update_my_profile_preferences_v2(
  text,
  boolean,
  boolean
) to authenticated;
