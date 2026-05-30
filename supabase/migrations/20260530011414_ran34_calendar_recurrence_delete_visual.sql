-- RAN-34: scoped recurring deletion, restore-safe recurrence, and approved
-- calendar cleanup. This preserves bookings/attendance history and only removes
-- generated future sessions when they have no history.

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
    sr.recurring_rule_id,
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

create or replace function public.cancel_class_session(
  session_id uuid,
  reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_session public.class_sessions%rowtype;
  v_actor uuid := auth.uid();
  v_cancelled_count integer := 0;
  v_cancelled_at timestamptz := now();
  v_reason text := nullif(btrim(coalesce(cancel_class_session.reason, '')), '');
begin
  if v_actor is null or not private.is_admin() then
    raise exception 'Solo un admin activo puede cancelar clases.';
  end if;

  select * into v_session
  from public.class_sessions s
  where s.id = cancel_class_session.session_id
  for update;

  if not found then
    raise exception 'La clase no existe.';
  end if;

  if v_session.cancelled_at is not null then
    raise exception 'La clase ya esta cancelada.';
  end if;

  update public.memberships m
  set
    remaining_credits = m.remaining_credits + b.credits_charged,
    updated_at = now()
  from public.bookings b
  where b.session_id = cancel_class_session.session_id
    and b.status = 'booked'
    and b.credits_charged > 0
    and b.credit_returned_at is null
    and b.membership_id = m.id
    and m.remaining_credits is not null;

  update public.bookings b
  set
    status = 'cancelled',
    cancelled_at = v_cancelled_at,
    cancelled_by = v_actor,
    cancel_reason = v_reason,
    credit_returned_at = case
      when b.credits_charged > 0 and b.credit_returned_at is null then v_cancelled_at
      else b.credit_returned_at
    end,
    updated_at = now()
  where b.session_id = cancel_class_session.session_id
    and b.status = 'booked';

  get diagnostics v_cancelled_count = row_count;

  update public.class_sessions s
  set
    active = false,
    cancelled_at = v_cancelled_at,
    cancelled_by = v_actor,
    cancel_reason = v_reason,
    updated_at = now()
  where s.id = cancel_class_session.session_id
  returning * into v_session;

  if v_session.recurring_rule_id is not null then
    insert into public.class_recurring_rule_exceptions (
      recurring_rule_id,
      occurrence_starts_at,
      occurrence_ends_at,
      action,
      class_session_id,
      created_by
    )
    values (
      v_session.recurring_rule_id,
      v_session.starts_at,
      v_session.ends_at,
      'cancelled',
      null,
      v_actor
    )
    on conflict (
      recurring_rule_id,
      occurrence_starts_at,
      occurrence_ends_at
    )
    do update set
      action = excluded.action,
      class_session_id = null,
      created_by = excluded.created_by;
  end if;

  insert into public.audit_logs (actor_id, entity_type, entity_id, action, metadata)
  values (
    v_actor,
    'class_session',
    v_session.id,
    'class.cancelled',
    jsonb_build_object(
      'reason', v_reason,
      'cancelled_bookings', v_cancelled_count,
      'recurring_exception', v_session.recurring_rule_id is not null
    )
  );

  insert into public.audit_logs (actor_id, entity_type, entity_id, action, metadata)
  select
    v_actor,
    'booking',
    b.id,
    'booking.cancelled',
    jsonb_build_object(
      'session_id', b.session_id,
      'student_id', b.student_id,
      'membership_id', b.membership_id,
      'classes_charged', b.credits_charged,
      'class_returned', b.credit_returned_at is not null,
      'reason', v_reason,
      'source', 'class.cancelled'
    )
  from public.bookings b
  where b.session_id = cancel_class_session.session_id
    and b.cancelled_by = v_actor
    and b.cancelled_at = v_cancelled_at;

  return jsonb_build_object(
    'action', 'cancelled',
    'session_id', v_session.id,
    'cancelled_bookings', v_cancelled_count,
    'recurring_exception', v_session.recurring_rule_id is not null
  );
end;
$$;

drop function if exists public.admin_delete_class_session(uuid);

create function public.admin_delete_class_session(
  p_session_id uuid,
  p_scope text default 'single'
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_actor uuid;
  v_session public.class_sessions%rowtype;
  v_rule public.class_recurring_rules%rowtype;
  v_bookings integer;
  v_attendance integer;
  v_scope text := lower(coalesce(nullif(btrim(p_scope), ''), 'single'));
  v_deleted_sessions integer := 0;
  v_cancelled_sessions integer := 0;
  v_cancelled_at timestamptz := now();
begin
  v_actor := private.ensure_admin();

  if v_scope not in ('single', 'series') then
    raise exception 'El alcance de eliminacion no es valido.';
  end if;

  select * into v_session
  from public.class_sessions s
  where s.id = p_session_id
  for update;

  if not found then
    raise exception 'La clase no existe.';
  end if;

  select count(*) into v_bookings
  from public.bookings b
  where b.session_id = p_session_id;

  select count(*) into v_attendance
  from public.attendance a
  where a.session_id = p_session_id;

  if v_scope = 'series' then
    if v_session.recurring_rule_id is null then
      raise exception 'Esta clase no pertenece a un horario recurrente.';
    end if;

    update public.class_recurring_rules r
    set active = false,
        updated_at = now()
    where r.id = v_session.recurring_rule_id
    returning * into v_rule;

    if not found then
      raise exception 'El horario recurrente no existe.';
    end if;

    with future_sessions as (
      select
        s.id,
        exists (select 1 from public.bookings b where b.session_id = s.id) as has_bookings,
        exists (select 1 from public.attendance a where a.session_id = s.id) as has_attendance
      from public.class_sessions s
      where s.recurring_rule_id = v_session.recurring_rule_id
        and s.starts_at >= v_session.starts_at
    ),
    deleted as (
      delete from public.class_sessions s
      using future_sessions fs
      where s.id = fs.id
        and fs.has_bookings is false
        and fs.has_attendance is false
      returning s.id
    ),
    cancelled as (
      update public.class_sessions s
      set active = false,
          cancelled_at = coalesce(s.cancelled_at, v_cancelled_at),
          cancelled_by = coalesce(s.cancelled_by, v_actor),
          cancel_reason = coalesce(s.cancel_reason, 'Horario recurrente eliminado'),
          updated_at = now()
      from future_sessions fs
      where s.id = fs.id
        and (fs.has_bookings or fs.has_attendance)
      returning s.id
    )
    select
      (select count(*)::int from deleted),
      (select count(*)::int from cancelled)
    into v_deleted_sessions, v_cancelled_sessions;

    insert into public.audit_logs (actor_id, entity_type, entity_id, action, metadata)
    values (
      v_actor,
      'class_recurring_rule',
      v_session.recurring_rule_id,
      'class_recurring_rule.deleted_series',
      jsonb_build_object(
        'activity_id', v_rule.activity_id,
        'weekday', v_rule.weekday,
        'start_time', v_rule.start_time,
        'end_time', v_rule.end_time,
        'deleted_future_sessions', v_deleted_sessions,
        'cancelled_future_sessions_with_history', v_cancelled_sessions
      )
    );

    return jsonb_build_object(
      'action', 'deleted_series',
      'rule_id', v_session.recurring_rule_id,
      'session_id', p_session_id,
      'deleted_future_sessions', v_deleted_sessions,
      'cancelled_future_sessions', v_cancelled_sessions
    );
  end if;

  if v_session.recurring_rule_id is not null then
    insert into public.class_recurring_rule_exceptions (
      recurring_rule_id,
      occurrence_starts_at,
      occurrence_ends_at,
      action,
      class_session_id,
      created_by
    )
    values (
      v_session.recurring_rule_id,
      v_session.starts_at,
      v_session.ends_at,
      'cancelled',
      null,
      v_actor
    )
    on conflict (
      recurring_rule_id,
      occurrence_starts_at,
      occurrence_ends_at
    )
    do update set
      action = excluded.action,
      class_session_id = null,
      created_by = excluded.created_by;
  end if;

  if v_bookings + v_attendance = 0 then
    delete from public.class_sessions s
    where s.id = p_session_id;

    insert into public.audit_logs (actor_id, entity_type, entity_id, action, metadata)
    values (
      v_actor,
      'class_session',
      p_session_id,
      'class.deleted',
      jsonb_build_object(
        'activity_id', v_session.activity_id,
        'starts_at', v_session.starts_at,
        'ends_at', v_session.ends_at,
        'capacity', v_session.capacity,
        'recurring_rule_id', v_session.recurring_rule_id,
        'recurring_exception', v_session.recurring_rule_id is not null
      )
    );

    return jsonb_build_object(
      'action', 'deleted',
      'session_id', p_session_id,
      'recurring_exception', v_session.recurring_rule_id is not null
    );
  end if;

  update public.class_sessions s
  set active = false,
      cancelled_at = coalesce(s.cancelled_at, v_cancelled_at),
      cancelled_by = coalesce(s.cancelled_by, v_actor),
      cancel_reason = coalesce(s.cancel_reason, 'Clase eliminada por administracion'),
      updated_at = now()
  where s.id = p_session_id;

  insert into public.audit_logs (actor_id, entity_type, entity_id, action, metadata)
  values (
    v_actor,
    'class_session',
    p_session_id,
    'class.cancelled_by_delete',
    jsonb_build_object(
      'activity_id', v_session.activity_id,
      'starts_at', v_session.starts_at,
      'ends_at', v_session.ends_at,
      'bookings', v_bookings,
      'attendance', v_attendance,
      'recurring_rule_id', v_session.recurring_rule_id,
      'recurring_exception', v_session.recurring_rule_id is not null
    )
  );

  return jsonb_build_object(
    'action', 'cancelled',
    'session_id', p_session_id,
    'has_history', true,
    'recurring_exception', v_session.recurring_rule_id is not null
  );
end;
$$;

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
      delete from public.class_recurring_rule_exceptions cre
      where cre.id = v_exception.id;

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
        perform private.materialize_recurring_class_sessions(
          v_occurrence_starts_at,
          v_occurrence_ends_at
        );

        select s.id into v_restored_session_id
        from public.class_sessions s
        where s.recurring_rule_id = v_existing_rule.id
          and s.starts_at = v_occurrence_starts_at
          and s.ends_at = v_occurrence_ends_at
        order by s.created_at desc
        limit 1;
      end if;

      if v_restored_session_id is null then
        raise exception 'No se pudo restaurar la clase cancelada.';
      end if;

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
          'removed_exception_id', v_exception.id
        )
      );

      return jsonb_build_object(
        'action', 'restored',
        'rule_id', v_existing_rule.id,
        'session_id', v_restored_session_id
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

  perform private.materialize_recurring_class_sessions(
    (coalesce(p_valid_from, current_date)::timestamp at time zone 'America/Argentina/Buenos_Aires'),
    ((coalesce(p_valid_from, current_date) + interval '14 days')::timestamp at time zone 'America/Argentina/Buenos_Aires')
  );

  return jsonb_build_object(
    'action', 'created',
    'rule_id', v_rule.id
  );
end;
$$;

create or replace function public.admin_convert_class_session_to_recurring_rule(
  p_session_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_actor uuid := auth.uid();
  v_session public.class_sessions%rowtype;
  v_activity public.activities%rowtype;
  v_existing_rule public.class_recurring_rules%rowtype;
  v_exception public.class_recurring_rule_exceptions%rowtype;
  v_rule public.class_recurring_rules%rowtype;
  v_valid_from date;
  v_weekday int;
  v_start_time time;
  v_end_time time;
begin
  if v_actor is null or not private.is_admin() then
    raise exception 'Solo un admin activo puede convertir clases a recurrentes.';
  end if;

  select * into v_session
  from public.class_sessions s
  where s.id = p_session_id
  for update;

  if not found then
    raise exception 'La clase no existe.';
  end if;

  if v_session.cancelled_at is not null or v_session.active is not true then
    raise exception 'Solo se puede convertir una clase activa.';
  end if;

  if v_session.recurring_rule_id is not null then
    return jsonb_build_object(
      'action', 'updated',
      'rule_id', v_session.recurring_rule_id,
      'session_id', v_session.id
    );
  end if;

  select * into v_activity
  from public.activities a
  where a.id = v_session.activity_id
    and a.active = true;

  if not found then
    raise exception 'La actividad no existe o esta inactiva.';
  end if;

  v_valid_from := (v_session.starts_at at time zone 'America/Argentina/Buenos_Aires')::date;
  v_weekday := extract(dow from v_session.starts_at at time zone 'America/Argentina/Buenos_Aires')::int;
  v_start_time := to_char(v_session.starts_at at time zone 'America/Argentina/Buenos_Aires', 'HH24:MI:SS')::time;
  v_end_time := to_char(v_session.ends_at at time zone 'America/Argentina/Buenos_Aires', 'HH24:MI:SS')::time;

  select * into v_existing_rule
  from public.class_recurring_rules r
  where r.active = true
    and r.activity_id = v_session.activity_id
    and r.weekday = v_weekday
    and r.start_time = v_start_time
    and r.end_time = v_end_time
    and r.valid_from <= date '9999-12-31'
    and v_valid_from <= coalesce(r.valid_until, date '9999-12-31')
  order by r.valid_from desc, r.created_at desc
  limit 1;

  if found then
    select * into v_exception
    from public.class_recurring_rule_exceptions cre
    where cre.recurring_rule_id = v_existing_rule.id
      and cre.occurrence_starts_at = v_session.starts_at
      and cre.occurrence_ends_at = v_session.ends_at
      and cre.action = 'cancelled'
    for update;

    if not found then
      raise exception 'Ya existe un horario recurrente activo para ese tipo, dia y horario. Pausa el anterior antes de crear otro.';
    end if;

    delete from public.class_recurring_rule_exceptions cre
    where cre.id = v_exception.id;

    update public.class_sessions s
    set recurring_rule_id = v_existing_rule.id,
        title = v_existing_rule.title,
        capacity = v_existing_rule.capacity,
        trainer_name = v_existing_rule.trainer_name,
        notes = v_existing_rule.notes,
        updated_at = now()
    where s.id = v_session.id
    returning * into v_session;

    insert into public.audit_logs (actor_id, entity_type, entity_id, action, metadata)
    values (
      v_actor,
      'class_session',
      v_session.id,
      'class.converted_to_recurring_restored',
      jsonb_build_object(
        'rule_id', v_existing_rule.id,
        'removed_exception_id', v_exception.id
      )
    );

    return jsonb_build_object(
      'action', 'restored',
      'rule_id', v_existing_rule.id,
      'session_id', v_session.id
    );
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
    v_session.activity_id,
    coalesce(nullif(btrim(v_session.title), ''), v_activity.name),
    v_weekday,
    v_start_time,
    v_end_time,
    v_session.capacity,
    v_session.trainer_name,
    v_session.notes,
    true,
    v_valid_from,
    null,
    v_actor
  )
  returning * into v_rule;

  update public.class_sessions s
  set recurring_rule_id = v_rule.id,
      title = v_rule.title,
      updated_at = now()
  where s.id = v_session.id
  returning * into v_session;

  perform private.materialize_recurring_class_sessions(
    v_session.starts_at,
    v_session.starts_at + interval '14 days'
  );

  insert into public.audit_logs (actor_id, entity_type, entity_id, action, metadata)
  values (
    v_actor,
    'class_session',
    v_session.id,
    'class.converted_to_recurring',
    jsonb_build_object(
      'rule_id', v_rule.id,
      'weekday', v_rule.weekday,
      'start_time', v_rule.start_time,
      'end_time', v_rule.end_time,
      'valid_from', v_rule.valid_from,
      'valid_until', v_rule.valid_until
    )
  );

  return jsonb_build_object(
    'action', 'converted',
    'rule_id', v_rule.id,
    'session_id', v_session.id
  );
end;
$$;

do $$
declare
  v_inserted integer;
begin
  with desired_rules(activity_slug, weekday, start_time, end_time, capacity) as (
    values
      ('plan_semipersonalizado', 1, time '07:00', time '08:00', 10),
      ('neurofuncional', 1, time '08:00', time '09:00', 10),
      ('plan_semipersonalizado', 1, time '09:00', time '10:00', 10),
      ('plan_personalizado_semipersonalizado', 1, time '10:00', time '11:00', 10),
      ('plan_semipersonalizado', 1, time '14:00', time '15:00', 5),
      ('plan_semipersonalizado', 1, time '15:00', time '16:00', 10),
      ('plan_semipersonalizado', 1, time '16:00', time '17:00', 10),
      ('plan_semipersonalizado', 1, time '17:00', time '18:00', 10),
      ('neurofuncional', 1, time '18:00', time '19:00', 10),
      ('plan_semipersonalizado', 1, time '19:00', time '20:00', 10),

      ('plan_personalizado_semipersonalizado', 2, time '07:00', time '08:00', 10),
      ('plan_semipersonalizado', 2, time '08:00', time '09:00', 10),
      ('plan_semipersonalizado', 2, time '09:00', time '10:00', 10),
      ('plan_personalizado_semipersonalizado', 2, time '10:00', time '11:00', 10),
      ('plan_semipersonalizado', 2, time '14:00', time '15:00', 5),
      ('plan_semipersonalizado', 2, time '15:00', time '16:00', 10),
      ('plan_semipersonalizado', 2, time '16:00', time '17:00', 10),
      ('plan_personalizado_semipersonalizado', 2, time '17:00', time '18:00', 10),
      ('plan_semipersonalizado', 2, time '18:00', time '19:00', 10),
      ('plan_semipersonalizado', 2, time '19:00', time '20:00', 10),

      ('plan_semipersonalizado', 3, time '07:00', time '08:00', 10),
      ('neurofuncional', 3, time '08:00', time '09:00', 10),
      ('plan_semipersonalizado', 3, time '09:00', time '10:00', 10),
      ('plan_personalizado_semipersonalizado', 3, time '10:00', time '11:00', 10),
      ('plan_semipersonalizado', 3, time '14:00', time '15:00', 5),
      ('plan_semipersonalizado', 3, time '15:00', time '16:00', 10),
      ('plan_semipersonalizado', 3, time '16:00', time '17:00', 10),
      ('plan_semipersonalizado', 3, time '17:00', time '18:00', 10),
      ('neurofuncional', 3, time '18:00', time '19:00', 10),
      ('plan_semipersonalizado', 3, time '19:00', time '20:00', 10),

      ('plan_personalizado_semipersonalizado', 4, time '07:00', time '08:00', 10),
      ('plan_semipersonalizado', 4, time '08:00', time '09:00', 10),
      ('plan_semipersonalizado', 4, time '09:00', time '10:00', 10),
      ('plan_personalizado_semipersonalizado', 4, time '10:00', time '11:00', 10),
      ('plan_semipersonalizado', 4, time '14:00', time '15:00', 5),
      ('plan_semipersonalizado', 4, time '15:00', time '16:00', 10),
      ('plan_semipersonalizado', 4, time '16:00', time '17:00', 10),
      ('plan_personalizado_semipersonalizado', 4, time '17:00', time '18:00', 10),
      ('plan_semipersonalizado', 4, time '18:00', time '19:00', 10),
      ('plan_semipersonalizado', 4, time '19:00', time '20:00', 10),

      ('plan_semipersonalizado', 5, time '07:00', time '08:00', 10),
      ('neurofuncional', 5, time '08:00', time '09:00', 10),
      ('plan_semipersonalizado', 5, time '09:00', time '10:00', 10),
      ('plan_personalizado_semipersonalizado', 5, time '10:00', time '11:00', 10),
      ('cognitivo', 5, time '14:00', time '15:00', 5),
      ('plan_semipersonalizado', 5, time '15:00', time '16:00', 10),
      ('plan_semipersonalizado', 5, time '16:00', time '17:00', 10),
      ('plan_semipersonalizado', 5, time '17:00', time '18:00', 10),
      ('neurofuncional', 5, time '18:00', time '19:00', 10),
      ('plan_semipersonalizado', 5, time '19:00', time '20:00', 10)
  ),
  desired_rule_rows as (
    select
      a.id as activity_id,
      a.name as activity_name,
      dr.activity_slug,
      dr.weekday,
      dr.start_time,
      dr.end_time,
      dr.capacity
    from desired_rules dr
    join public.activities a on a.slug = dr.activity_slug and a.active = true
  ),
  upserted_rules as (
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
      drr.activity_id,
      drr.activity_name,
      drr.weekday,
      drr.start_time,
      drr.end_time,
      drr.capacity,
      null,
      'Cronograma semanal definitivo RAN-34.',
      true,
      date '2026-05-18',
      null,
      null
    from desired_rule_rows drr
    on conflict (
      activity_id,
      weekday,
      start_time,
      end_time,
      valid_from,
      (coalesce(valid_until, date '9999-12-31'))
    )
    where active = true
    do update set
      title = excluded.title,
      capacity = excluded.capacity,
      trainer_name = excluded.trainer_name,
      notes = excluded.notes,
      valid_until = null,
      updated_at = now()
    returning
      id,
      activity_id,
      title,
      weekday,
      start_time,
      end_time,
      capacity,
      trainer_name,
      notes
  ),
  rules_to_archive as (
    select r.id
    from public.class_recurring_rules r
    join public.activities a on a.id = r.activity_id
    where r.active = true
      and a.slug in (
        'cognitivo',
        'funcional',
        'neurofuncional',
        'ninos',
        'personalizado_1_1',
        'plan_personalizado_semipersonalizado',
        'plan_semipersonalizado'
      )
      and not exists (
        select 1
        from desired_rules dr
        where dr.activity_slug = a.slug
          and dr.weekday = r.weekday
          and dr.start_time = r.start_time
          and dr.end_time = r.end_time
          and r.valid_from = date '2026-05-18'
          and r.valid_until is null
      )
  ),
  archived_rules as (
    update public.class_recurring_rules r
    set active = false,
        updated_at = now()
    from rules_to_archive rta
    where r.id = rta.id
    returning r.id
  ),
  future_wrong_sessions as (
    select
      s.id,
      exists (select 1 from public.bookings b where b.session_id = s.id) as has_bookings,
      exists (select 1 from public.attendance att where att.session_id = s.id) as has_attendance,
      exists (
        select 1
        from public.class_recurring_rule_exceptions cre
        where cre.class_session_id = s.id
          and cre.action = 'edited'
      ) as has_edited_exception
    from public.class_sessions s
    join archived_rules ar on ar.id = s.recurring_rule_id
    where s.starts_at >= timestamptz '2026-05-29 00:00:00-03'
  ),
  edited_future_sessions as (
    select
      s.id,
      desired_rule.id as desired_rule_id,
      desired_rule.title,
      desired_rule.capacity,
      desired_rule.trainer_name,
      desired_rule.notes
    from public.class_sessions s
    join future_wrong_sessions fws on fws.id = s.id
    join public.activities a on a.id = s.activity_id
    left join upserted_rules desired_rule
      on desired_rule.activity_id = s.activity_id
     and desired_rule.weekday =
       extract(dow from s.starts_at at time zone 'America/Argentina/Buenos_Aires')::int
     and desired_rule.start_time =
       to_char(s.starts_at at time zone 'America/Argentina/Buenos_Aires', 'HH24:MI:SS')::time
     and desired_rule.end_time =
       to_char(s.ends_at at time zone 'America/Argentina/Buenos_Aires', 'HH24:MI:SS')::time
    where fws.has_edited_exception is true
      and exists (
        select 1
        from desired_rules dr
        where dr.activity_slug = a.slug
          and dr.weekday =
            extract(dow from s.starts_at at time zone 'America/Argentina/Buenos_Aires')::int
          and dr.start_time =
            to_char(s.starts_at at time zone 'America/Argentina/Buenos_Aires', 'HH24:MI:SS')::time
          and dr.end_time =
            to_char(s.ends_at at time zone 'America/Argentina/Buenos_Aires', 'HH24:MI:SS')::time
      )
  ),
  rehome_edited_sessions as (
    update public.class_sessions s
    set recurring_rule_id = efs.desired_rule_id,
        title = coalesce(efs.title, s.title),
        capacity = coalesce(efs.capacity, s.capacity),
        trainer_name = efs.trainer_name,
        notes = efs.notes,
        updated_at = now()
    from edited_future_sessions efs
    where s.id = efs.id
      and efs.desired_rule_id is not null
      and not exists (
        select 1
        from public.class_sessions existing
        where existing.id <> s.id
          and existing.activity_id = s.activity_id
          and existing.starts_at = s.starts_at
          and existing.ends_at = s.ends_at
          and existing.active = true
          and existing.cancelled_at is null
      )
    returning s.id
  ),
  deleted_wrong_sessions as (
    delete from public.class_sessions s
    using future_wrong_sessions fws
    where s.id = fws.id
      and fws.has_bookings is false
      and fws.has_attendance is false
      and fws.has_edited_exception is false
    returning s.id
  ),
  cancelled_wrong_sessions as (
    update public.class_sessions s
    set active = false,
        cancelled_at = coalesce(s.cancelled_at, now()),
        cancel_reason = coalesce(s.cancel_reason, 'Fuera del cronograma definitivo RAN-34'),
        updated_at = now()
    from future_wrong_sessions fws
    where s.id = fws.id
      and (fws.has_bookings or fws.has_attendance)
      and fws.has_edited_exception is false
    returning s.id
  ),
  normalized_sessions as (
    update public.class_sessions s
    set title = r.title,
        capacity = r.capacity,
        trainer_name = r.trainer_name,
        notes = r.notes,
        updated_at = now()
    from public.class_recurring_rules r
    where s.recurring_rule_id = r.id
      and r.active = true
      and s.starts_at >= timestamptz '2026-05-29 00:00:00-03'
      and not exists (
        select 1
        from public.bookings b
        where b.session_id = s.id
      )
      and not exists (
        select 1
        from public.attendance att
        where att.session_id = s.id
      )
      and not exists (
        select 1
        from public.class_recurring_rule_exceptions cre
        where cre.class_session_id = s.id
          and cre.action = 'edited'
      )
    returning s.id
  )
  select count(*) into v_inserted from upserted_rules;

  perform private.materialize_recurring_class_sessions(
    timestamptz '2026-05-29 00:00:00-03',
    timestamptz '2026-08-26 00:00:00-03'
  );
end $$;

revoke all on function public.list_calendar_sessions(timestamptz, timestamptz) from public, anon;
revoke all on function public.cancel_class_session(uuid, text) from public, anon;
revoke all on function public.admin_delete_class_session(uuid, text) from public, anon;
revoke all on function public.admin_create_class_recurring_rule(uuid, text, int, time, time, int, text, text, date, date) from public, anon;
revoke all on function public.admin_convert_class_session_to_recurring_rule(uuid) from public, anon;

grant execute on function public.list_calendar_sessions(timestamptz, timestamptz) to authenticated;
grant execute on function public.cancel_class_session(uuid, text) to authenticated;
grant execute on function public.admin_delete_class_session(uuid, text) to authenticated;
grant execute on function public.admin_create_class_recurring_rule(uuid, text, int, time, time, int, text, text, date, date) to authenticated;
grant execute on function public.admin_convert_class_session_to_recurring_rule(uuid) to authenticated;
