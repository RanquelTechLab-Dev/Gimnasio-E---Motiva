-- RAN-34: hard-delete eligible fixed-schedule bookings and hide empty schedules.
--
-- Safety:
-- - Payments, students/profiles, memberships, attendance and audit logs are not deleted.
-- - Only future booked bookings without attendance can be physically deleted.
-- - Empty fixed-schedule configurations are deleted only after they have no future
--   active bookings left.

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
    details.booking_details
  from public.student_fixed_schedules sfs
  join public.memberships m on m.id = sfs.membership_id
  join public.plans pl on pl.id = m.plan_id
  join public.activities a on a.id = sfs.activity_id
  join lateral (
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
        'can_admin_cancel',
          b.status = 'booked'::public.booking_status
          and cs.starts_at >= now()
          and coalesce(b.credits_charged, 0) = 0
          and not exists (
            select 1
            from public.attendance att
            where att.booking_id = b.id
          )
      )
      order by cs.starts_at asc
    ) as booking_details
    from public.class_sessions cs
    join public.bookings b on b.session_id = cs.id
    where b.student_id = sfs.student_id
      and b.membership_id = sfs.membership_id
      and b.status = 'booked'::public.booking_status
      and cs.activity_id = sfs.activity_id
      and cs.starts_at >= now()
      and cs.starts_at::date between m.start_date and m.end_date
      and extract(isodow from cs.starts_at at time zone 'America/Argentina/Buenos_Aires')::integer = any(sfs.weekdays)
      and (cs.starts_at at time zone 'America/Argentina/Buenos_Aires')::time = sfs.start_time
  ) details on details.booking_details is not null
  where sfs.student_id = p_student_id
    and sfs.active
  order by sfs.start_time asc, sfs.created_at desc;
end;
$$;

create or replace function public.admin_delete_fixed_schedule_selected_bookings(
  p_booking_ids uuid[],
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_actor uuid := auth.uid();
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_requested_ids uuid[];
  v_requested_count integer := 0;
  v_delete_ids uuid[] := array[]::uuid[];
  v_deleted_ids uuid[] := array[]::uuid[];
  v_deleted_count integer := 0;
  v_affected_schedule_ids uuid[] := array[]::uuid[];
  v_deleted_schedule_ids uuid[] := array[]::uuid[];
  v_deleted_schedule_count integer := 0;
  v_details jsonb := '[]'::jsonb;
  v_skipped_past_count integer := 0;
  v_skipped_with_attendance_count integer := 0;
  v_skipped_credit_charged_count integer := 0;
begin
  if v_actor is null or not coalesce(private.is_admin(), false) then
    raise exception 'Solo un admin activo puede eliminar reservas fijas.';
  end if;

  if v_reason is null then
    raise exception 'El motivo de eliminacion es obligatorio.';
  end if;

  select coalesce(array_agg(distinct booking_id), array[]::uuid[])
  into v_requested_ids
  from unnest(coalesce(p_booking_ids, array[]::uuid[])) as input_ids(booking_id)
  where booking_id is not null;

  v_requested_count := coalesce(array_length(v_requested_ids, 1), 0);

  if v_requested_count = 0 then
    raise exception 'Selecciona al menos una reserva para eliminar.';
  end if;

  with requested as (
    select unnest(v_requested_ids) as booking_id
  ),
  candidates as (
    select
      r.booking_id as requested_booking_id,
      b.id as booking_id,
      b.status as booking_status,
      b.student_id,
      b.membership_id,
      b.session_id,
      cs.activity_id,
      cs.starts_at,
      b.credits_charged,
      cs.starts_at >= now() as is_future,
      (
        select count(*)::integer
        from public.attendance att
        where att.booking_id = b.id
      ) as attendance_count
    from requested r
    left join public.bookings b on b.id = r.booking_id
    left join public.class_sessions cs on cs.id = b.session_id
  ),
  matched_schedules as (
    select distinct
      c.requested_booking_id,
      sfs.id as schedule_id
    from candidates c
    join public.student_fixed_schedules sfs
      on sfs.student_id = c.student_id
     and sfs.membership_id = c.membership_id
     and sfs.activity_id = c.activity_id
     and extract(isodow from c.starts_at at time zone 'America/Argentina/Buenos_Aires')::integer = any(sfs.weekdays)
     and (c.starts_at at time zone 'America/Argentina/Buenos_Aires')::time = sfs.start_time
    where c.booking_id is not null
  ),
  detail_rows as (
    select
      c.requested_booking_id,
      c.booking_status,
      c.student_id,
      c.membership_id,
      c.session_id,
      c.activity_id,
      c.starts_at,
      c.credits_charged,
      c.is_future,
      c.attendance_count,
      coalesce(
        array_agg(ms.schedule_id order by ms.schedule_id)
          filter (where ms.schedule_id is not null),
        array[]::uuid[]
      ) as schedule_ids,
      (
        c.booking_id is not null
        and c.booking_status = 'booked'::public.booking_status
        and coalesce(c.is_future, false)
        and coalesce(c.credits_charged, 0) = 0
        and coalesce(c.attendance_count, 0) = 0
      ) as will_delete,
      case
        when c.booking_id is null then 'not_found'
        when c.booking_status <> 'booked'::public.booking_status then 'not_active'
        when not coalesce(c.is_future, false) then 'past_booking'
        when coalesce(c.credits_charged, 0) > 0 then 'with_charged_credit'
        when coalesce(c.attendance_count, 0) > 0 then 'with_attendance'
        else null
      end as skipped_reason
    from candidates c
    left join matched_schedules ms
      on ms.requested_booking_id = c.requested_booking_id
    group by
      c.requested_booking_id,
      c.booking_id,
      c.booking_status,
      c.student_id,
      c.membership_id,
      c.session_id,
      c.activity_id,
      c.starts_at,
      c.credits_charged,
      c.is_future,
      c.attendance_count
  ),
  aggregate_rows as (
    select
      coalesce(array_agg(requested_booking_id) filter (where will_delete), array[]::uuid[]) as delete_ids,
      count(*) filter (where skipped_reason = 'past_booking')::integer as skipped_past_count,
      count(*) filter (where skipped_reason = 'with_attendance')::integer as skipped_with_attendance_count,
      count(*) filter (where skipped_reason = 'with_charged_credit')::integer as skipped_credit_charged_count,
      coalesce(
        jsonb_agg(
          jsonb_build_object(
            'booking_id', requested_booking_id,
            'status_before', booking_status,
            'student_id', student_id,
            'membership_id', membership_id,
            'session_id', session_id,
            'activity_id', activity_id,
            'starts_at', starts_at,
            'credits_charged', credits_charged,
            'is_future', is_future,
            'attendance_count', attendance_count,
            'schedule_ids', to_jsonb(schedule_ids),
            'deleted', will_delete,
            'skipped_reason', skipped_reason
          )
          order by starts_at nulls last, requested_booking_id
        ),
        '[]'::jsonb
      ) as details
    from detail_rows
  ),
  affected_schedules as (
    select coalesce(array_agg(distinct schedule_id), array[]::uuid[]) as schedule_ids
    from detail_rows dr
    cross join lateral unnest(dr.schedule_ids) as schedule_ids(schedule_id)
    where dr.will_delete
  )
  select
    aggregate_rows.delete_ids,
    affected_schedules.schedule_ids,
    aggregate_rows.skipped_past_count,
    aggregate_rows.skipped_with_attendance_count,
    aggregate_rows.skipped_credit_charged_count,
    aggregate_rows.details
  into
    v_delete_ids,
    v_affected_schedule_ids,
    v_skipped_past_count,
    v_skipped_with_attendance_count,
    v_skipped_credit_charged_count,
    v_details
  from aggregate_rows
  cross join affected_schedules;

  with deleted_bookings as (
    delete from public.bookings b
    where b.id = any(v_delete_ids)
    returning b.id
  )
  select coalesce(array_agg(id), array[]::uuid[])
  into v_deleted_ids
  from deleted_bookings;

  v_deleted_count := coalesce(array_length(v_deleted_ids, 1), 0);

  with affected as (
    select unnest(coalesce(v_affected_schedule_ids, array[]::uuid[])) as schedule_id
  ),
  deleted_schedules as (
    delete from public.student_fixed_schedules sfs
    using affected a
    where sfs.id = a.schedule_id
      and not exists (
        select 1
        from public.class_sessions cs
        join public.bookings b on b.session_id = cs.id
        where b.student_id = sfs.student_id
          and b.membership_id = sfs.membership_id
          and b.status = 'booked'::public.booking_status
          and cs.activity_id = sfs.activity_id
          and cs.starts_at >= now()
          and extract(isodow from cs.starts_at at time zone 'America/Argentina/Buenos_Aires')::integer = any(sfs.weekdays)
          and (cs.starts_at at time zone 'America/Argentina/Buenos_Aires')::time = sfs.start_time
      )
    returning sfs.id
  )
  select
    coalesce(array_agg(id), array[]::uuid[]),
    count(*)::integer
  into v_deleted_schedule_ids, v_deleted_schedule_count
  from deleted_schedules;

  insert into public.audit_logs (actor_id, entity_type, entity_id, action, metadata)
  values (
    v_actor,
    'booking',
    coalesce(v_deleted_ids[1], v_requested_ids[1]),
    'fixed_schedule.selected_bookings_deleted_by_admin',
    jsonb_build_object(
      'reason', v_reason,
      'requested_count', v_requested_count,
      'deleted_count', v_deleted_count,
      'skipped_count', v_requested_count - v_deleted_count,
      'skipped_past_count', v_skipped_past_count,
      'skipped_with_attendance_count', v_skipped_with_attendance_count,
      'skipped_credit_charged_count', v_skipped_credit_charged_count,
      'requested_booking_ids', to_jsonb(v_requested_ids),
      'deleted_booking_ids', to_jsonb(v_deleted_ids),
      'affected_schedule_ids', to_jsonb(v_affected_schedule_ids),
      'deleted_schedule_ids', to_jsonb(v_deleted_schedule_ids),
      'deleted_schedule_count', v_deleted_schedule_count,
      'details', v_details,
      'does_not_delete_payments', true,
      'does_not_delete_memberships', true,
      'does_not_delete_attendance', true,
      'does_not_touch_memberships', true,
      'deletes_only_future_bookings_without_attendance', true
    )
  );

  return jsonb_build_object(
    'requested_count', v_requested_count,
    'deleted_count', v_deleted_count,
    'skipped_count', v_requested_count - v_deleted_count,
    'skipped_past_count', v_skipped_past_count,
    'skipped_with_attendance_count', v_skipped_with_attendance_count,
    'skipped_credit_charged_count', v_skipped_credit_charged_count,
    'deleted_booking_ids', to_jsonb(v_deleted_ids),
    'deleted_schedule_ids', to_jsonb(v_deleted_schedule_ids),
    'deleted_schedule_count', v_deleted_schedule_count,
    'details', v_details
  );
end;
$$;

revoke all on function public.admin_list_student_fixed_schedules(uuid)
  from public, anon;
revoke all on function public.admin_delete_fixed_schedule_selected_bookings(uuid[], text)
  from public, anon;

grant execute on function public.admin_list_student_fixed_schedules(uuid)
  to authenticated;
grant execute on function public.admin_delete_fixed_schedule_selected_bookings(uuid[], text)
  to authenticated;
