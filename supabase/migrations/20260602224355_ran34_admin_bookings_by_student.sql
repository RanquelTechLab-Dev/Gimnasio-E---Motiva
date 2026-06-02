-- RAN-34: admin booking by student, and stop creating new justified attendance
-- records from manual admin cancellation.
--
-- Safety:
-- - No data is deleted.
-- - Historical attendance.status = 'justified' records remain valid.
-- - Admin booking/cancellation actions are explicit RPCs and are audited.

create or replace function public.admin_list_calendar_sessions_for_student(
  p_student_id uuid,
  from_date timestamptz,
  to_date timestamptz
)
returns table (
  session_id uuid,
  recurring_rule_id uuid,
  activity_id uuid,
  activity_name text,
  activity_slug text,
  activity_color_hex text,
  requires_24h_cancel boolean,
  booking_cutoff_hours integer,
  cancellation_cutoff_hours integer,
  booking_deadline timestamptz,
  cancellation_deadline timestamptz,
  title text,
  starts_at timestamptz,
  ends_at timestamptz,
  capacity integer,
  trainer_name text,
  notes text,
  active boolean,
  cancelled_at timestamptz,
  reserved_count integer,
  spots_left integer,
  own_booking_id uuid,
  own_booking_status public.booking_status,
  can_book boolean,
  block_reason text,
  plan_type text,
  weekly_class_limit integer,
  weekly_classes_used integer,
  weekly_classes_remaining integer,
  package_classes_remaining integer
)
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_actor uuid := auth.uid();
  v_student public.profiles%rowtype;
begin
  if v_actor is null or not coalesce(private.is_admin(), false) then
    raise exception 'Solo un admin activo puede ver clases por alumno.';
  end if;

  if p_student_id is null then
    raise exception 'Alumno requerido.';
  end if;

  select *
  into v_student
  from public.profiles p
  where p.id = p_student_id
    and p.role = 'student'::public.user_role
    and p.active = true;

  if not found then
    raise exception 'Alumno no encontrado o inactivo.';
  end if;

  return query
  with session_rows as (
    select
      s.*,
      a.name as activity_name,
      a.slug as activity_slug,
      a.color_hex as activity_color_hex,
      a.requires_24h_cancel,
      a.booking_cutoff_hours,
      a.cancellation_cutoff_hours,
      private.class_reservation_cutoff(s.starts_at, a.booking_cutoff_hours) as reservation_cutoff,
      s.starts_at - make_interval(hours => greatest(coalesce(a.cancellation_cutoff_hours, 3), 0)) as cancellation_cutoff,
      private.class_reservation_block_reason(s.starts_at, a.booking_cutoff_hours) as reservation_block_reason,
      a.active as activity_active,
      (
        select count(*)::int
        from public.bookings b
        left join public.attendance att on att.booking_id = b.id
        where b.session_id = s.id
          and b.status in (
            'booked'::public.booking_status,
            'attended'::public.booking_status,
            'no_show'::public.booking_status
          )
          and coalesce(att.status <> 'justified'::public.attendance_status, true)
      ) as active_bookings,
      (
        select b.id
        from public.bookings b
        where b.session_id = s.id
          and b.student_id = p_student_id
          and b.status = 'booked'::public.booking_status
        limit 1
      ) as own_booking_id,
      (
        select b.status
        from public.bookings b
        where b.session_id = s.id
          and b.student_id = p_student_id
        order by b.created_at desc
        limit 1
      ) as own_booking_status,
      em.plan_type,
      em.weekly_class_limit,
      coalesce(em.weekly_classes_used, 0)::int as weekly_classes_used,
      case
        when em.plan_type <> 'package' and em.weekly_class_limit is not null
          then greatest(em.weekly_class_limit - coalesce(em.weekly_classes_used, 0), 0)::int
        else null
      end as weekly_classes_remaining,
      case
        when em.plan_type = 'package' then em.remaining_credits
        else null
      end as package_classes_remaining,
      (
        em.membership_id is not null
        and private.membership_is_fully_paid(em.membership_id)
        and (
          (em.plan_type = 'package' and coalesce(em.remaining_credits, 0) > 0)
          or (
            em.plan_type <> 'package'
            and em.weekly_class_limit is not null
            and coalesce(em.weekly_classes_used, 0) < em.weekly_class_limit
          )
        )
      ) as has_eligible_membership,
      coalesce(exhausted.weekly_limit_exhausted, false) as weekly_limit_exhausted,
      coalesce(unpaid.has_unpaid_membership, false) as has_unpaid_membership
    from public.class_sessions s
    join public.activities a on a.id = s.activity_id
    left join lateral (
      select
        candidate.membership_id,
        candidate.remaining_credits,
        candidate.plan_type,
        candidate.weekly_class_limit,
        candidate.weekly_classes_used
      from (
        select
          m.id as membership_id,
          m.remaining_credits,
          m.end_date,
          m.created_at,
          p.plan_type,
          coalesce(pa.weekly_class_limit, pa.monthly_credits, p.package_class_count) as weekly_class_limit,
          case
            when p.plan_type <> 'package' then private.weekly_activity_usage(
              p_student_id,
              m.id,
              s.activity_id,
              s.starts_at
            )
            else null
          end as weekly_classes_used
        from public.memberships m
        join public.plans p on p.id = m.plan_id
        join public.plan_activities pa on pa.plan_id = m.plan_id
        where m.student_id = p_student_id
          and m.status = 'active'::public.membership_status
          and s.starts_at::date between m.start_date and m.end_date
          and pa.activity_id = s.activity_id
          and private.membership_is_fully_paid(m.id)
          and (
            (p.plan_type = 'package' and coalesce(m.remaining_credits, 0) > 0)
            or (
              p.plan_type <> 'package'
              and coalesce(pa.weekly_class_limit, pa.monthly_credits, p.package_class_count) is not null
            )
          )
      ) candidate
      where (
        candidate.plan_type = 'package'
        and coalesce(candidate.remaining_credits, 0) > 0
      ) or (
        candidate.plan_type <> 'package'
        and candidate.weekly_class_limit is not null
        and coalesce(candidate.weekly_classes_used, 0) < candidate.weekly_class_limit
      )
      order by candidate.end_date asc, candidate.created_at asc
      limit 1
    ) em on true
    left join lateral (
      select true as weekly_limit_exhausted
      from public.memberships m
      join public.plans p on p.id = m.plan_id
      join public.plan_activities pa on pa.plan_id = m.plan_id
      where m.student_id = p_student_id
        and m.status = 'active'::public.membership_status
        and private.membership_is_fully_paid(m.id)
        and p.plan_type <> 'package'
        and s.starts_at::date between m.start_date and m.end_date
        and pa.activity_id = s.activity_id
        and coalesce(pa.weekly_class_limit, pa.monthly_credits, p.package_class_count) is not null
        and private.weekly_activity_usage(
          p_student_id,
          m.id,
          s.activity_id,
          s.starts_at
        ) >= coalesce(pa.weekly_class_limit, pa.monthly_credits, p.package_class_count)
      order by m.end_date asc, m.created_at asc
      limit 1
    ) exhausted on true
    left join lateral (
      select true as has_unpaid_membership
      from public.memberships m
      join public.plan_activities pa on pa.plan_id = m.plan_id
      where m.student_id = p_student_id
        and s.starts_at::date between m.start_date and m.end_date
        and pa.activity_id = s.activity_id
        and (
          m.status <> 'active'::public.membership_status
          or private.membership_is_fully_paid(m.id) is false
        )
      limit 1
    ) unpaid on true
    where s.starts_at >= admin_list_calendar_sessions_for_student.from_date
      and s.starts_at < admin_list_calendar_sessions_for_student.to_date
  )
  select
    sr.id,
    sr.recurring_rule_id,
    sr.activity_id,
    sr.activity_name,
    sr.activity_slug,
    sr.activity_color_hex,
    sr.requires_24h_cancel,
    sr.booking_cutoff_hours,
    sr.cancellation_cutoff_hours,
    sr.reservation_cutoff,
    sr.cancellation_cutoff,
    sr.title,
    sr.starts_at,
    sr.ends_at,
    sr.capacity,
    sr.trainer_name,
    sr.notes,
    sr.active,
    sr.cancelled_at,
    sr.active_bookings,
    greatest(sr.capacity - sr.active_bookings, 0),
    sr.own_booking_id,
    sr.own_booking_status,
    case
      when sr.active is not true or sr.cancelled_at is not null then false
      when sr.starts_at <= now() then false
      when sr.activity_active is not true then false
      when sr.own_booking_id is not null then false
      when sr.active_bookings >= sr.capacity then false
      when sr.has_eligible_membership is not true then false
      else true
    end as can_book,
    case
      when sr.active is not true or sr.cancelled_at is not null then 'Clase cancelada o inactiva'
      when sr.starts_at <= now() then 'La clase ya comenzo'
      when sr.activity_active is not true then 'Actividad inactiva'
      when sr.own_booking_id is not null then 'Ya tiene una reserva activa'
      when sr.active_bookings >= sr.capacity then 'Sin cupos disponibles'
      when sr.has_unpaid_membership then 'Programa sin pago completo'
      when sr.plan_type <> 'package' and coalesce(sr.weekly_classes_remaining, 0) <= 0 then 'Limite semanal alcanzado'
      when sr.has_eligible_membership is not true and sr.weekly_limit_exhausted then 'Limite semanal alcanzado'
      when sr.has_eligible_membership is not true then 'Sin programa activo que permita esta clase'
      else null
    end as block_reason,
    sr.plan_type,
    sr.weekly_class_limit,
    sr.weekly_classes_used,
    sr.weekly_classes_remaining,
    sr.package_classes_remaining
  from session_rows sr
  order by sr.starts_at asc;
end;
$$;

create or replace function public.admin_book_class_for_student(
  p_student_id uuid,
  p_session_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_actor uuid := auth.uid();
  v_student public.profiles%rowtype;
  v_session public.class_sessions%rowtype;
  v_activity public.activities%rowtype;
  v_membership public.memberships%rowtype;
  v_plan public.plans%rowtype;
  v_membership_selection record;
  v_existing_booking public.bookings%rowtype;
  v_found_existing boolean := false;
  v_weekly_limit int;
  v_weekly_used int := 0;
  v_weekly_exhausted boolean := false;
  v_active_bookings integer;
  v_booking public.bookings%rowtype;
  v_classes_charged integer := 0;
begin
  if v_actor is null or not coalesce(private.is_admin(), false) then
    raise exception 'Solo un admin activo puede reservar por alumno.';
  end if;

  if p_student_id is null or p_session_id is null then
    raise exception 'Alumno y clase son requeridos.';
  end if;

  select *
  into v_student
  from public.profiles p
  where p.id = p_student_id
    and p.role = 'student'::public.user_role
    and p.active = true;

  if not found then
    raise exception 'Alumno no encontrado o inactivo.';
  end if;

  select *
  into v_session
  from public.class_sessions s
  where s.id = p_session_id
  for update;

  if not found then
    raise exception 'La clase no existe.';
  end if;

  if v_session.active is not true or v_session.cancelled_at is not null then
    raise exception 'La clase no esta activa.';
  end if;

  if v_session.starts_at <= now() then
    raise exception 'No se puede reservar una clase que ya comenzo.';
  end if;

  select *
  into v_activity
  from public.activities a
  where a.id = v_session.activity_id
    and a.active = true;

  if not found then
    raise exception 'La actividad no esta disponible.';
  end if;

  select *
  into v_existing_booking
  from public.bookings b
  where b.session_id = v_session.id
    and b.student_id = p_student_id
  order by b.created_at desc
  limit 1
  for update;
  v_found_existing := found;

  if v_found_existing and v_existing_booking.status = 'booked'::public.booking_status then
    raise exception 'El alumno ya tiene una reserva activa para esta clase.';
  end if;

  if v_found_existing and v_existing_booking.status in (
    'attended'::public.booking_status,
    'no_show'::public.booking_status
  ) then
    raise exception 'La clase ya tiene historial cerrado para este alumno.';
  end if;

  if v_found_existing
    and v_existing_booking.status = 'cancelled'::public.booking_status
    and exists (
      select 1
      from public.attendance att
      where att.booking_id = v_existing_booking.id
    ) then
    raise exception 'La reserva cancelada tiene historial de asistencia y no se puede reutilizar.';
  end if;

  select count(*) into v_active_bookings
  from public.bookings b
  left join public.attendance att on att.booking_id = b.id
  where b.session_id = v_session.id
    and b.status in (
      'booked'::public.booking_status,
      'attended'::public.booking_status,
      'no_show'::public.booking_status
    )
    and coalesce(att.status <> 'justified'::public.attendance_status, true);

  if v_active_bookings >= v_session.capacity then
    raise exception 'No hay cupos disponibles para esta clase.';
  end if;

  select
    m.id as membership_id,
    p.id as plan_id,
    coalesce(pa.weekly_class_limit, pa.monthly_credits, p.package_class_count) as weekly_class_limit,
    case
      when p.plan_type <> 'package' then private.weekly_activity_usage(
        p_student_id,
        m.id,
        v_session.activity_id,
        v_session.starts_at
      )
      else null
    end as weekly_classes_used
  into v_membership_selection
  from public.memberships m
  join public.plans p on p.id = m.plan_id
  join public.plan_activities pa on pa.plan_id = m.plan_id
  where m.student_id = p_student_id
    and m.status = 'active'::public.membership_status
    and private.membership_is_fully_paid(m.id)
    and v_session.starts_at::date between m.start_date and m.end_date
    and pa.activity_id = v_session.activity_id
    and (
      (p.plan_type = 'package' and coalesce(m.remaining_credits, 0) > 0)
      or (
        p.plan_type <> 'package'
        and coalesce(pa.weekly_class_limit, pa.monthly_credits, p.package_class_count) is not null
        and private.weekly_activity_usage(
          p_student_id,
          m.id,
          v_session.activity_id,
          v_session.starts_at
        ) < coalesce(pa.weekly_class_limit, pa.monthly_credits, p.package_class_count)
      )
    )
  order by m.end_date asc, m.created_at asc
  limit 1
  for update of m;

  if not found then
    select exists (
      select 1
      from public.memberships m
      join public.plans p on p.id = m.plan_id
      join public.plan_activities pa on pa.plan_id = m.plan_id
      where m.student_id = p_student_id
        and m.status = 'active'::public.membership_status
        and private.membership_is_fully_paid(m.id)
        and p.plan_type <> 'package'
        and v_session.starts_at::date between m.start_date and m.end_date
        and pa.activity_id = v_session.activity_id
        and coalesce(pa.weekly_class_limit, pa.monthly_credits, p.package_class_count) is not null
        and private.weekly_activity_usage(
          p_student_id,
          m.id,
          v_session.activity_id,
          v_session.starts_at
        ) >= coalesce(pa.weekly_class_limit, pa.monthly_credits, p.package_class_count)
    )
    into v_weekly_exhausted;

    if v_weekly_exhausted then
      raise exception 'Ya alcanzo el limite de clases de esta semana para este plan.';
    end if;

    raise exception 'No hay programa activo y pago que permita esta clase.';
  end if;

  select * into v_membership
  from public.memberships m
  where m.id = v_membership_selection.membership_id;

  select * into v_plan
  from public.plans p
  where p.id = v_membership_selection.plan_id;

  v_weekly_limit := v_membership_selection.weekly_class_limit;
  v_weekly_used := coalesce(v_membership_selection.weekly_classes_used, 0);

  if v_plan.plan_type = 'package' then
    if coalesce(v_membership.remaining_credits, 0) <= 0 then
      raise exception 'No quedan clases disponibles en este paquete.';
    end if;

    update public.memberships
    set
      remaining_credits = remaining_credits - 1,
      updated_at = now()
    where id = v_membership.id
    returning * into v_membership;
    v_classes_charged := 1;
  else
    if v_weekly_limit is null then
      raise exception 'El plan no tiene limite de clases configurado.';
    end if;

    if v_weekly_used >= v_weekly_limit then
      raise exception 'Ya alcanzo el limite de clases de esta semana para este plan.';
    end if;
  end if;

  if v_found_existing and v_existing_booking.status = 'cancelled'::public.booking_status then
    update public.bookings
    set
      membership_id = v_membership.id,
      status = 'booked'::public.booking_status,
      booked_at = now(),
      cancelled_at = null,
      cancelled_by = null,
      cancel_reason = null,
      charged_as_attended = false,
      credits_charged = v_classes_charged,
      credit_returned_at = null,
      updated_at = now()
    where id = v_existing_booking.id
    returning * into v_booking;
  else
    insert into public.bookings (
      session_id,
      student_id,
      membership_id,
      credits_charged
    )
    values (
      v_session.id,
      p_student_id,
      v_membership.id,
      v_classes_charged
    )
    returning * into v_booking;
  end if;

  insert into public.audit_logs (actor_id, entity_type, entity_id, action, metadata)
  values (
    v_actor,
    'booking',
    v_booking.id,
    'booking.created_by_admin',
    jsonb_build_object(
      'student_id', p_student_id,
      'session_id', v_session.id,
      'activity_id', v_session.activity_id,
      'membership_id', v_booking.membership_id,
      'plan_type', v_plan.plan_type,
      'weekly_limit', v_weekly_limit,
      'weekly_used_before_booking', v_weekly_used,
      'classes_charged', v_booking.credits_charged,
      'source', 'admin.attendance.book_by_student'
    )
  );

  return jsonb_build_object(
    'booking_id', v_booking.id,
    'session_id', v_booking.session_id,
    'student_id', v_booking.student_id,
    'membership_id', v_booking.membership_id,
    'classes_charged', v_booking.credits_charged,
    'status', v_booking.status
  );
end;
$$;

create or replace function public.admin_cancel_booking(
  p_booking_id uuid,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_actor uuid := auth.uid();
  v_booking public.bookings%rowtype;
  v_previous_booking_status public.booking_status;
  v_session public.class_sessions%rowtype;
  v_attendance public.attendance%rowtype;
  v_previous_attendance public.attendance%rowtype;
  v_had_attendance boolean := false;
  v_should_return_credit boolean := false;
  v_credit_returned boolean := false;
begin
  if v_actor is null or not coalesce(private.is_admin(), false) then
    raise exception 'Solo un admin activo puede cancelar reservas manualmente.';
  end if;

  select *
  into v_booking
  from public.bookings b
  where b.id = p_booking_id
  for update;

  if not found then
    raise exception 'La reserva no existe.';
  end if;

  v_previous_booking_status := v_booking.status;

  if v_booking.status <> 'booked'::public.booking_status then
    raise exception 'La reserva no esta activa.';
  end if;

  select *
  into v_session
  from public.class_sessions s
  where s.id = v_booking.session_id;

  if not found then
    raise exception 'La clase no existe.';
  end if;

  select *
  into v_previous_attendance
  from public.attendance att
  where att.booking_id = v_booking.id
  for update;
  v_had_attendance := found;

  v_should_return_credit :=
    v_booking.credits_charged > 0
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
    status = 'cancelled'::public.booking_status,
    cancelled_at = now(),
    cancelled_by = v_actor,
    cancel_reason = nullif(btrim(coalesce(p_reason, '')), ''),
    charged_as_attended = false,
    credit_returned_at = case
      when v_should_return_credit then now()
      else credit_returned_at
    end,
    updated_at = now()
  where id = v_booking.id
  returning * into v_booking;

  if v_had_attendance then
    update public.attendance
    set
      notes = coalesce(nullif(btrim(coalesce(p_reason, '')), ''), notes),
      charged_as_attended = false,
      updated_at = now()
    where booking_id = v_booking.id
    returning * into v_attendance;
  end if;

  perform private.refresh_profile_attendance_markers(v_booking.student_id);

  v_credit_returned := v_should_return_credit and v_booking.credit_returned_at is not null;

  insert into public.audit_logs (actor_id, entity_type, entity_id, action, metadata)
  values (
    v_actor,
    'booking',
    v_booking.id,
    'booking.cancelled_by_admin',
    jsonb_build_object(
      'booking_id', v_booking.id,
      'student_id', v_booking.student_id,
      'session_id', v_booking.session_id,
      'membership_id', v_booking.membership_id,
      'source', 'admin.attendance',
      'reason', nullif(btrim(coalesce(p_reason, '')), ''),
      'credits_charged', v_booking.credits_charged,
      'credit_returned', v_credit_returned,
      'charged_as_attended', false,
      'previous_booking_status', v_previous_booking_status,
      'booking_status', v_booking.status,
      'previous_attendance_status', v_previous_attendance.status,
      'attendance_status', v_attendance.status,
      'processed_at', now()
    )
  );

  return jsonb_build_object(
    'booking_id', v_booking.id,
    'status', v_booking.status,
    'credit_returned', v_credit_returned,
    'charged_as_attended', false,
    'attendance_id', v_attendance.id,
    'attendance_status', v_attendance.status
  );
end;
$$;

revoke all on function public.admin_list_calendar_sessions_for_student(uuid, timestamptz, timestamptz) from public, anon;
revoke all on function public.admin_book_class_for_student(uuid, uuid) from public, anon;
revoke all on function public.admin_cancel_booking(uuid, text) from public, anon;

grant execute on function public.admin_list_calendar_sessions_for_student(uuid, timestamptz, timestamptz) to authenticated;
grant execute on function public.admin_book_class_for_student(uuid, uuid) to authenticated;
grant execute on function public.admin_cancel_booking(uuid, text) to authenticated;
