create or replace function private.materialize_recurring_class_sessions(
  p_from_date timestamptz,
  p_to_date timestamptz
)
returns integer
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_inserted integer := 0;
begin
  if p_from_date is null or p_to_date is null or p_to_date <= p_from_date then
    raise exception 'El rango de calendario no es valido.';
  end if;

  if p_to_date - p_from_date > interval '90 days' then
    raise exception 'El rango de calendario no puede superar 90 dias.';
  end if;

  with calendar_days as (
    select generate_series(
      (p_from_date at time zone 'America/Argentina/Buenos_Aires')::date,
      ((p_to_date - interval '1 millisecond') at time zone 'America/Argentina/Buenos_Aires')::date,
      interval '1 day'
    )::date as class_date
  ),
  rule_occurrences as (
    select
      r.id as rule_id,
      r.activity_id,
      r.title,
      ((d.class_date + r.start_time) at time zone 'America/Argentina/Buenos_Aires') as starts_at,
      ((d.class_date + r.end_time) at time zone 'America/Argentina/Buenos_Aires') as ends_at,
      r.capacity,
      r.trainer_name,
      r.notes
    from calendar_days d
    join public.class_recurring_rules r
      on r.active = true
     and r.valid_from <= d.class_date
     and (r.valid_until is null or r.valid_until >= d.class_date)
     and r.weekday = extract(dow from d.class_date)::int
    join public.activities a on a.id = r.activity_id and a.active = true
  ),
  inserted as (
    insert into public.class_sessions (
      activity_id,
      title,
      starts_at,
      ends_at,
      capacity,
      trainer_name,
      notes,
      active,
      recurring_rule_id
    )
    select
      ro.activity_id,
      ro.title,
      ro.starts_at,
      ro.ends_at,
      ro.capacity,
      ro.trainer_name,
      ro.notes,
      true,
      ro.rule_id
    from rule_occurrences ro
    where ro.starts_at >= p_from_date
      and ro.starts_at < p_to_date
      and not exists (
        select 1
        from public.class_recurring_rule_exceptions cre
        where cre.recurring_rule_id = ro.rule_id
          and cre.occurrence_starts_at = ro.starts_at
          and cre.occurrence_ends_at = ro.ends_at
      )
      and not exists (
        select 1
        from public.class_sessions existing
        where coalesce(existing.active, false) = true
          and existing.cancelled_at is null
          and (
            (
              existing.recurring_rule_id = ro.rule_id
              and existing.starts_at = ro.starts_at
              and existing.ends_at = ro.ends_at
            )
            or (
              existing.activity_id = ro.activity_id
              and existing.starts_at = ro.starts_at
              and existing.ends_at = ro.ends_at
            )
          )
      )
    returning id
  )
  select count(*) into v_inserted from inserted;

  return v_inserted;
end;
$$;

revoke all on function private.materialize_recurring_class_sessions(
  timestamptz,
  timestamptz
) from public, anon, authenticated;

create or replace function public.admin_create_class_recurring_rule(
  p_activity_id uuid,
  p_title text,
  p_weekday int,
  p_start_time time,
  p_end_time time,
  p_capacity int,
  p_trainer_name text default null,
  p_notes text default null,
  p_valid_from date default null,
  p_valid_until date default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_actor uuid := auth.uid();
  v_activity public.activities%rowtype;
  v_rule public.class_recurring_rules%rowtype;
  v_existing_rule public.class_recurring_rules%rowtype;
  v_exception public.class_recurring_rule_exceptions%rowtype;
  v_valid_from date := coalesce(p_valid_from, current_date);
  v_valid_until date := p_valid_until;
  v_occurrence_starts_at timestamptz;
  v_occurrence_ends_at timestamptz;
  v_restored_session_id uuid;
  v_has_existing_rule boolean := false;
  v_materialize_from timestamptz;
  v_materialize_to timestamptz;
  v_created_sessions integer := 0;
begin
  if v_actor is null or not private.is_admin() then
    raise exception 'Solo un admin activo puede crear horarios recurrentes.';
  end if;

  select * into v_activity
  from public.activities a
  where a.id = p_activity_id
    and a.active = true;

  if not found then
    raise exception 'El tipo de clase no esta activo.';
  end if;

  if nullif(btrim(coalesce(p_title, '')), '') is null then
    raise exception 'El titulo es obligatorio.';
  end if;

  if p_weekday is null or p_weekday < 0 or p_weekday > 6 then
    raise exception 'El dia de semana no es valido.';
  end if;

  if p_end_time <= p_start_time then
    raise exception 'La hora de fin debe ser posterior a la hora de inicio.';
  end if;

  if v_valid_until is not null and v_valid_until < v_valid_from then
    raise exception 'La fecha final debe ser posterior o igual a la fecha inicial.';
  end if;

  if p_capacity is null or p_capacity <= 0 then
    raise exception 'El cupo debe ser mayor a cero.';
  end if;

  if v_activity.slug = 'personalizado_1_1' and p_capacity > 1 then
    raise exception 'Personalizado 1:1 permite maximo 1 alumno.';
  end if;

  v_occurrence_starts_at :=
    ((v_valid_from + p_start_time) at time zone 'America/Argentina/Buenos_Aires');
  v_occurrence_ends_at :=
    ((v_valid_from + p_end_time) at time zone 'America/Argentina/Buenos_Aires');

  select * into v_existing_rule
  from public.class_recurring_rules r
  where r.active = true
    and r.activity_id = p_activity_id
    and r.weekday = p_weekday
    and r.start_time = p_start_time
    and r.end_time = p_end_time
    and r.valid_from <= coalesce(v_valid_until, date '9999-12-31')
    and v_valid_from <= coalesce(r.valid_until, date '9999-12-31')
  order by (
      r.valid_from = v_valid_from
      and coalesce(r.valid_until, date '9999-12-31') =
        coalesce(v_valid_until, date '9999-12-31')
    ) desc,
    r.valid_from desc,
    r.created_at desc
  limit 1;

  v_has_existing_rule := found;

  if v_has_existing_rule then
    select * into v_exception
    from public.class_recurring_rule_exceptions cre
    where cre.recurring_rule_id = v_existing_rule.id
      and cre.occurrence_starts_at = v_occurrence_starts_at
      and cre.occurrence_ends_at = v_occurrence_ends_at
      and cre.action = 'cancelled'
    for update;

    if found then
      update public.class_sessions s
      set
        activity_id = v_existing_rule.activity_id,
        title = v_existing_rule.title,
        starts_at = v_occurrence_starts_at,
        ends_at = v_occurrence_ends_at,
        capacity = v_existing_rule.capacity,
        trainer_name = v_existing_rule.trainer_name,
        notes = v_existing_rule.notes,
        active = true,
        cancelled_at = null,
        cancelled_by = null,
        cancel_reason = null,
        recurring_rule_id = v_existing_rule.id,
        updated_at = now()
      where s.id = (
        select candidate.id
        from public.class_sessions candidate
        where candidate.recurring_rule_id = v_existing_rule.id
          and candidate.starts_at = v_occurrence_starts_at
          and candidate.ends_at = v_occurrence_ends_at
        order by
          (candidate.active is true and candidate.cancelled_at is null) desc,
          candidate.updated_at desc,
          candidate.created_at desc
        limit 1
      )
      returning s.id into v_restored_session_id;

      if v_restored_session_id is null then
        insert into public.class_sessions (
          activity_id,
          title,
          starts_at,
          ends_at,
          capacity,
          trainer_name,
          notes,
          active,
          recurring_rule_id
        )
        values (
          v_existing_rule.activity_id,
          v_existing_rule.title,
          v_occurrence_starts_at,
          v_occurrence_ends_at,
          v_existing_rule.capacity,
          v_existing_rule.trainer_name,
          v_existing_rule.notes,
          true,
          v_existing_rule.id
        )
        returning id into v_restored_session_id;
      end if;

      if v_restored_session_id is null then
        raise exception 'No se pudo restaurar la clase cancelada.';
      end if;

      update public.class_recurring_rule_exceptions cre
      set action = 'edited',
          class_session_id = v_restored_session_id,
          created_by = v_actor
      where cre.id = v_exception.id;

      insert into public.audit_logs (actor_id, entity_type, entity_id, action, metadata)
      values (
        v_actor,
        'class_session',
        v_restored_session_id,
        'class.restored_cancelled_occurrence',
        jsonb_build_object(
          'rule_id', v_existing_rule.id,
          'activity_id', v_existing_rule.activity_id,
          'starts_at', v_occurrence_starts_at,
          'ends_at', v_occurrence_ends_at,
          'restored_exception_id', v_exception.id
        )
      );

      return jsonb_build_object(
        'ok', true,
        'action', 'restored_occurrence',
        'message', 'Clase restaurada correctamente.',
        'rule_id', v_existing_rule.id,
        'session_id', v_restored_session_id,
        'affected_sessions', 1
      );
    end if;

    raise exception 'Ya existe un horario recurrente activo para ese tipo, dia y horario. Pausa el anterior antes de crear otro.';
  end if;

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
  values (
    p_activity_id,
    btrim(p_title),
    p_weekday,
    p_start_time,
    p_end_time,
    p_capacity,
    nullif(btrim(coalesce(p_trainer_name, '')), ''),
    nullif(btrim(coalesce(p_notes, '')), ''),
    true,
    v_valid_from,
    v_valid_until,
    v_actor
  )
  on conflict (
    activity_id,
    weekday,
    start_time,
    end_time,
    valid_from,
    (coalesce(valid_until, date '9999-12-31'))
  )
  where active = true
  do nothing
  returning * into v_rule;

  if v_rule.id is null then
    raise exception 'Ya existe un horario recurrente activo para ese tipo, dia y horario. Pausa el anterior antes de crear otro.';
  end if;

  insert into public.audit_logs (actor_id, entity_type, entity_id, action, metadata)
  values (
    v_actor,
    'class_recurring_rule',
    v_rule.id,
    'class_recurring_rule.upserted',
    jsonb_build_object(
      'activity_id', v_rule.activity_id,
      'weekday', v_rule.weekday,
      'start_time', v_rule.start_time,
      'end_time', v_rule.end_time,
      'valid_from', v_rule.valid_from,
      'valid_until', v_rule.valid_until
    )
  );

  v_materialize_from :=
    (v_valid_from::timestamp at time zone 'America/Argentina/Buenos_Aires');
  v_materialize_to :=
    ((v_valid_from + 60)::timestamp at time zone 'America/Argentina/Buenos_Aires');

  v_created_sessions := private.materialize_recurring_class_sessions(
    v_materialize_from,
    v_materialize_to
  );

  return jsonb_build_object(
    'ok', true,
    'action', 'created',
    'message', 'Horario recurrente creado. Se materializaron las proximas semanas visibles del calendario.',
    'rule_id', v_rule.id,
    'affected_sessions', v_created_sessions,
    'created_sessions', v_created_sessions
  );
end;
$$;

revoke all on function public.admin_create_class_recurring_rule(
  uuid,
  text,
  int,
  time,
  time,
  int,
  text,
  text,
  date,
  date
) from public, anon;

grant execute on function public.admin_create_class_recurring_rule(
  uuid,
  text,
  int,
  time,
  time,
  int,
  text,
  text,
  date,
  date
) to authenticated;

drop function if exists public.list_calendar_sessions(timestamptz, timestamptz);

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
  v_is_admin boolean := false;
begin
  if v_actor is null then
    raise exception 'Se requiere sesion activa.';
  end if;

  if from_date is null or to_date is null or to_date <= from_date then
    raise exception 'El rango de fechas no es valido.';
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
      (select b.id from public.bookings b where b.session_id = s.id and b.student_id = v_actor and b.status = 'booked' limit 1) as own_booking_id,
      (select b.status from public.bookings b where b.session_id = s.id and b.student_id = v_actor order by b.created_at desc limit 1) as own_booking_status,
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
        and (
          (em.plan_type = 'package' and coalesce(em.remaining_credits, 0) > 0)
          or (
            em.plan_type <> 'package'
            and em.weekly_class_limit is not null
            and coalesce(em.weekly_classes_used, 0) < em.weekly_class_limit
          )
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
          coalesce(pa.weekly_class_limit, pa.monthly_credits, p.package_class_count) as weekly_class_limit,
          case
            when p.plan_type <> 'package' then private.weekly_activity_usage(
              v_actor,
              m.id,
              s.activity_id,
              s.starts_at
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
    ) em on v_is_admin is false
    left join lateral (
      select true as weekly_limit_exhausted
      from public.memberships m
      join public.plans p on p.id = m.plan_id
      join public.plan_activities pa on pa.plan_id = m.plan_id
      where m.student_id = v_actor
        and m.status = 'active'
        and p.plan_type <> 'package'
        and s.starts_at::date between m.start_date and m.end_date
        and pa.activity_id = s.activity_id
        and coalesce(pa.weekly_class_limit, pa.monthly_credits, p.package_class_count) is not null
        and private.weekly_activity_usage(
          v_actor,
          m.id,
          s.activity_id,
          s.starts_at
        ) >= coalesce(pa.weekly_class_limit, pa.monthly_credits, p.package_class_count)
      order by m.end_date asc, m.created_at asc
      limit 1
    ) exhausted on v_is_admin is false
    where s.starts_at >= list_calendar_sessions.from_date
      and s.starts_at < list_calendar_sessions.to_date
      and s.active = true
      and s.cancelled_at is null
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
      when v_is_admin then false
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
      when sr.starts_at <= now() then 'La clase ya comenzo'
      when sr.activity_active is not true then 'Actividad inactiva'
      when sr.own_booking_id is not null then 'Ya tenes una reserva activa'
      when now() > sr.reservation_cutoff then sr.reservation_block_reason
      when sr.active_bookings >= sr.capacity then 'Sin cupos disponibles'
      when sr.plan_type <> 'package' and coalesce(sr.weekly_classes_remaining, 0) <= 0 then 'Ya usaste las clases disponibles de esta semana para esta actividad'
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

revoke all on function public.list_calendar_sessions(
  timestamptz,
  timestamptz
) from public, anon;

grant execute on function public.list_calendar_sessions(
  timestamptz,
  timestamptz
) to authenticated;
