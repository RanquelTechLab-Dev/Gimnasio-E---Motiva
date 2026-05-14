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

create or replace function public.update_my_profile_preferences(
  p_phone text default null,
  p_receives_emails boolean default true
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

  update public.profiles
  set
    phone = nullif(btrim(coalesce(p_phone, '')), ''),
    receives_emails = coalesce(p_receives_emails, true),
    updated_at = now()
  where id = v_actor
  returning * into v_profile;

  insert into public.audit_logs (actor_id, entity_type, entity_id, action, metadata)
  values (
    v_actor,
    'profile',
    v_actor,
    'profile.updated_by_student',
    jsonb_build_object(
      'previous_phone', v_previous_phone,
      'phone', v_profile.phone,
      'previous_receives_emails', v_previous_receives_emails,
      'receives_emails', v_profile.receives_emails
    )
  );

  return jsonb_build_object(
    'id', v_profile.id,
    'first_name', v_profile.first_name,
    'last_name', v_profile.last_name,
    'email', v_profile.email,
    'phone', v_profile.phone,
    'active', v_profile.active,
    'receives_emails', v_profile.receives_emails
  );
end;
$$;

create or replace function public.list_my_payments()
returns table (
  payment_id uuid,
  membership_id uuid,
  amount numeric,
  method public.payment_method,
  status public.payment_status,
  paid_at timestamptz,
  approved_at timestamptz,
  rejected_at timestamptz,
  notes text,
  plan_name text
)
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_actor uuid := auth.uid();
begin
  if v_actor is null then
    raise exception 'Se requiere sesion activa.';
  end if;

  return query
  select
    pay.id,
    pay.membership_id,
    pay.amount,
    pay.method,
    pay.status,
    pay.paid_at,
    pay.approved_at,
    pay.rejected_at,
    pay.notes,
    pl.name
  from public.payments pay
  left join public.memberships m on m.id = pay.membership_id
  left join public.plans pl on pl.id = m.plan_id
  where pay.student_id = v_actor
  order by pay.paid_at desc, pay.created_at desc;
end;
$$;

create or replace function public.list_my_attendance()
returns table (
  attendance_id uuid,
  booking_id uuid,
  session_id uuid,
  activity_name text,
  title text,
  starts_at timestamptz,
  ends_at timestamptz,
  status public.attendance_status,
  recorded_at timestamptz,
  notes text
)
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_actor uuid := auth.uid();
begin
  if v_actor is null then
    raise exception 'Se requiere sesion activa.';
  end if;

  return query
  select
    att.id,
    att.booking_id,
    att.session_id,
    a.name,
    s.title,
    s.starts_at,
    s.ends_at,
    att.status,
    att.recorded_at,
    att.notes
  from public.attendance att
  join public.class_sessions s on s.id = att.session_id
  join public.activities a on a.id = s.activity_id
  where att.student_id = v_actor
  order by att.recorded_at desc;
end;
$$;

create or replace function public.list_my_files()
returns table (
  file_id uuid,
  kind public.file_kind,
  title text,
  drive_url text,
  mime_type text,
  size_bytes bigint,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_actor uuid := auth.uid();
begin
  if v_actor is null then
    raise exception 'Se requiere sesion activa.';
  end if;

  return query
  select
    f.id,
    f.kind,
    f.title,
    f.drive_url,
    f.mime_type,
    f.size_bytes,
    f.created_at
  from public.files f
  where f.student_id = v_actor
  order by f.created_at desc;
end;
$$;

revoke all on function public.get_my_profile_summary() from public, anon;
revoke all on function public.update_my_profile_preferences(text, boolean) from public, anon;
revoke all on function public.list_my_payments() from public, anon;
revoke all on function public.list_my_attendance() from public, anon;
revoke all on function public.list_my_files() from public, anon;

grant execute on function public.get_my_profile_summary() to authenticated;
grant execute on function public.update_my_profile_preferences(text, boolean) to authenticated;
grant execute on function public.list_my_payments() to authenticated;
grant execute on function public.list_my_attendance() to authenticated;
grant execute on function public.list_my_files() to authenticated;
