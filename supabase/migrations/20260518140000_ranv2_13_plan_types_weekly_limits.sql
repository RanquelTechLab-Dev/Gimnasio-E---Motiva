-- RANV2-13: plan types and weekly booking limits.
-- Keeps existing history intact. Weekly plans no longer spend membership.remaining_credits.

alter table public.plans
  add column if not exists plan_type text not null default 'manual',
  add column if not exists package_class_count int;

alter table public.plan_activities
  add column if not exists weekly_class_limit int;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'plans_plan_type_check'
      and conrelid = 'public.plans'::regclass
  ) then
    alter table public.plans
      add constraint plans_plan_type_check
      check (plan_type in ('weekly', 'package', 'manual'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'plans_package_class_count_check'
      and conrelid = 'public.plans'::regclass
  ) then
    alter table public.plans
      add constraint plans_package_class_count_check
      check (package_class_count is null or package_class_count > 0);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'plan_activities_weekly_class_limit_check'
      and conrelid = 'public.plan_activities'::regclass
  ) then
    alter table public.plan_activities
      add constraint plan_activities_weekly_class_limit_check
      check (weekly_class_limit is null or weekly_class_limit > 0);
  end if;
end $$;

update public.plans
set plan_type = 'weekly',
    package_class_count = null,
    updated_at = now()
where slug in (
  'neurofuncional_3x',
  'semipersonalizado_5x',
  'semipersonalizado_3x',
  'combo_semipersonalizado_funcional',
  'programa_kids_3x',
  'plan_entrenamiento_5x',
  'plan_entrenamiento_3x'
);

update public.plans
set plan_type = 'package',
    package_class_count = case slug
      when 'personalizado_1_clase' then 1
      when 'personalizado_4_clases' then 4
      when 'personalizado_8_clases' then 8
      when 'personalizado_12_clases' then 12
      else package_class_count
    end,
    updated_at = now()
where slug in (
  'personalizado_1_clase',
  'personalizado_4_clases',
  'personalizado_8_clases',
  'personalizado_12_clases'
);

update public.plans
set plan_type = 'manual',
    package_class_count = null,
    updated_at = now()
where slug in (
  'plan_funcional',
  'plan_semi_personalizado',
  'plan_ninos',
  'plan_cognitivo',
  'plan_personalizado_1_1'
);

update public.plan_activities pa
set weekly_class_limit = source.weekly_limit,
    monthly_credits = null
from (
  values
    ('neurofuncional_3x', 'neurofuncional', 3),
    ('semipersonalizado_5x', 'semi_personalizado', 5),
    ('semipersonalizado_3x', 'semi_personalizado', 3),
    ('combo_semipersonalizado_funcional', 'funcional', 3),
    ('combo_semipersonalizado_funcional', 'semi_personalizado', 2),
    ('programa_kids_3x', 'ninos', 3),
    ('plan_entrenamiento_5x', 'plan_entrenamiento', 5),
    ('plan_entrenamiento_3x', 'plan_entrenamiento', 3)
) as source(plan_slug, activity_slug, weekly_limit)
join public.plans p on p.slug = source.plan_slug
join public.activities a on a.slug = source.activity_slug
where pa.plan_id = p.id
  and pa.activity_id = a.id;

update public.plan_activities pa
set weekly_class_limit = null,
    monthly_credits = source.package_count
from (
  values
    ('personalizado_1_clase', 'personalizado_1_1', 1),
    ('personalizado_4_clases', 'personalizado_1_1', 4),
    ('personalizado_8_clases', 'personalizado_1_1', 8),
    ('personalizado_12_clases', 'personalizado_1_1', 12)
) as source(plan_slug, activity_slug, package_count)
join public.plans p on p.slug = source.plan_slug
join public.activities a on a.slug = source.activity_slug
where pa.plan_id = p.id
  and pa.activity_id = a.id;

create or replace function public.assign_membership(
  student_id uuid,
  plan_id uuid,
  start_date date,
  end_date date,
  remaining_credits int default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_actor_id uuid := auth.uid();
  v_student public.profiles%rowtype;
  v_membership public.memberships%rowtype;
  v_plan public.plans%rowtype;
  v_remaining_classes int;
begin
  if v_actor_id is null or not coalesce(private.is_admin(), false) then
    raise exception 'Solo un admin activo puede asignar membresias.';
  end if;

  if start_date is null or end_date is null or end_date < start_date then
    raise exception 'El rango de fechas de membresia es invalido.';
  end if;

  if remaining_credits is not null and remaining_credits < 0 then
    raise exception 'Las clases restantes no pueden ser negativas.';
  end if;

  select * into v_student
  from public.profiles p
  where p.id = assign_membership.student_id
    and p.role = 'student'::public.user_role;

  if not found then
    raise exception 'El alumno no existe.';
  end if;

  select * into v_plan
  from public.plans p
  where p.id = assign_membership.plan_id
    and p.active = true;

  if not found then
    raise exception 'El plan no existe o no esta activo.';
  end if;

  v_remaining_classes := case
    when v_plan.plan_type = 'weekly' then null
    when v_plan.plan_type = 'package' then coalesce(remaining_credits, v_plan.package_class_count)
    else remaining_credits
  end;

  if v_plan.plan_type = 'package' and v_remaining_classes is null then
    raise exception 'El paquete personalizado necesita cantidad de clases.';
  end if;

  insert into public.memberships (
    student_id,
    plan_id,
    status,
    start_date,
    end_date,
    remaining_credits
  )
  values (
    assign_membership.student_id,
    assign_membership.plan_id,
    'active'::public.membership_status,
    assign_membership.start_date,
    assign_membership.end_date,
    v_remaining_classes
  )
  returning * into v_membership;

  update public.profiles
  set
    last_payment_at = coalesce(last_payment_at, now()),
    updated_at = now()
  where id = v_membership.student_id;

  insert into public.audit_logs (actor_id, entity_type, entity_id, action, metadata)
  values (
    v_actor_id,
    'membership',
    v_membership.id,
    'membership.assigned',
    jsonb_build_object(
      'student_id', v_membership.student_id,
      'plan_id', v_membership.plan_id,
      'plan_type', v_plan.plan_type,
      'start_date', v_membership.start_date,
      'end_date', v_membership.end_date,
      'remaining_classes', v_membership.remaining_credits
    )
  );

  return jsonb_build_object(
    'membership_id', v_membership.id,
    'student_id', v_membership.student_id,
    'plan_id', v_membership.plan_id,
    'plan_type', v_plan.plan_type,
    'status', v_membership.status,
    'start_date', v_membership.start_date,
    'end_date', v_membership.end_date,
    'remaining_classes', v_membership.remaining_credits
  );
end;
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
  v_weekly_limit int;
  v_weekly_used int := 0;
  v_weekly_exhausted boolean := false;
  v_week_start timestamp;
  v_week_end timestamp;
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

  v_week_start := date_trunc('week', v_session.starts_at at time zone 'America/Argentina/Buenos_Aires');
  v_week_end := v_week_start + interval '7 days';

  select
    m.id as membership_id,
    p.id as plan_id,
    pa.weekly_class_limit,
    case
      when p.plan_type = 'weekly' then (
        select count(*)::int
        from public.bookings b
        join public.class_sessions s on s.id = b.session_id
        where b.student_id = v_actor
          and b.membership_id = m.id
          and s.activity_id = v_session.activity_id
          and b.status in ('booked'::public.booking_status, 'attended'::public.booking_status, 'no_show'::public.booking_status)
          and (s.starts_at at time zone 'America/Argentina/Buenos_Aires') >= v_week_start
          and (s.starts_at at time zone 'America/Argentina/Buenos_Aires') < v_week_end
      )
      else null
    end as weekly_classes_used
  into v_membership_selection
  from public.memberships m
  join public.plans p on p.id = m.plan_id
  join public.plan_activities pa on pa.plan_id = m.plan_id
  where m.student_id = v_actor
    and m.status = 'active'
    and v_session.starts_at::date between m.start_date and m.end_date
    and pa.activity_id = v_session.activity_id
    and (
      p.plan_type = 'weekly'
      or m.remaining_credits is null
      or m.remaining_credits > 0
    )
    and (
      p.plan_type <> 'weekly'
      or (
        pa.weekly_class_limit is not null
        and (
          select count(*)::int
          from public.bookings b
          join public.class_sessions s on s.id = b.session_id
          where b.student_id = v_actor
            and b.membership_id = m.id
            and s.activity_id = v_session.activity_id
            and b.status in ('booked'::public.booking_status, 'attended'::public.booking_status, 'no_show'::public.booking_status)
            and (s.starts_at at time zone 'America/Argentina/Buenos_Aires') >= v_week_start
            and (s.starts_at at time zone 'America/Argentina/Buenos_Aires') < v_week_end
        ) < pa.weekly_class_limit
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
          pa.weekly_class_limit,
          (
            select count(*)::int
            from public.bookings b
            join public.class_sessions s on s.id = b.session_id
            where b.student_id = v_actor
              and b.membership_id = m.id
              and s.activity_id = v_session.activity_id
              and b.status in ('booked'::public.booking_status, 'attended'::public.booking_status, 'no_show'::public.booking_status)
              and (s.starts_at at time zone 'America/Argentina/Buenos_Aires') >= v_week_start
              and (s.starts_at at time zone 'America/Argentina/Buenos_Aires') < v_week_end
          ) as weekly_classes_used
        from public.memberships m
        join public.plans p on p.id = m.plan_id
        join public.plan_activities pa on pa.plan_id = m.plan_id
        where m.student_id = v_actor
          and m.status = 'active'
          and p.plan_type = 'weekly'
          and v_session.starts_at::date between m.start_date and m.end_date
          and pa.activity_id = v_session.activity_id
      ) exhausted
      where exhausted.weekly_class_limit is not null
        and exhausted.weekly_classes_used >= exhausted.weekly_class_limit
    )
    into v_weekly_exhausted;

    if v_weekly_exhausted then
      raise exception 'Ya alcanzaste el limite de clases de esta semana para este plan.';
    end if;

    raise exception 'No hay membresia activa que permita esta clase.';
  end if;

  select * into v_membership
  from public.memberships m
  where m.id = v_membership_selection.membership_id;

  select * into v_plan
  from public.plans p
  where p.id = v_membership_selection.plan_id;

  v_weekly_limit := v_membership_selection.weekly_class_limit;
  v_weekly_used := coalesce(v_membership_selection.weekly_classes_used, 0);

  if v_plan.plan_type = 'weekly' then
    if v_weekly_limit is null then
      raise exception 'El plan semanal no tiene limite de clases configurado.';
    end if;

    if v_weekly_used >= v_weekly_limit then
      raise exception 'Ya alcanzaste el limite de clases de esta semana para este plan.';
    end if;
  elsif v_membership.remaining_credits is not null then
    update public.memberships
    set
      remaining_credits = remaining_credits - 1,
      updated_at = now()
    where id = v_membership.id
    returning * into v_membership;
    v_classes_charged := 1;
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
      'weekly_limit', v_weekly_limit,
      'weekly_used_before_booking', v_weekly_used,
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

drop function if exists public.list_calendar_sessions(timestamptz, timestamptz);

create function public.list_calendar_sessions(
  from_date timestamptz,
  to_date timestamptz
)
returns table (
  session_id uuid,
  activity_id uuid,
  activity_name text,
  activity_slug text,
  requires_24h_cancel boolean,
  title text,
  starts_at timestamptz,
  ends_at timestamptz,
  capacity int,
  trainer_name text,
  notes text,
  active boolean,
  cancelled_at timestamptz,
  reserved_count int,
  spots_left int,
  own_booking_id uuid,
  own_booking_status public.booking_status,
  can_book boolean,
  block_reason text,
  plan_type text,
  weekly_class_limit int,
  weekly_classes_used int,
  weekly_classes_remaining int,
  package_classes_remaining int
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
      a.requires_24h_cancel,
      a.active as activity_active,
      (select count(*)::int from public.bookings b where b.session_id = s.id and b.status = 'booked') as active_bookings,
      (select b.id from public.bookings b where b.session_id = s.id and b.student_id = v_actor and b.status = 'booked' limit 1) as own_booking_id,
      (select b.status from public.bookings b where b.session_id = s.id and b.student_id = v_actor order by b.created_at desc limit 1) as own_booking_status,
      em.plan_type,
      em.weekly_class_limit,
      coalesce(em.weekly_classes_used, 0)::int as weekly_classes_used,
      case
        when em.plan_type = 'weekly' and em.weekly_class_limit is not null
          then greatest(em.weekly_class_limit - coalesce(em.weekly_classes_used, 0), 0)::int
        else null
      end as weekly_classes_remaining,
      case
        when em.plan_type = 'package' then em.remaining_credits
        else null
      end as package_classes_remaining,
      (
        em.membership_id is not null
        and (
          em.plan_type <> 'weekly'
          or coalesce(em.weekly_classes_used, 0) < coalesce(em.weekly_class_limit, 0)
        )
      ) as has_eligible_membership,
      coalesce(exhausted.weekly_limit_exhausted, false) as weekly_limit_exhausted
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
          pa.weekly_class_limit,
          case
            when p.plan_type = 'weekly' then (
              select count(*)::int
              from public.bookings b
              join public.class_sessions bs on bs.id = b.session_id
              where b.student_id = v_actor
                and b.membership_id = m.id
                and bs.activity_id = s.activity_id
                and b.status in ('booked'::public.booking_status, 'attended'::public.booking_status, 'no_show'::public.booking_status)
                and (bs.starts_at at time zone 'America/Argentina/Buenos_Aires') >= date_trunc('week', s.starts_at at time zone 'America/Argentina/Buenos_Aires')
                and (bs.starts_at at time zone 'America/Argentina/Buenos_Aires') < date_trunc('week', s.starts_at at time zone 'America/Argentina/Buenos_Aires') + interval '7 days'
            )
            else null
          end as weekly_classes_used
        from public.memberships m
        join public.plans p on p.id = m.plan_id
        join public.plan_activities pa on pa.plan_id = m.plan_id
        where m.student_id = v_actor
          and m.status = 'active'
          and s.starts_at::date between m.start_date and m.end_date
          and pa.activity_id = s.activity_id
          and (
            p.plan_type = 'weekly'
            or m.remaining_credits is null
            or m.remaining_credits > 0
          )
      ) candidate
      where candidate.plan_type <> 'weekly'
        or (
          candidate.weekly_class_limit is not null
          and coalesce(candidate.weekly_classes_used, 0) < candidate.weekly_class_limit
        )
      order by candidate.end_date asc, candidate.created_at asc
      limit 1
    ) em on v_is_admin is false
    left join lateral (
      select true as weekly_limit_exhausted
      from (
        select
          m.end_date,
          m.created_at,
          pa.weekly_class_limit,
          (
            select count(*)::int
            from public.bookings b
            join public.class_sessions bs on bs.id = b.session_id
            where b.student_id = v_actor
              and b.membership_id = m.id
              and bs.activity_id = s.activity_id
              and b.status in ('booked'::public.booking_status, 'attended'::public.booking_status, 'no_show'::public.booking_status)
              and (bs.starts_at at time zone 'America/Argentina/Buenos_Aires') >= date_trunc('week', s.starts_at at time zone 'America/Argentina/Buenos_Aires')
              and (bs.starts_at at time zone 'America/Argentina/Buenos_Aires') < date_trunc('week', s.starts_at at time zone 'America/Argentina/Buenos_Aires') + interval '7 days'
          ) as weekly_classes_used
        from public.memberships m
        join public.plans p on p.id = m.plan_id
        join public.plan_activities pa on pa.plan_id = m.plan_id
        where m.student_id = v_actor
          and m.status = 'active'
          and p.plan_type = 'weekly'
          and s.starts_at::date between m.start_date and m.end_date
          and pa.activity_id = s.activity_id
      ) candidate
      where candidate.weekly_class_limit is not null
        and candidate.weekly_classes_used >= candidate.weekly_class_limit
      order by candidate.end_date asc, candidate.created_at asc
      limit 1
    ) exhausted on v_is_admin is false
    where s.starts_at >= list_calendar_sessions.from_date
      and s.starts_at < list_calendar_sessions.to_date
      and (v_is_admin or (s.active = true and s.cancelled_at is null))
  )
  select
    sr.id,
    sr.activity_id,
    sr.activity_name,
    sr.activity_slug,
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
      when sr.plan_type = 'weekly' and coalesce(sr.weekly_classes_remaining, 0) <= 0 then 'Ya usaste las clases disponibles de esta semana para esta actividad'
      when sr.has_eligible_membership is not true and sr.weekly_limit_exhausted then 'Ya usaste las clases disponibles de esta semana para esta actividad'
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

revoke all on function public.assign_membership(uuid, uuid, date, date, int) from public, anon;
revoke all on function public.book_class_session(uuid) from public, anon;
revoke all on function public.list_calendar_sessions(timestamptz, timestamptz) from public, anon;
revoke all on function public.get_my_profile_summary() from public, anon;

grant execute on function public.assign_membership(uuid, uuid, date, date, int) to authenticated;
grant execute on function public.book_class_session(uuid) to authenticated;
grant execute on function public.list_calendar_sessions(timestamptz, timestamptz) to authenticated;
grant execute on function public.get_my_profile_summary() to authenticated;
