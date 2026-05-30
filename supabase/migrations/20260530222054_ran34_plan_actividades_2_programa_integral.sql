-- RAN-34 follow-up integral:
-- Plan de Actividades 2 becomes the single operational program source.
--
-- This migration does not touch students, real payments, files, Drive,
-- Mailjet, auth, login/logo, WhatsApp, secrets, or audit logs.
-- It hard-deletes only operational program data in a child-before-parent order.

drop function if exists public.list_calendar_sessions(timestamptz, timestamptz);

create function public.list_calendar_sessions(
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

create or replace function public.admin_delete_activity(p_activity_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_actor uuid;
  v_activity public.activities%rowtype;
  v_plan_links integer;
  v_recurring_rules integer;
  v_rule_exceptions integer;
  v_session_exceptions integer;
  v_sessions integer;
  v_bookings integer;
  v_attendance integer;
  v_rule_ids uuid[];
  v_session_ids uuid[];
begin
  v_actor := private.ensure_admin();

  select * into v_activity
  from public.activities a
  where a.id = p_activity_id
  for update;

  if not found then
    raise exception 'No se encontro la actividad.';
  end if;

  select count(*) into v_plan_links
  from public.plan_activities pa
  where pa.activity_id = p_activity_id;

  select coalesce(array_agg(r.id), array[]::uuid[]) into v_rule_ids
  from public.class_recurring_rules r
  where r.activity_id = p_activity_id;

  v_recurring_rules := cardinality(v_rule_ids);

  select coalesce(array_agg(s.id), array[]::uuid[]) into v_session_ids
  from public.class_sessions s
  where s.activity_id = p_activity_id
     or s.recurring_rule_id = any(v_rule_ids);

  v_sessions := cardinality(v_session_ids);

  select count(*) into v_rule_exceptions
  from public.class_recurring_rule_exceptions e
  where e.recurring_rule_id = any(v_rule_ids);

  select count(*) into v_session_exceptions
  from public.class_recurring_rule_exceptions e
  where e.class_session_id = any(v_session_ids);

  select count(*) into v_bookings
  from public.bookings b
  where b.session_id = any(v_session_ids);

  select count(*) into v_attendance
  from public.attendance att
  where att.session_id = any(v_session_ids);

  insert into public.audit_logs (actor_id, entity_type, entity_id, action, metadata)
  values (
    v_actor,
    'activity',
    p_activity_id,
    'activity.deleted_with_operational_cleanup',
    jsonb_build_object(
      'name', v_activity.name,
      'slug', v_activity.slug,
      'plan_links', v_plan_links,
      'recurring_rules', v_recurring_rules,
      'rule_exceptions', v_rule_exceptions,
      'session_exceptions', v_session_exceptions,
      'sessions', v_sessions,
      'bookings', v_bookings,
      'attendance', v_attendance
    )
  );

  delete from public.class_recurring_rule_exceptions e
  where e.recurring_rule_id = any(v_rule_ids)
     or e.class_session_id = any(v_session_ids);

  delete from public.attendance att
  where att.session_id = any(v_session_ids);

  delete from public.bookings b
  where b.session_id = any(v_session_ids);

  delete from public.class_sessions s
  where s.id = any(v_session_ids);

  delete from public.class_recurring_rules r
  where r.id = any(v_rule_ids);

  delete from public.plan_activities pa
  where pa.activity_id = p_activity_id;

  delete from public.activities a
  where a.id = p_activity_id;

  return jsonb_build_object(
    'action', 'deleted',
    'activity_id', p_activity_id,
    'deleted_plan_links', v_plan_links,
    'deleted_recurring_rules', v_recurring_rules,
    'deleted_rule_exceptions', v_rule_exceptions,
    'deleted_session_exceptions', v_session_exceptions,
    'deleted_sessions', v_sessions,
    'deleted_bookings', v_bookings,
    'deleted_attendance', v_attendance
  );
end;
$$;

do $$
declare
  v_future_from timestamptz := timestamptz '2026-05-30 00:00:00-03';
  v_future_to timestamptz := timestamptz '2026-08-31 00:00:00-03';
  v_cognitivo_price numeric;
begin
  create temporary table ran34_out_of_program_plan_slugs (slug text primary key) on commit drop;
  insert into ran34_out_of_program_plan_slugs (slug)
  values
    ('programa_kids_3_veces_por_semana'),
    ('combo_semipersonalizado_y_funcional');

  create temporary table ran34_final_activities (
    slug text primary key,
    name text not null,
    description text,
    requires_24h_cancel boolean not null,
    flexible_schedule boolean not null,
    active boolean not null,
    color_hex text,
    default_capacity integer,
    max_capacity integer
  ) on commit drop;

  insert into ran34_final_activities (
    slug, name, description, requires_24h_cancel, flexible_schedule,
    active, color_hex, default_capacity, max_capacity
  )
  values
    (
      'semi_personalizado',
      'Semipersonalizado',
      'Clase grupal semipersonalizada del programa actual.',
      false,
      false,
      true,
      '#76BB40',
      10,
      null
    ),
    (
      'neurofuncional',
      'Neurofuncional',
      'Clase neurofuncional del programa actual.',
      false,
      false,
      true,
      '#FACC15',
      10,
      null
    ),
    (
      'cognitivo',
      'Cognitivo',
      'Clase cognitiva del programa actual.',
      false,
      false,
      true,
      '#F97316',
      5,
      null
    ),
    (
      'personalizado_1_1',
      'Personalizado 1:1',
      'Clase personalizada individual.',
      true,
      false,
      true,
      '#D946EF',
      1,
      1
    );

  update public.activities a
  set
    name = f.name,
    description = f.description,
    requires_24h_cancel = f.requires_24h_cancel,
    flexible_schedule = f.flexible_schedule,
    active = f.active,
    color_hex = f.color_hex,
    default_capacity = f.default_capacity,
    max_capacity = f.max_capacity,
    updated_at = now()
  from ran34_final_activities f
  where a.slug = f.slug;

  if exists (
    select 1
    from ran34_final_activities f
    left join public.activities a on a.slug = f.slug
    where a.id is null
  ) then
    raise exception 'Faltan actividades finales requeridas para Plan de Actividades 2.';
  end if;

  -- Keep plans and memberships. Only unlink out-of-program plans from
  -- activities that are no longer part of the current class type catalog.
  delete from public.plan_activities pa
  using public.plans p, ran34_out_of_program_plan_slugs d
  where pa.plan_id = p.id
    and p.slug = d.slug;

  update public.plans p
  set
    visible_to_students = false,
    updated_at = now()
  from ran34_out_of_program_plan_slugs d
  where p.slug = d.slug;

  -- Clean operational data for activities no longer in the program or duplicate Personalizado.
  create temporary table ran34_delete_activity_ids as
  select a.id
  from public.activities a
  where a.slug in ('ninos', 'funcional', 'personalizado');

  create temporary table ran34_delete_rule_ids as
  select r.id
  from public.class_recurring_rules r
  where r.activity_id in (select id from ran34_delete_activity_ids)
     or r.active = false;

  create temporary table ran34_delete_session_ids as
  select s.id
  from public.class_sessions s
  where s.activity_id in (select id from ran34_delete_activity_ids)
     or s.recurring_rule_id in (select id from ran34_delete_rule_ids);

  delete from public.class_recurring_rule_exceptions e
  where e.recurring_rule_id in (select id from ran34_delete_rule_ids)
     or e.class_session_id in (select id from ran34_delete_session_ids);

  delete from public.attendance att
  where att.session_id in (select id from ran34_delete_session_ids);

  delete from public.bookings b
  where b.session_id in (select id from ran34_delete_session_ids);

  delete from public.class_sessions s
  where s.id in (select id from ran34_delete_session_ids);

  delete from public.class_recurring_rules r
  where r.id in (select id from ran34_delete_rule_ids);

  delete from public.plan_activities pa
  where pa.activity_id in (select id from ran34_delete_activity_ids);

  delete from public.activities a
  where a.id in (select id from ran34_delete_activity_ids);

  -- Final visible plan catalog. Prices are kept from the existing records.
  update public.plans p
  set
    active = true,
    visible_to_students = p.slug in (
      'semipersonalizado_3_veces_por_semana',
      'semipersonalizado_5_veces_por_semana',
      'neurofuncional_3_veces_por_semana',
      'personalizado_1_clase',
      'personalizado_4_clases',
      'personalizado_8_clases',
      'personalizado_12_clases',
      'con_plan_de_entrenamiento_3_veces_por_semana',
      'con_plan_de_entrenamiento_5_veces_por_semana',
      'cognitivo_solo_viernes_14'
    ),
    updated_at = now()
  where p.slug in (
    'semipersonalizado_3_veces_por_semana',
    'semipersonalizado_5_veces_por_semana',
    'neurofuncional_3_veces_por_semana',
    'personalizado_1_clase',
    'personalizado_4_clases',
    'personalizado_8_clases',
    'personalizado_12_clases',
    'con_plan_de_entrenamiento_3_veces_por_semana',
    'con_plan_de_entrenamiento_5_veces_por_semana',
    'cognitivo_solo_viernes_14'
  );

  update public.plans
  set
    name = 'Plan Autonomo / Semipersonalizado 3 veces por semana',
    visible_to_students = true,
    updated_at = now()
  where slug = 'con_plan_de_entrenamiento_3_veces_por_semana';

  update public.plans
  set
    name = 'Plan Autonomo / Semipersonalizado 5 veces por semana',
    visible_to_students = true,
    updated_at = now()
  where slug = 'con_plan_de_entrenamiento_5_veces_por_semana';

  select coalesce(
    (select price from public.plans where slug = 'neurofuncional_3_veces_por_semana'),
    45000::numeric
  ) into v_cognitivo_price;

  insert into public.plans (
    name,
    slug,
    description,
    price,
    billing_period_days,
    active,
    plan_type,
    package_class_count,
    visible_to_students,
    max_active_memberships
  )
  values (
    'Cognitivo (solo viernes 14 hs)',
    'cognitivo_solo_viernes_14',
    'Plan vigente para la clase Cognitivo de viernes 14 hs.',
    v_cognitivo_price,
    30,
    true,
    'weekly',
    null,
    true,
    null
  )
  on conflict (slug) do update
  set
    name = excluded.name,
    description = excluded.description,
    price = excluded.price,
    billing_period_days = excluded.billing_period_days,
    active = true,
    plan_type = excluded.plan_type,
    package_class_count = null,
    visible_to_students = true,
    max_active_memberships = null,
    updated_at = now();

  -- Rebuild plan/activity links for final plans. Plans with payments are preserved,
  -- but their operational links are updated to the final activity model.
  delete from public.plan_activities pa
  using public.plans p
  where pa.plan_id = p.id
    and p.slug in (
      'semipersonalizado_3_veces_por_semana',
      'semipersonalizado_5_veces_por_semana',
      'neurofuncional_3_veces_por_semana',
      'personalizado_1_clase',
      'personalizado_4_clases',
      'personalizado_8_clases',
      'personalizado_12_clases',
      'con_plan_de_entrenamiento_3_veces_por_semana',
      'con_plan_de_entrenamiento_5_veces_por_semana',
      'cognitivo_solo_viernes_14'
    );

  insert into public.plan_activities (plan_id, activity_id, monthly_credits, weekly_class_limit)
  select p.id, a.id, null::int, source.weekly_limit
  from (
    values
      ('semipersonalizado_3_veces_por_semana', 'semi_personalizado', 3),
      ('semipersonalizado_5_veces_por_semana', 'semi_personalizado', 5),
      ('neurofuncional_3_veces_por_semana', 'neurofuncional', 3),
      ('con_plan_de_entrenamiento_3_veces_por_semana', 'semi_personalizado', 3),
      ('con_plan_de_entrenamiento_5_veces_por_semana', 'semi_personalizado', 5),
      ('cognitivo_solo_viernes_14', 'cognitivo', 1)
  ) as source(plan_slug, activity_slug, weekly_limit)
  join public.plans p on p.slug = source.plan_slug
  join public.activities a on a.slug = source.activity_slug
  on conflict (plan_id, activity_id) do update
  set
    monthly_credits = excluded.monthly_credits,
    weekly_class_limit = excluded.weekly_class_limit;

  insert into public.plan_activities (plan_id, activity_id, monthly_credits, weekly_class_limit)
  select p.id, a.id, source.monthly_credits, null::int
  from (
    values
      ('personalizado_1_clase', 'personalizado_1_1', 1),
      ('personalizado_4_clases', 'personalizado_1_1', 4),
      ('personalizado_8_clases', 'personalizado_1_1', 8),
      ('personalizado_12_clases', 'personalizado_1_1', 12)
  ) as source(plan_slug, activity_slug, monthly_credits)
  join public.plans p on p.slug = source.plan_slug
  join public.activities a on a.slug = source.activity_slug
  on conflict (plan_id, activity_id) do update
  set
    monthly_credits = excluded.monthly_credits,
    weekly_class_limit = excluded.weekly_class_limit;

  create temporary table ran34_desired_rules (
    weekday int not null,
    start_time time not null,
    end_time time not null,
    slug text not null,
    capacity int not null
  ) on commit drop;

  insert into ran34_desired_rules (weekday, start_time, end_time, slug, capacity)
  values
    -- Lunes/Miercoles/Viernes
    (1, time '07:00', time '08:00', 'semi_personalizado', 10),
    (3, time '07:00', time '08:00', 'semi_personalizado', 10),
    (5, time '07:00', time '08:00', 'semi_personalizado', 10),
    (1, time '08:00', time '09:00', 'neurofuncional', 10),
    (3, time '08:00', time '09:00', 'neurofuncional', 10),
    (5, time '08:00', time '09:00', 'neurofuncional', 10),
    (1, time '09:00', time '10:00', 'semi_personalizado', 10),
    (3, time '09:00', time '10:00', 'semi_personalizado', 10),
    (5, time '09:00', time '10:00', 'semi_personalizado', 10),
    (1, time '10:00', time '11:00', 'personalizado_1_1', 1),
    (3, time '10:00', time '11:00', 'personalizado_1_1', 1),
    (5, time '10:00', time '11:00', 'personalizado_1_1', 1),
    (1, time '14:00', time '15:00', 'semi_personalizado', 5),
    (3, time '14:00', time '15:00', 'semi_personalizado', 5),
    (5, time '14:00', time '15:00', 'cognitivo', 5),
    (1, time '15:00', time '16:00', 'semi_personalizado', 10),
    (3, time '15:00', time '16:00', 'semi_personalizado', 10),
    (5, time '15:00', time '16:00', 'semi_personalizado', 10),
    (1, time '16:00', time '17:00', 'semi_personalizado', 10),
    (3, time '16:00', time '17:00', 'semi_personalizado', 10),
    (5, time '16:00', time '17:00', 'semi_personalizado', 10),
    (1, time '17:00', time '18:00', 'semi_personalizado', 10),
    (3, time '17:00', time '18:00', 'semi_personalizado', 10),
    (5, time '17:00', time '18:00', 'semi_personalizado', 10),
    (1, time '18:00', time '19:00', 'neurofuncional', 10),
    (3, time '18:00', time '19:00', 'neurofuncional', 10),
    (5, time '18:00', time '19:00', 'neurofuncional', 10),
    (1, time '19:00', time '20:00', 'semi_personalizado', 10),
    (3, time '19:00', time '20:00', 'semi_personalizado', 10),
    (5, time '19:00', time '20:00', 'semi_personalizado', 10),
    -- Martes/Jueves
    (2, time '07:00', time '08:00', 'personalizado_1_1', 1),
    (4, time '07:00', time '08:00', 'personalizado_1_1', 1),
    (2, time '08:00', time '09:00', 'semi_personalizado', 10),
    (4, time '08:00', time '09:00', 'semi_personalizado', 10),
    (2, time '09:00', time '10:00', 'semi_personalizado', 10),
    (4, time '09:00', time '10:00', 'semi_personalizado', 10),
    (2, time '10:00', time '11:00', 'personalizado_1_1', 1),
    (4, time '10:00', time '11:00', 'personalizado_1_1', 1),
    (2, time '14:00', time '15:00', 'semi_personalizado', 5),
    (4, time '14:00', time '15:00', 'semi_personalizado', 5),
    (2, time '15:00', time '16:00', 'semi_personalizado', 10),
    (4, time '15:00', time '16:00', 'semi_personalizado', 10),
    (2, time '16:00', time '17:00', 'semi_personalizado', 10),
    (4, time '16:00', time '17:00', 'semi_personalizado', 10),
    (2, time '17:00', time '18:00', 'personalizado_1_1', 1),
    (4, time '17:00', time '18:00', 'personalizado_1_1', 1),
    (2, time '18:00', time '19:00', 'semi_personalizado', 10),
    (4, time '18:00', time '19:00', 'semi_personalizado', 10),
    (2, time '19:00', time '20:00', 'semi_personalizado', 10),
    (4, time '19:00', time '20:00', 'semi_personalizado', 10);

  create temporary table ran34_desired_rule_ids as
  select
    r.id
  from public.class_recurring_rules r
  join public.activities a on a.id = r.activity_id
  join ran34_desired_rules d
    on d.slug = a.slug
   and d.weekday = r.weekday
   and d.start_time = r.start_time
   and d.end_time = r.end_time
  where r.active = true;

  create temporary table ran34_wrong_rule_ids as
  select r.id
  from public.class_recurring_rules r
  left join ran34_desired_rule_ids keep on keep.id = r.id
  where keep.id is null;

  create temporary table ran34_wrong_session_ids as
  select s.id
  from public.class_sessions s
  where s.recurring_rule_id in (select id from ran34_wrong_rule_ids);

  delete from public.class_recurring_rule_exceptions e
  where e.recurring_rule_id in (select id from ran34_wrong_rule_ids)
     or e.class_session_id in (select id from ran34_wrong_session_ids);

  delete from public.attendance att
  where att.session_id in (select id from ran34_wrong_session_ids);

  delete from public.bookings b
  where b.session_id in (select id from ran34_wrong_session_ids);

  delete from public.class_sessions s
  where s.id in (select id from ran34_wrong_session_ids);

  delete from public.class_recurring_rules r
  where r.id in (select id from ran34_wrong_rule_ids);

  update public.class_recurring_rules r
  set
    title = a.name,
    capacity = d.capacity,
    active = true,
    valid_until = null,
    notes = null,
    updated_at = now()
  from ran34_desired_rules d
  join public.activities a on a.slug = d.slug
  where r.activity_id = a.id
    and r.weekday = d.weekday
    and r.start_time = d.start_time
    and r.end_time = d.end_time;

  insert into public.class_recurring_rules (
    activity_id,
    title,
    weekday,
    start_time,
    end_time,
    capacity,
    trainer_name,
    notes,
    active,
    valid_from,
    valid_until,
    created_by
  )
  select
    a.id,
    a.name,
    d.weekday,
    d.start_time,
    d.end_time,
    d.capacity,
    null,
    null,
    true,
    date '2026-05-30',
    null,
    null
  from ran34_desired_rules d
  join public.activities a on a.slug = d.slug
  where not exists (
    select 1
    from public.class_recurring_rules r
    where r.activity_id = a.id
      and r.weekday = d.weekday
      and r.start_time = d.start_time
      and r.end_time = d.end_time
  );

  -- Ensure materialized sessions align with final rules for the current demo window.
  update public.class_sessions s
  set
    activity_id = r.activity_id,
    title = r.title,
    capacity = r.capacity,
    trainer_name = r.trainer_name,
    notes = r.notes,
    active = true,
    cancelled_at = null,
    cancelled_by = null,
    cancel_reason = null,
    updated_at = now()
  from public.class_recurring_rules r
  join public.activities a on a.id = r.activity_id
  join ran34_desired_rules d
    on d.slug = a.slug
   and d.weekday = r.weekday
   and d.start_time = r.start_time
   and d.end_time = r.end_time
  where s.recurring_rule_id = r.id
    and s.starts_at >= v_future_from;

  perform private.materialize_recurring_class_sessions(v_future_from, v_future_to);
end;
$$;

revoke all on function public.list_calendar_sessions(timestamptz, timestamptz) from public, anon;
grant execute on function public.list_calendar_sessions(timestamptz, timestamptz) to authenticated;

revoke all on function public.admin_delete_activity(uuid) from public, anon;
grant execute on function public.admin_delete_activity(uuid) to authenticated;
