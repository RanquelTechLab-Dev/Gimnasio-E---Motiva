-- RAN-34: improve saved fixed schedule visibility and safe cancellation.
--
-- Safety:
-- - No payments, students/profiles, memberships, attendance or audit logs are deleted.
-- - No bookings are deleted; the cancel RPC only updates eligible bookings to cancelled.
-- - Deactivating a fixed schedule remains separate from cancelling reservations.
-- - Existing/historical bookings are not inferred into new schedules.

drop function if exists public.admin_list_student_fixed_schedules(uuid);

create or replace function public.admin_list_student_fixed_schedules(
  p_student_id uuid
)
returns table (
  schedule_id uuid,
  student_id uuid,
  membership_id uuid,
  plan_name text,
  activity_name text,
  weekdays integer[],
  weekday_labels text,
  start_time time,
  active boolean,
  membership_start_date date,
  membership_end_date date,
  membership_status public.membership_status,
  last_applied_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz,
  booking_details jsonb
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
    raise exception 'Solo un admin activo puede ver horarios habituales.';
  end if;

  if p_student_id is null then
    raise exception 'Alumno requerido.';
  end if;

  select *
  into v_student
  from public.profiles p
  where p.id = p_student_id
    and p.role = 'student'::public.user_role;

  if not found then
    raise exception 'Alumno no encontrado.';
  end if;

  return query
  select
    sfs.id,
    sfs.student_id,
    sfs.membership_id,
    pl.name,
    a.name,
    sfs.weekdays,
    (
      select string_agg(
        case day_value
          when 1 then 'Lun'
          when 2 then 'Mar'
          when 3 then 'Mie'
          when 4 then 'Jue'
          when 5 then 'Vie'
          when 6 then 'Sab'
          when 7 then 'Dom'
          else day_value::text
        end,
        ', '
        order by day_value
      )
      from unnest(sfs.weekdays) as days(day_value)
    ) as weekday_labels,
    sfs.start_time,
    sfs.active,
    m.start_date,
    m.end_date,
    m.status,
    sfs.last_applied_at,
    sfs.created_at,
    sfs.updated_at,
    coalesce(details.booking_details, '[]'::jsonb) as booking_details
  from public.student_fixed_schedules sfs
  join public.memberships m on m.id = sfs.membership_id
  join public.plans pl on pl.id = m.plan_id
  join public.activities a on a.id = sfs.activity_id
  left join lateral (
    select jsonb_agg(
      jsonb_build_object(
        'date', (cs.starts_at at time zone 'America/Argentina/Buenos_Aires')::date,
        'weekday', extract(isodow from cs.starts_at at time zone 'America/Argentina/Buenos_Aires')::integer,
        'weekday_label', case extract(isodow from cs.starts_at at time zone 'America/Argentina/Buenos_Aires')::integer
          when 1 then 'Lunes'
          when 2 then 'Martes'
          when 3 then 'Miercoles'
          when 4 then 'Jueves'
          when 5 then 'Viernes'
          when 6 then 'Sabado'
          when 7 then 'Domingo'
        end,
        'starts_at', cs.starts_at,
        'ends_at', cs.ends_at,
        'session_id', cs.id,
        'booking_id', b.id,
        'booking_status', b.status,
        'is_past', cs.starts_at < now(),
        'can_admin_cancel', b.status = 'booked'::public.booking_status
      )
      order by cs.starts_at asc
    ) as booking_details
    from public.class_sessions cs
    join public.bookings b on b.session_id = cs.id
    where b.student_id = sfs.student_id
      and b.membership_id = sfs.membership_id
      and cs.activity_id = sfs.activity_id
      and cs.starts_at::date between m.start_date and m.end_date
      and extract(isodow from cs.starts_at at time zone 'America/Argentina/Buenos_Aires')::integer = any(sfs.weekdays)
      and (cs.starts_at at time zone 'America/Argentina/Buenos_Aires')::time = sfs.start_time
  ) details on true
  where sfs.student_id = p_student_id
  order by sfs.active desc, sfs.start_time asc, sfs.created_at desc;
end;
$$;

create or replace function public.admin_preview_cancel_fixed_schedule_bookings(
  p_schedule_id uuid,
  p_cancel_past boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_actor uuid := auth.uid();
  v_schedule public.student_fixed_schedules%rowtype;
  v_membership public.memberships%rowtype;
  v_details jsonb;
begin
  if v_actor is null or not coalesce(private.is_admin(), false) then
    raise exception 'Solo un admin activo puede previsualizar cancelaciones fijas.';
  end if;

  select *
  into v_schedule
  from public.student_fixed_schedules sfs
  where sfs.id = p_schedule_id;

  if not found then
    raise exception 'Horario habitual no encontrado.';
  end if;

  select *
  into v_membership
  from public.memberships m
  where m.id = v_schedule.membership_id;

  if not found then
    raise exception 'Programa no encontrado.';
  end if;

  with matching as (
    select
      cs.id as session_id,
      cs.starts_at,
      cs.ends_at,
      b.id as booking_id,
      b.status as booking_status,
      extract(isodow from cs.starts_at at time zone 'America/Argentina/Buenos_Aires')::integer as weekday,
      (cs.starts_at at time zone 'America/Argentina/Buenos_Aires')::date as local_date,
      cs.starts_at < now() as is_past,
      (
        b.status = 'booked'::public.booking_status
        and (p_cancel_past or cs.starts_at >= now())
      ) as can_admin_cancel
    from public.class_sessions cs
    join public.bookings b on b.session_id = cs.id
    where b.student_id = v_schedule.student_id
      and b.membership_id = v_schedule.membership_id
      and cs.activity_id = v_schedule.activity_id
      and cs.starts_at::date between v_membership.start_date and v_membership.end_date
      and extract(isodow from cs.starts_at at time zone 'America/Argentina/Buenos_Aires')::integer = any(v_schedule.weekdays)
      and (cs.starts_at at time zone 'America/Argentina/Buenos_Aires')::time = v_schedule.start_time
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'date', local_date,
        'weekday', weekday,
        'weekday_label', case weekday
          when 1 then 'Lunes'
          when 2 then 'Martes'
          when 3 then 'Miercoles'
          when 4 then 'Jueves'
          when 5 then 'Viernes'
          when 6 then 'Sabado'
          when 7 then 'Domingo'
        end,
        'starts_at', starts_at,
        'ends_at', ends_at,
        'session_id', session_id,
        'booking_id', booking_id,
        'booking_status', booking_status,
        'is_past', is_past,
        'can_admin_cancel', can_admin_cancel
      )
      order by starts_at asc
    ),
    '[]'::jsonb
  )
  into v_details
  from matching;

  return jsonb_build_object(
    'schedule_id', v_schedule.id,
    'cancel_past', coalesce(p_cancel_past, false),
    'total_matching_bookings', jsonb_array_length(v_details),
    'cancellable_count', (
      select count(*)::int
      from jsonb_array_elements(v_details) detail
      where (detail->>'can_admin_cancel')::boolean
    ),
    'past_count', (
      select count(*)::int
      from jsonb_array_elements(v_details) detail
      where (detail->>'booking_status') = 'booked'
        and (detail->>'is_past')::boolean
    ),
    'future_count', (
      select count(*)::int
      from jsonb_array_elements(v_details) detail
      where (detail->>'booking_status') = 'booked'
        and (detail->>'is_past')::boolean is false
    ),
    'already_cancelled_count', (
      select count(*)::int
      from jsonb_array_elements(v_details) detail
      where (detail->>'booking_status') = 'cancelled'
    ),
    'details', v_details
  );
end;
$$;

create or replace function public.admin_cancel_fixed_schedule_bookings(
  p_schedule_id uuid,
  p_reason text,
  p_cancel_past boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_actor uuid := auth.uid();
  v_schedule public.student_fixed_schedules%rowtype;
  v_membership public.memberships%rowtype;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_cancelled_ids uuid[];
begin
  if v_actor is null or not coalesce(private.is_admin(), false) then
    raise exception 'Solo un admin activo puede cancelar reservas fijas.';
  end if;

  if v_reason is null then
    raise exception 'El motivo de cancelacion es obligatorio.';
  end if;

  select *
  into v_schedule
  from public.student_fixed_schedules sfs
  where sfs.id = p_schedule_id;

  if not found then
    raise exception 'Horario habitual no encontrado.';
  end if;

  select *
  into v_membership
  from public.memberships m
  where m.id = v_schedule.membership_id;

  if not found then
    raise exception 'Programa no encontrado.';
  end if;

  with eligible as (
    select b.id
    from public.class_sessions cs
    join public.bookings b on b.session_id = cs.id
    where b.student_id = v_schedule.student_id
      and b.membership_id = v_schedule.membership_id
      and b.status = 'booked'::public.booking_status
      and cs.activity_id = v_schedule.activity_id
      and cs.starts_at::date between v_membership.start_date and v_membership.end_date
      and extract(isodow from cs.starts_at at time zone 'America/Argentina/Buenos_Aires')::integer = any(v_schedule.weekdays)
      and (cs.starts_at at time zone 'America/Argentina/Buenos_Aires')::time = v_schedule.start_time
      and (coalesce(p_cancel_past, false) or cs.starts_at >= now())
  ),
  updated as (
    update public.bookings b
    set
      status = 'cancelled'::public.booking_status,
      cancelled_at = now(),
      cancelled_by = v_actor,
      cancel_reason = v_reason,
      charged_as_attended = false,
      updated_at = now()
    where b.id in (select id from eligible)
    returning b.id
  )
  select coalesce(array_agg(id), array[]::uuid[])
  into v_cancelled_ids
  from updated;

  insert into public.audit_logs (actor_id, entity_type, entity_id, action, metadata)
  values (
    v_actor,
    'student_fixed_schedule',
    v_schedule.id,
    'student_fixed_schedule.bookings_cancelled_by_admin',
    jsonb_build_object(
      'student_id', v_schedule.student_id,
      'membership_id', v_schedule.membership_id,
      'activity_id', v_schedule.activity_id,
      'cancel_past', coalesce(p_cancel_past, false),
      'reason', v_reason,
      'cancelled_booking_ids', to_jsonb(v_cancelled_ids),
      'cancelled_count', coalesce(array_length(v_cancelled_ids, 1), 0),
      'does_not_delete_bookings', true
    )
  );

  return jsonb_build_object(
    'schedule_id', v_schedule.id,
    'cancelled_count', coalesce(array_length(v_cancelled_ids, 1), 0),
    'cancelled_booking_ids', to_jsonb(v_cancelled_ids),
    'cancel_past', coalesce(p_cancel_past, false),
    'does_not_delete_bookings', true
  );
end;
$$;

revoke all on function public.admin_list_student_fixed_schedules(uuid)
  from public, anon;
revoke all on function public.admin_preview_cancel_fixed_schedule_bookings(uuid, boolean)
  from public, anon;
revoke all on function public.admin_cancel_fixed_schedule_bookings(uuid, text, boolean)
  from public, anon;

grant execute on function public.admin_list_student_fixed_schedules(uuid)
  to authenticated;
grant execute on function public.admin_preview_cancel_fixed_schedule_bookings(uuid, boolean)
  to authenticated;
grant execute on function public.admin_cancel_fixed_schedule_bookings(uuid, text, boolean)
  to authenticated;
