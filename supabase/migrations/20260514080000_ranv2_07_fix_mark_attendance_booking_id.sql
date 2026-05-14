-- RANV2-07: fix ambiguous booking_id references in mark_attendance.

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
  v_input_booking_id uuid := $1;
  v_input_status public.attendance_status := $2;
  v_input_notes text := $3;
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

  if v_input_status is null then
    raise exception 'El estado de asistencia es obligatorio.';
  end if;

  select b.* into v_booking
  from public.bookings b
  where b.id = v_input_booking_id
  for update;

  if not found then
    raise exception 'La reserva no existe. La asistencia requiere una reserva.';
  end if;

  select s.* into v_session
  from public.class_sessions s
  where s.id = v_booking.session_id;

  if not found then
    raise exception 'La clase asociada no existe.';
  end if;

  select a.* into v_activity
  from public.activities a
  where a.id = v_session.activity_id;

  if not found then
    raise exception 'La actividad asociada no existe.';
  end if;

  if v_booking.status = 'cancelled'::public.booking_status
    and v_input_status <> 'justified'::public.attendance_status then
    raise exception 'Una reserva cancelada solo puede registrarse como justificada.';
  end if;

  v_previous_booking_status := v_booking.status;

  select att.* into v_previous
  from public.attendance att
  where att.booking_id = v_booking.id
  for update;

  v_action := case when found then 'attendance.updated' else 'attendance.marked' end;
  v_charged_as_attended := coalesce(v_booking.charged_as_attended, false)
    or (v_input_status = 'absent'::public.attendance_status and v_activity.requires_24h_cancel);

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
    v_input_status,
    v_actor,
    v_session.ends_at,
    nullif(btrim(coalesce(v_input_notes, '')), ''),
    v_charged_as_attended,
    'admin',
    now()
  )
  on conflict on constraint attendance_booking_id_key do update
  set
    status = excluded.status,
    recorded_by = excluded.recorded_by,
    recorded_at = excluded.recorded_at,
    notes = excluded.notes,
    charged_as_attended = excluded.charged_as_attended,
    source = excluded.source,
    updated_at = now()
  returning * into v_attendance;

  if v_input_status = 'present'::public.attendance_status then
    update public.bookings b
    set
      status = 'attended'::public.booking_status,
      updated_at = now()
    where b.id = v_booking.id
    returning b.* into v_booking;
  elsif v_input_status = 'absent'::public.attendance_status then
    update public.bookings b
    set
      status = 'no_show'::public.booking_status,
      charged_as_attended = v_charged_as_attended,
      updated_at = now()
    where b.id = v_booking.id
    returning b.* into v_booking;
  else
    -- Justified is an administrative attendance note only. Cancellation and
    -- credit return stay exclusively in RANV2-06 cancel_booking.
    if v_booking.status in ('attended'::public.booking_status, 'no_show'::public.booking_status) then
      update public.bookings b
      set
        status = 'booked'::public.booking_status,
        updated_at = now()
      where b.id = v_booking.id
      returning b.* into v_booking;
    else
      select b.* into v_booking
      from public.bookings b
      where b.id = v_input_booking_id;
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
      'class_started_at', v_session.starts_at,
      'class_ended_at', v_session.ends_at,
      'processed_at', now(),
      'recorded_at', v_session.ends_at,
      'source', 'admin',
      'notes', nullif(btrim(coalesce(v_input_notes, '')), '')
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

revoke all on function public.mark_attendance(uuid, public.attendance_status, text) from public, anon;
grant execute on function public.mark_attendance(uuid, public.attendance_status, text) to authenticated;
