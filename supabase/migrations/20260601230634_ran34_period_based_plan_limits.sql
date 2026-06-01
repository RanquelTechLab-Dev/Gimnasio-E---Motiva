-- RAN-34: use membership-period reservation limits for legacy weekly plans.
--
-- Semipersonalizado and Neurofuncional plans were technically modeled as
-- plan_type = 'weekly' and used plan_activities.weekly_class_limit as a
-- calendar-week allowance. Walter confirmed those numbers are the contracted
-- class quantity for the paid membership period.
--
-- This migration keeps the API shape for compatibility: weekly_* return fields
-- now carry period-limit values for legacy weekly plans.
--
-- No payments, students/profiles, memberships, plans, bookings, attendance,
-- audit logs or files are deleted.

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
      'classes_charged', v_booking.credits_charged
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

revoke all on function public.book_class_session(uuid) from public, anon;
revoke all on function public.list_calendar_sessions(timestamptz, timestamptz) from public, anon;

grant execute on function public.book_class_session(uuid) to authenticated;
grant execute on function public.list_calendar_sessions(timestamptz, timestamptz) to authenticated;
