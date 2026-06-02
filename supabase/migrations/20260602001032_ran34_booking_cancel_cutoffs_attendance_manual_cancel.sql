-- RAN-34: update booking and cancellation cutoffs.
--
-- Student reservations close 3 hours before class start, except classes that
-- start at 07:00 or 08:00 America/Argentina/Buenos_Aires, which close at
-- 21:00 the previous day.
--
-- Student cancellations close 3 hours before every class. Admins can cancel a
-- booking manually from Attendance through admin_cancel_booking, which audits
-- the correction and returns package credits when a credit had been charged.
--
-- No payments, students/profiles, memberships, plans, class sessions,
-- attendance records or bookings are deleted by this migration.

create or replace function private.class_reservation_cutoff(p_starts_at timestamptz)
returns timestamptz
language sql
stable
set search_path = public, private
as $$
  select case
    when to_char(p_starts_at at time zone 'America/Argentina/Buenos_Aires', 'HH24:MI') in ('07:00', '08:00')
      then (
        (
          ((p_starts_at at time zone 'America/Argentina/Buenos_Aires')::date - 1)::timestamp
          + time '21:00'
        ) at time zone 'America/Argentina/Buenos_Aires'
      )
    else p_starts_at - interval '3 hours'
  end;
$$;

create or replace function private.class_reservation_block_reason(p_starts_at timestamptz)
returns text
language sql
stable
set search_path = public, private
as $$
  select case
    when to_char(p_starts_at at time zone 'America/Argentina/Buenos_Aires', 'HH24:MI') in ('07:00', '08:00')
      then 'Las reservas para clases de las 07:00 y 08:00 cierran a las 21:00 del dia anterior.'
    else 'Las reservas cierran 3 horas antes de la clase.'
  end;
$$;

create or replace function private.student_cancel_block_reason()
returns text
language sql
stable
set search_path = public, private
as $$
  select 'Ya no podés cancelar esta reserva desde la app porque faltan menos de 3 horas para la clase. Si reservaste por error, escribile a Carolina para que la cancele manualmente.';
$$;

create or replace function public.book_class_session(session_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_actor uuid := auth.uid();
  v_profile public.profiles%rowtype;
  v_session public.class_sessions%rowtype;
  v_activity public.activities%rowtype;
  v_membership public.memberships%rowtype;
  v_plan public.plans%rowtype;
  v_membership_selection record;
  v_period_limit int;
  v_period_used int := 0;
  v_period_exhausted boolean := false;
  v_active_bookings integer;
  v_booking public.bookings%rowtype;
  v_classes_charged integer := 0;
  v_reservation_cutoff timestamptz;
begin
  if v_actor is null then
    raise exception 'Se requiere sesion activa.';
  end if;

  select * into v_profile
  from public.profiles p
  where p.id = v_actor
    and p.active = true;

  if not found then
    raise exception 'El perfil no existe o esta inactivo.';
  end if;

  select * into v_session
  from public.class_sessions s
  where s.id = book_class_session.session_id
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

  v_reservation_cutoff := private.class_reservation_cutoff(v_session.starts_at);

  if now() > v_reservation_cutoff then
    raise exception '%', private.class_reservation_block_reason(v_session.starts_at);
  end if;

  select * into v_activity
  from public.activities a
  where a.id = v_session.activity_id
    and a.active = true;

  if not found then
    raise exception 'La actividad no esta disponible.';
  end if;

  if exists (
    select 1
    from public.bookings b
    where b.session_id = v_session.id
      and b.student_id = v_actor
      and b.status = 'booked'
  ) then
    raise exception 'El alumno ya tiene una reserva activa para esta clase.';
  end if;

  select count(*) into v_active_bookings
  from public.bookings b
  where b.session_id = v_session.id
    and b.status = 'booked';

  if v_active_bookings >= v_session.capacity then
    raise exception 'No hay cupos disponibles para esta clase.';
  end if;

  select
    m.id as membership_id,
    p.id as plan_id,
    coalesce(pa.monthly_credits, pa.weekly_class_limit, p.package_class_count) as period_class_limit,
    case
      when p.plan_type <> 'package' then (
        select count(*)::int
        from public.bookings b
        join public.class_sessions s on s.id = b.session_id
        where b.student_id = v_actor
          and b.membership_id = m.id
          and s.activity_id = v_session.activity_id
          and b.status in ('booked'::public.booking_status, 'attended'::public.booking_status, 'no_show'::public.booking_status)
          and s.starts_at::date between m.start_date and m.end_date
      )
      else null
    end as period_classes_used
  into v_membership_selection
  from public.memberships m
  join public.plans p on p.id = m.plan_id
  join public.plan_activities pa on pa.plan_id = m.plan_id
  where m.student_id = v_actor
    and m.status = 'active'
    and v_session.starts_at::date between m.start_date and m.end_date
    and pa.activity_id = v_session.activity_id
    and (
      (p.plan_type = 'package' and coalesce(m.remaining_credits, 0) > 0)
      or (
        p.plan_type <> 'package'
        and coalesce(pa.monthly_credits, pa.weekly_class_limit, p.package_class_count) is not null
        and (
          select count(*)::int
          from public.bookings b
          join public.class_sessions s on s.id = b.session_id
          where b.student_id = v_actor
            and b.membership_id = m.id
            and s.activity_id = v_session.activity_id
            and b.status in ('booked'::public.booking_status, 'attended'::public.booking_status, 'no_show'::public.booking_status)
            and s.starts_at::date between m.start_date and m.end_date
        ) < coalesce(pa.monthly_credits, pa.weekly_class_limit, p.package_class_count)
      )
    )
  order by m.end_date asc, m.created_at asc
  limit 1
  for update of m;

  if not found then
    select exists (
      select 1
      from (
        select
          coalesce(pa.monthly_credits, pa.weekly_class_limit, p.package_class_count) as period_class_limit,
          (
            select count(*)::int
            from public.bookings b
            join public.class_sessions s on s.id = b.session_id
            where b.student_id = v_actor
              and b.membership_id = m.id
              and s.activity_id = v_session.activity_id
              and b.status in ('booked'::public.booking_status, 'attended'::public.booking_status, 'no_show'::public.booking_status)
              and s.starts_at::date between m.start_date and m.end_date
          ) as period_classes_used
        from public.memberships m
        join public.plans p on p.id = m.plan_id
        join public.plan_activities pa on pa.plan_id = m.plan_id
        where m.student_id = v_actor
          and m.status = 'active'
          and p.plan_type <> 'package'
          and v_session.starts_at::date between m.start_date and m.end_date
          and pa.activity_id = v_session.activity_id
      ) exhausted
      where exhausted.period_class_limit is not null
        and exhausted.period_classes_used >= exhausted.period_class_limit
    )
    into v_period_exhausted;

    if v_period_exhausted then
      raise exception 'Ya alcanzaste el limite de clases de este periodo para este plan.';
    end if;

    raise exception 'No hay membresia activa que permita esta clase.';
  end if;

  select * into v_membership
  from public.memberships m
  where m.id = v_membership_selection.membership_id;

  select * into v_plan
  from public.plans p
  where p.id = v_membership_selection.plan_id;

  v_period_limit := v_membership_selection.period_class_limit;
  v_period_used := coalesce(v_membership_selection.period_classes_used, 0);

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
    if v_period_limit is null then
      raise exception 'El plan no tiene limite de clases configurado.';
    end if;

    if v_period_used >= v_period_limit then
      raise exception 'Ya alcanzaste el limite de clases de este periodo para este plan.';
    end if;
  end if;

  insert into public.bookings (
    session_id,
    student_id,
    membership_id,
    credits_charged
  )
  values (
    v_session.id,
    v_actor,
    v_membership.id,
    v_classes_charged
  )
  returning * into v_booking;

  insert into public.audit_logs (actor_id, entity_type, entity_id, action, metadata)
  values (
    v_actor,
    'booking',
    v_booking.id,
    'booking.created',
    jsonb_build_object(
      'session_id', v_session.id,
      'activity_id', v_session.activity_id,
      'membership_id', v_booking.membership_id,
      'plan_type', v_plan.plan_type,
      'period_limit', v_period_limit,
      'period_used_before_booking', v_period_used,
      'classes_charged', v_booking.credits_charged,
      'reservation_cutoff', v_reservation_cutoff
    )
  );

  return jsonb_build_object(
    'booking_id', v_booking.id,
    'session_id', v_booking.session_id,
    'membership_id', v_booking.membership_id,
    'classes_charged', v_booking.credits_charged,
    'status', v_booking.status
  );
end;
$$;

create or replace function public.list_calendar_sessions(
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
  v_is_admin boolean := false;
begin
  if v_actor is null then
    raise exception 'Se requiere sesion activa.';
  end if;

  v_is_admin := coalesce(private.is_admin(), false);

  return query
  with session_rows as (
    select
      s.*,
      a.name as activity_name,
      a.slug as activity_slug,
      a.color_hex as activity_color_hex,
      a.requires_24h_cancel,
      a.active as activity_active,
      private.class_reservation_cutoff(s.starts_at) as reservation_cutoff,
      private.class_reservation_block_reason(s.starts_at) as reservation_block_reason,
      (select count(*)::int from public.bookings b where b.session_id = s.id and b.status = 'booked') as active_bookings,
      (select b.id from public.bookings b where b.session_id = s.id and b.student_id = v_actor and b.status = 'booked' limit 1) as own_booking_id,
      (select b.status from public.bookings b where b.session_id = s.id and b.student_id = v_actor order by b.created_at desc limit 1) as own_booking_status,
      em.plan_type,
      em.period_class_limit as weekly_class_limit,
      coalesce(em.period_classes_used, 0)::int as weekly_classes_used,
      case
        when em.plan_type <> 'package' and em.period_class_limit is not null
          then greatest(em.period_class_limit - coalesce(em.period_classes_used, 0), 0)::int
        else null
      end as weekly_classes_remaining,
      case
        when em.plan_type = 'package' then em.remaining_credits
        else null
      end as package_classes_remaining,
      (
        em.membership_id is not null
        and (
          (em.plan_type = 'package' and coalesce(em.remaining_credits, 0) > 0)
          or (
            em.plan_type <> 'package'
            and em.period_class_limit is not null
            and coalesce(em.period_classes_used, 0) < em.period_class_limit
          )
        )
      ) as has_eligible_membership,
      coalesce(exhausted.period_limit_exhausted, false) as period_limit_exhausted
    from public.class_sessions s
    join public.activities a on a.id = s.activity_id
    left join lateral (
      select
        candidate.membership_id,
        candidate.remaining_credits,
        candidate.plan_type,
        candidate.period_class_limit,
        candidate.period_classes_used
      from (
        select
          m.id as membership_id,
          m.remaining_credits,
          m.end_date,
          m.created_at,
          p.plan_type,
          coalesce(pa.monthly_credits, pa.weekly_class_limit, p.package_class_count) as period_class_limit,
          case
            when p.plan_type <> 'package' then (
              select count(*)::int
              from public.bookings b
              join public.class_sessions bs on bs.id = b.session_id
              where b.student_id = v_actor
                and b.membership_id = m.id
                and bs.activity_id = s.activity_id
                and b.status in ('booked'::public.booking_status, 'attended'::public.booking_status, 'no_show'::public.booking_status)
                and bs.starts_at::date between m.start_date and m.end_date
            )
            else null
          end as period_classes_used
        from public.memberships m
        join public.plans p on p.id = m.plan_id
        join public.plan_activities pa on pa.plan_id = m.plan_id
        where m.student_id = v_actor
          and m.status = 'active'
          and s.starts_at::date between m.start_date and m.end_date
          and pa.activity_id = s.activity_id
          and (
            (p.plan_type = 'package' and coalesce(m.remaining_credits, 0) > 0)
            or (
              p.plan_type <> 'package'
              and coalesce(pa.monthly_credits, pa.weekly_class_limit, p.package_class_count) is not null
            )
          )
      ) candidate
      where (
        candidate.plan_type = 'package'
        and coalesce(candidate.remaining_credits, 0) > 0
      ) or (
        candidate.plan_type <> 'package'
        and candidate.period_class_limit is not null
        and coalesce(candidate.period_classes_used, 0) < candidate.period_class_limit
      )
      order by candidate.end_date asc, candidate.created_at asc
      limit 1
    ) em on v_is_admin is false
    left join lateral (
      select true as period_limit_exhausted
      from (
        select
          m.end_date,
          m.created_at,
          coalesce(pa.monthly_credits, pa.weekly_class_limit, p.package_class_count) as period_class_limit,
          (
            select count(*)::int
            from public.bookings b
            join public.class_sessions bs on bs.id = b.session_id
            where b.student_id = v_actor
              and b.membership_id = m.id
              and bs.activity_id = s.activity_id
              and b.status in ('booked'::public.booking_status, 'attended'::public.booking_status, 'no_show'::public.booking_status)
              and bs.starts_at::date between m.start_date and m.end_date
          ) as period_classes_used
        from public.memberships m
        join public.plans p on p.id = m.plan_id
        join public.plan_activities pa on pa.plan_id = m.plan_id
        where m.student_id = v_actor
          and m.status = 'active'
          and p.plan_type <> 'package'
          and s.starts_at::date between m.start_date and m.end_date
          and pa.activity_id = s.activity_id
      ) candidate
      where candidate.period_class_limit is not null
        and candidate.period_classes_used >= candidate.period_class_limit
      order by candidate.end_date asc, candidate.created_at asc
      limit 1
    ) exhausted on v_is_admin is false
    where s.starts_at >= list_calendar_sessions.from_date
      and s.starts_at < list_calendar_sessions.to_date
      and (v_is_admin or (s.active = true and s.cancelled_at is null))
  )
  select
    sr.id,
    sr.recurring_rule_id,
    sr.activity_id,
    sr.activity_name,
    sr.activity_slug,
    sr.activity_color_hex,
    sr.requires_24h_cancel,
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
      when v_is_admin then false
      when sr.active is not true or sr.cancelled_at is not null then false
      when sr.starts_at <= now() then false
      when sr.activity_active is not true then false
      when sr.own_booking_id is not null then false
      when now() > sr.reservation_cutoff then false
      when sr.active_bookings >= sr.capacity then false
      when sr.has_eligible_membership is not true then false
      else true
    end as can_book,
    case
      when v_is_admin then null
      when sr.active is not true or sr.cancelled_at is not null then 'Clase cancelada o inactiva'
      when sr.starts_at <= now() then 'La clase ya comenzo'
      when sr.activity_active is not true then 'Actividad inactiva'
      when sr.own_booking_id is not null then 'Ya tenes una reserva activa'
      when now() > sr.reservation_cutoff then sr.reservation_block_reason
      when sr.active_bookings >= sr.capacity then 'Sin cupos disponibles'
      when sr.plan_type <> 'package' and coalesce(sr.weekly_classes_remaining, 0) <= 0 then 'Ya usaste las clases disponibles de este periodo para esta actividad'
      when sr.has_eligible_membership is not true and sr.period_limit_exhausted then 'Ya usaste las clases disponibles de este periodo para esta actividad'
      when sr.has_eligible_membership is not true then 'Tu membresia no permite esta clase o no tiene clases disponibles'
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
  v_booking public.bookings%rowtype;
  v_previous_booking_status public.booking_status;
  v_session public.class_sessions%rowtype;
  v_should_return_credit boolean := false;
  v_credit_returned boolean := false;
begin
  if v_actor is null then
    raise exception 'Se requiere sesion activa.';
  end if;

  select * into v_booking
  from public.bookings b
  where b.id = v_input_booking_id
  for update;

  if not found then
    raise exception 'La reserva no existe.';
  end if;

  v_previous_booking_status := v_booking.status;

  if v_booking.student_id <> v_actor then
    raise exception 'No se puede cancelar una reserva de otro alumno.';
  end if;

  if v_booking.status <> 'booked'::public.booking_status then
    raise exception 'La reserva no esta activa.';
  end if;

  select * into v_session
  from public.class_sessions s
  where s.id = v_booking.session_id;

  if not found then
    raise exception 'La clase no existe.';
  end if;

  if now() > (v_session.starts_at - interval '3 hours') then
    raise exception '%', private.student_cancel_block_reason();
  end if;

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
    cancel_reason = nullif(btrim(coalesce(v_input_reason, '')), ''),
    charged_as_attended = false,
    credit_returned_at = case
      when v_should_return_credit then now()
      else credit_returned_at
    end,
    updated_at = now()
  where id = v_booking.id
  returning * into v_booking;

  v_credit_returned := v_should_return_credit and v_booking.credit_returned_at is not null;

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
      'membership_id', v_booking.membership_id,
      'cancellation_window_hours', 3,
      'starts_at', v_session.starts_at,
      'requested_at', now(),
      'within_window', true,
      'credits_charged', v_booking.credits_charged,
      'credit_returned', v_credit_returned,
      'charged_as_attended', false,
      'previous_booking_status', v_previous_booking_status,
      'booking_status', v_booking.status,
      'reason', nullif(btrim(coalesce(v_input_reason, '')), '')
    )
  );

  return jsonb_build_object(
    'booking_id', v_booking.id,
    'status', v_booking.status,
    'credit_returned', v_credit_returned,
    'charged_as_attended', false,
    'cancellation_window_hours', 3,
    'within_window', true
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
  if v_actor is null or not private.is_admin() then
    raise exception 'Solo un admin activo puede cancelar reservas manualmente.';
  end if;

  select * into v_booking
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

  select * into v_session
  from public.class_sessions s
  where s.id = v_booking.session_id;

  if not found then
    raise exception 'La clase no existe.';
  end if;

  select * into v_previous_attendance
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
      'justified'::public.attendance_status,
      v_actor,
      now(),
      nullif(btrim(coalesce(p_reason, 'Cancelacion manual desde asistencia.')), ''),
      false,
      'admin',
      now()
    )
    on conflict on constraint attendance_booking_id_key do update
    set
      status = excluded.status,
      recorded_by = excluded.recorded_by,
      recorded_at = excluded.recorded_at,
      notes = excluded.notes,
      charged_as_attended = false,
      source = excluded.source,
      updated_at = now()
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
      when b.status <> 'booked'::public.booking_status then false
      else now() <= (s.starts_at - interval '3 hours')
    end as can_cancel,
    case
      when b.status <> 'booked'::public.booking_status then 'La reserva ya no esta activa'
      when now() > (s.starts_at - interval '3 hours') then private.student_cancel_block_reason()
      else null
    end as cancel_block_reason
  from public.bookings b
  join public.class_sessions s on s.id = b.session_id
  join public.activities a on a.id = s.activity_id
  where b.student_id = v_actor
  order by s.starts_at desc;
end;
$$;

revoke all on function public.book_class_session(uuid) from public, anon;
revoke all on function public.list_calendar_sessions(timestamptz, timestamptz) from public, anon;
revoke all on function public.cancel_booking(uuid, text) from public, anon;
revoke all on function public.admin_cancel_booking(uuid, text) from public, anon;
revoke all on function public.list_my_bookings() from public, anon;

grant execute on function public.book_class_session(uuid) to authenticated;
grant execute on function public.list_calendar_sessions(timestamptz, timestamptz) to authenticated;
grant execute on function public.cancel_booking(uuid, text) to authenticated;
grant execute on function public.admin_cancel_booking(uuid, text) to authenticated;
grant execute on function public.list_my_bookings() to authenticated;
