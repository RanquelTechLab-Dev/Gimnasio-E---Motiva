-- RANV2-07: attendance tracking and audit.

alter table public.profiles
  add column if not exists last_attendance_at timestamptz;

alter table public.attendance
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists charged_as_attended boolean not null default false,
  add column if not exists source text not null default 'admin';

create index if not exists attendance_recorded_at_idx on public.attendance (recorded_at);
create index if not exists attendance_status_idx on public.attendance (status);
create index if not exists attendance_booking_status_idx on public.attendance (booking_id, status);

create or replace function private.refresh_profile_attendance_markers(p_student_id uuid)
returns void
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_last_attendance_at timestamptz;
  v_last_payment_at timestamptz;
  v_last_real_activity_at timestamptz;
begin
  select max(att.recorded_at) into v_last_attendance_at
  from public.attendance att
  where att.student_id = p_student_id
    and att.status = 'present'::public.attendance_status;

  select greatest(
    max(pay.approved_at),
    (select p.last_payment_at from public.profiles p where p.id = p_student_id)
  ) into v_last_payment_at
  from public.payments pay
  where pay.student_id = p_student_id
    and pay.status = 'approved'::public.payment_status;

  v_last_real_activity_at := greatest(v_last_attendance_at, v_last_payment_at);

  update public.profiles
  set
    last_attendance_at = v_last_attendance_at,
    last_real_activity_at = v_last_real_activity_at,
    updated_at = now()
  where id = p_student_id;
end;
$$;

create or replace function public.list_attendance_sessions(
  from_date date,
  to_date date
)
returns table (
  session_id uuid,
  activity_id uuid,
  activity_name text,
  requires_24h_cancel boolean,
  title text,
  starts_at timestamptz,
  ends_at timestamptz,
  capacity integer,
  session_active boolean,
  session_cancelled_at timestamptz,
  booking_id uuid,
  student_id uuid,
  student_first_name text,
  student_last_name text,
  student_email text,
  student_phone text,
  booking_status public.booking_status,
  booked_at timestamptz,
  booking_charged_as_attended boolean,
  attendance_id uuid,
  attendance_status public.attendance_status,
  attendance_recorded_at timestamptz,
  attendance_recorded_by uuid,
  attendance_notes text,
  attendance_charged_as_attended boolean
)
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_actor uuid := auth.uid();
begin
  if v_actor is null or not private.is_admin() then
    raise exception 'Solo un admin activo puede ver asistencia.';
  end if;

  if from_date is null or to_date is null or to_date < from_date then
    raise exception 'El rango de fechas no es valido.';
  end if;

  return query
  select
    s.id,
    s.activity_id,
    a.name,
    a.requires_24h_cancel,
    s.title,
    s.starts_at,
    s.ends_at,
    s.capacity,
    s.active,
    s.cancelled_at,
    b.id,
    p.id,
    p.first_name,
    p.last_name,
    p.email,
    p.phone,
    b.status,
    b.booked_at,
    b.charged_as_attended,
    att.id,
    att.status,
    att.recorded_at,
    att.recorded_by,
    att.notes,
    att.charged_as_attended
  from public.class_sessions s
  join public.activities a on a.id = s.activity_id
  join public.bookings b on b.session_id = s.id
  join public.profiles p on p.id = b.student_id
  left join public.attendance att on att.booking_id = b.id
  where s.starts_at >= (from_date::timestamp at time zone 'America/Argentina/Buenos_Aires')
    and s.starts_at < ((to_date + 1)::timestamp at time zone 'America/Argentina/Buenos_Aires')
  order by s.starts_at asc, p.last_name asc, p.first_name asc;
end;
$$;

create or replace function public.mark_attendance(
  booking_id uuid,
  status public.attendance_status,
  notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_actor uuid := auth.uid();
  v_booking public.bookings%rowtype;
  v_session public.class_sessions%rowtype;
  v_activity public.activities%rowtype;
  v_attendance public.attendance%rowtype;
  v_previous public.attendance%rowtype;
  v_action text;
  v_previous_booking_status public.booking_status;
  v_charged_as_attended boolean := false;
begin
  if v_actor is null or not private.is_admin() then
    raise exception 'Solo un admin activo puede marcar asistencia.';
  end if;

  if status is null then
    raise exception 'El estado de asistencia es obligatorio.';
  end if;

  select * into v_booking
  from public.bookings b
  where b.id = mark_attendance.booking_id
  for update;

  if not found then
    raise exception 'La reserva no existe. La asistencia requiere una reserva.';
  end if;

  select * into v_session
  from public.class_sessions s
  where s.id = v_booking.session_id;

  if not found then
    raise exception 'La clase asociada no existe.';
  end if;

  select * into v_activity
  from public.activities a
  where a.id = v_session.activity_id;

  if not found then
    raise exception 'La actividad asociada no existe.';
  end if;

  if v_booking.status = 'cancelled' and status <> 'justified' then
    raise exception 'Una reserva cancelada solo puede registrarse como justificada.';
  end if;

  v_previous_booking_status := v_booking.status;

  select * into v_previous
  from public.attendance att
  where att.booking_id = v_booking.id
  for update;

  v_action := case when found then 'attendance.updated' else 'attendance.marked' end;
  v_charged_as_attended := v_booking.charged_as_attended
    or (status = 'absent' and v_activity.requires_24h_cancel);

  insert into public.attendance (
    booking_id,
    student_id,
    session_id,
    status,
    recorded_by,
    recorded_at,
    notes,
    charged_as_attended,
    source,
    updated_at
  )
  values (
    v_booking.id,
    v_booking.student_id,
    v_booking.session_id,
    status,
    v_actor,
    now(),
    nullif(btrim(coalesce(notes, '')), ''),
    v_charged_as_attended,
    'admin',
    now()
  )
  on conflict (booking_id) do update
  set
    status = excluded.status,
    recorded_by = excluded.recorded_by,
    recorded_at = excluded.recorded_at,
    notes = excluded.notes,
    charged_as_attended = excluded.charged_as_attended,
    source = excluded.source,
    updated_at = now()
  returning * into v_attendance;

  if status = 'present' then
    update public.bookings
    set
      status = 'attended',
      updated_at = now()
    where id = v_booking.id
    returning * into v_booking;

    update public.profiles
    set
      last_attendance_at = now(),
      last_real_activity_at = now(),
      updated_at = now()
    where id = v_booking.student_id;
  elsif status = 'absent' then
    update public.bookings
    set
      status = 'no_show',
      charged_as_attended = v_charged_as_attended,
      updated_at = now()
    where id = v_booking.id
    returning * into v_booking;
  else
    -- Justified is an administrative attendance note only. Cancellation and
    -- credit return stay exclusively in RANV2-06 cancel_booking.
    if v_booking.status in ('attended'::public.booking_status, 'no_show'::public.booking_status) then
      update public.bookings
      set
        status = 'booked',
        updated_at = now()
      where id = v_booking.id
      returning * into v_booking;
    else
      select * into v_booking
      from public.bookings b
      where b.id = mark_attendance.booking_id;
    end if;
  end if;

  perform private.refresh_profile_attendance_markers(v_booking.student_id);

  insert into public.audit_logs (actor_id, entity_type, entity_id, action, metadata)
  values (
    v_actor,
    'attendance',
    v_attendance.id,
    v_action,
    jsonb_build_object(
      'booking_id', v_booking.id,
      'student_id', v_booking.student_id,
      'session_id', v_booking.session_id,
      'status', v_attendance.status,
      'previous_status', v_previous.status,
      'previous_booking_status', v_previous_booking_status,
      'booking_status', v_booking.status,
      'charged_as_attended', v_attendance.charged_as_attended,
      'notes', nullif(btrim(coalesce(notes, '')), '')
    )
  );

  return jsonb_build_object(
    'attendance_id', v_attendance.id,
    'booking_id', v_booking.id,
    'booking_status', v_booking.status,
    'attendance_status', v_attendance.status,
    'charged_as_attended', v_attendance.charged_as_attended,
    'action', v_action
  );
end;
$$;

revoke all on function public.list_attendance_sessions(date, date) from public, anon;
revoke all on function public.mark_attendance(uuid, public.attendance_status, text) from public, anon;
revoke all on function private.refresh_profile_attendance_markers(uuid) from public, anon;

grant execute on function public.list_attendance_sessions(date, date) to authenticated;
grant execute on function public.mark_attendance(uuid, public.attendance_status, text) to authenticated;
