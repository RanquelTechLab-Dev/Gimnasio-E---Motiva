-- RANV2-07: automatic attendance finalization for non-cancelled bookings.

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

  select max(activity_at) into v_last_payment_at
  from (
    select pay.approved_at as activity_at
    from public.payments pay
    where pay.student_id = p_student_id
      and pay.status = 'approved'::public.payment_status
    union all
    select p.last_payment_at
    from public.profiles p
    where p.id = p_student_id
  ) payment_activity
  where activity_at is not null;

  select max(activity_at) into v_last_real_activity_at
  from (
    values (v_last_attendance_at), (v_last_payment_at)
  ) real_activity(activity_at)
  where activity_at is not null;

  update public.profiles
  set
    last_attendance_at = v_last_attendance_at,
    last_real_activity_at = v_last_real_activity_at,
    updated_at = now()
  where id = p_student_id;
end;
$$;

create or replace function public.auto_finalize_attendance(
  from_date date,
  to_date date
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_actor uuid := auth.uid();
  v_row record;
  v_attendance public.attendance%rowtype;
  v_finalized_count integer := 0;
begin
  if v_actor is null or not private.is_admin() then
    raise exception 'Solo un admin activo puede finalizar asistencia automatica.';
  end if;

  if from_date is null or to_date is null or to_date < from_date then
    raise exception 'El rango de fechas no es valido.';
  end if;

  for v_row in
    select
      b.id as booking_id,
      b.student_id,
      b.session_id,
      b.status as booking_status,
      b.charged_as_attended,
      s.starts_at,
      s.ends_at,
      s.cancelled_at,
      a.requires_24h_cancel
    from public.bookings b
    join public.class_sessions s on s.id = b.session_id
    join public.activities a on a.id = s.activity_id
    left join public.attendance att on att.booking_id = b.id
    where s.starts_at >= (from_date::timestamp at time zone 'America/Argentina/Buenos_Aires')
      and s.starts_at < ((to_date + 1)::timestamp at time zone 'America/Argentina/Buenos_Aires')
      and s.ends_at <= now()
      and s.cancelled_at is null
      and b.status = 'booked'::public.booking_status
      and att.id is null
    for update of b
  loop
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
      v_row.booking_id,
      v_row.student_id,
      v_row.session_id,
      'present'::public.attendance_status,
      v_actor,
      now(),
      'Asistencia automatica por reserva no cancelada.',
      coalesce(v_row.charged_as_attended, false),
      'auto',
      now()
    )
    returning * into v_attendance;

    update public.bookings
    set
      status = 'attended'::public.booking_status,
      updated_at = now()
    where id = v_row.booking_id;

    perform private.refresh_profile_attendance_markers(v_row.student_id);

    insert into public.audit_logs (actor_id, entity_type, entity_id, action, metadata)
    values (
      v_actor,
      'attendance',
      v_attendance.id,
      'attendance.auto_marked',
      jsonb_build_object(
        'booking_id', v_row.booking_id,
        'student_id', v_row.student_id,
        'session_id', v_row.session_id,
        'status', v_attendance.status,
        'previous_status', null,
        'previous_booking_status', v_row.booking_status,
        'booking_status', 'attended',
        'charged_as_attended', v_attendance.charged_as_attended,
        'source', 'auto'
      )
    );

    v_finalized_count := v_finalized_count + 1;
  end loop;

  return jsonb_build_object(
    'finalized_count', v_finalized_count,
    'from_date', from_date,
    'to_date', to_date
  );
end;
$$;

revoke all on function private.refresh_profile_attendance_markers(uuid) from public, anon;
revoke all on function public.auto_finalize_attendance(date, date) from public, anon;

grant execute on function public.auto_finalize_attendance(date, date) to authenticated;
