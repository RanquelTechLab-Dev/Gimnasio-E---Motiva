create or replace function public.cancel_booking(
  booking_id uuid,
  reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_input_booking_id uuid := $1;
  v_input_reason text := $2;
  v_actor uuid := auth.uid();
  v_is_admin boolean;
  v_booking public.bookings%rowtype;
  v_previous_booking_status public.booking_status;
  v_session public.class_sessions%rowtype;
  v_activity public.activities%rowtype;
  v_window_hours integer;
  v_within_window boolean := false;
  v_should_return_credit boolean := false;
  v_credit_returned boolean := false;
  v_charged_as_attended boolean := false;
begin
  if v_actor is null then
    raise exception 'Se requiere sesion activa.';
  end if;

  v_is_admin := private.is_admin();

  select * into v_booking
  from public.bookings b
  where b.id = v_input_booking_id
  for update;

  if not found then
    raise exception 'La reserva no existe.';
  end if;

  v_previous_booking_status := v_booking.status;

  if not v_is_admin and v_booking.student_id <> v_actor then
    raise exception 'No se puede cancelar una reserva de otro alumno.';
  end if;

  if v_booking.status <> 'booked' then
    raise exception 'La reserva no esta activa.';
  end if;

  select * into v_session
  from public.class_sessions s
  where s.id = v_booking.session_id;

  if not found then
    raise exception 'La clase no existe.';
  end if;

  select * into v_activity
  from public.activities a
  where a.id = v_session.activity_id;

  if not found then
    raise exception 'La actividad no existe.';
  end if;

  v_window_hours := case
    when v_activity.requires_24h_cancel then 24
    else 12
  end;

  v_within_window := now() <= (v_session.starts_at - make_interval(hours => v_window_hours));

  if not v_within_window and not v_is_admin then
    if v_activity.requires_24h_cancel then
      raise exception 'La cancelacion de personalizado 1:1 debe realizarse al menos 24 horas antes de la clase.';
    end if;

    raise exception 'La cancelacion debe realizarse al menos 12 horas antes de la clase.';
  end if;

  v_should_return_credit :=
    v_within_window
    and v_booking.credits_charged > 0
    and v_booking.credit_returned_at is null
    and v_booking.membership_id is not null;

  if v_should_return_credit then
    update public.memberships
    set
      remaining_credits = remaining_credits + v_booking.credits_charged,
      updated_at = now()
    where id = v_booking.membership_id
      and remaining_credits is not null;
  end if;

  update public.bookings
  set
    status = 'cancelled',
    cancelled_at = now(),
    cancelled_by = v_actor,
    cancel_reason = nullif(btrim(coalesce(v_input_reason, '')), ''),
    charged_as_attended = case
      when v_within_window then false
      else true
    end,
    credit_returned_at = case
      when v_should_return_credit then now()
      else credit_returned_at
    end,
    updated_at = now()
  where id = v_booking.id
  returning * into v_booking;

  v_credit_returned := v_should_return_credit and v_booking.credit_returned_at is not null;
  v_charged_as_attended := coalesce(v_booking.charged_as_attended, false);

  insert into public.audit_logs (actor_id, entity_type, entity_id, action, metadata)
  values (
    v_actor,
    'booking',
    v_booking.id,
    'booking.cancelled',
    jsonb_build_object(
      'booking_id', v_booking.id,
      'student_id', v_booking.student_id,
      'session_id', v_booking.session_id,
      'activity_id', v_session.activity_id,
      'membership_id', v_booking.membership_id,
      'requires_24h_cancel', v_activity.requires_24h_cancel,
      'cancellation_window_hours', v_window_hours,
      'starts_at', v_session.starts_at,
      'requested_at', now(),
      'within_window', v_within_window,
      'credits_charged', v_booking.credits_charged,
      'credit_returned', v_credit_returned,
      'charged_as_attended', v_charged_as_attended,
      'previous_booking_status', v_previous_booking_status,
      'booking_status', v_booking.status,
      'reason', nullif(btrim(coalesce(v_input_reason, '')), '')
    )
  );

  return jsonb_build_object(
    'booking_id', v_booking.id,
    'status', v_booking.status,
    'credit_returned', v_credit_returned,
    'charged_as_attended', v_charged_as_attended,
    'cancellation_window_hours', v_window_hours,
    'within_window', v_within_window
  );
end;
$$;

create or replace function public.list_my_bookings()
returns table (
  booking_id uuid,
  session_id uuid,
  activity_name text,
  activity_slug text,
  title text,
  starts_at timestamptz,
  ends_at timestamptz,
  booking_status public.booking_status,
  booked_at timestamptz,
  cancelled_at timestamptz,
  cancel_reason text,
  charged_as_attended boolean,
  credits_charged integer,
  credit_returned_at timestamptz,
  can_cancel boolean,
  cancel_block_reason text
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
    b.id,
    s.id,
    a.name,
    a.slug,
    s.title,
    s.starts_at,
    s.ends_at,
    b.status,
    b.booked_at,
    b.cancelled_at,
    b.cancel_reason,
    b.charged_as_attended,
    b.credits_charged,
    b.credit_returned_at,
    case
      when b.status <> 'booked' then false
      when a.requires_24h_cancel then now() <= (s.starts_at - interval '24 hours')
      else now() <= (s.starts_at - interval '12 hours')
    end as can_cancel,
    case
      when b.status <> 'booked' then 'La reserva ya no esta activa'
      when a.requires_24h_cancel and now() > (s.starts_at - interval '24 hours') then 'La cancelacion de personalizado 1:1 debe realizarse al menos 24 horas antes de la clase.'
      when not a.requires_24h_cancel and now() > (s.starts_at - interval '12 hours') then 'La cancelacion debe realizarse al menos 12 horas antes de la clase.'
      else null
    end as cancel_block_reason
  from public.bookings b
  join public.class_sessions s on s.id = b.session_id
  join public.activities a on a.id = s.activity_id
  where b.student_id = v_actor
  order by s.starts_at desc;
end;
$$;

revoke all on function public.cancel_booking(uuid, text) from public, anon;
revoke all on function public.list_my_bookings() from public, anon;

grant execute on function public.cancel_booking(uuid, text) to authenticated;
grant execute on function public.list_my_bookings() to authenticated;
