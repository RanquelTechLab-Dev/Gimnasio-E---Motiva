-- RAN-34: fixed schedule booking by student from Admin -> Alumnos.
--
-- Safety:
-- - No payments, students/profiles, memberships, bookings, attendance or audit logs are deleted.
-- - No class sessions are created.
-- - Preview never writes data.
-- - Bulk booking inserts or reactivates only eligible bookings and writes audit logs.

create or replace function private.admin_fixed_schedule_summary(
  p_student_id uuid,
  p_membership_id uuid,
  p_weekdays integer[],
  p_start_time time,
  p_execute boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_actor uuid := auth.uid();
  v_student public.profiles%rowtype;
  v_membership public.memberships%rowtype;
  v_plan public.plans%rowtype;
  v_weekdays integer[];
  v_candidate record;
  v_existing public.bookings%rowtype;
  v_booking public.bookings%rowtype;
  v_details jsonb := '[]'::jsonb;
  v_status text;
  v_reason text;
  v_classes_charged integer;
  v_week_key text;
  v_weekly_planned jsonb := '{}'::jsonb;
  v_planned_for_week integer;
  v_package_planned integer := 0;
  v_created_count integer := 0;
  v_available_count integer := 0;
  v_already_booked_count integer := 0;
  v_skipped_full_count integer := 0;
  v_skipped_out_of_validity_count integer := 0;
  v_skipped_weekly_limit_count integer := 0;
  v_skipped_no_permission_count integer := 0;
  v_skipped_conflict_count integer := 0;
  v_skipped_other_count integer := 0;
begin
  if v_actor is null or not coalesce(private.is_admin(), false) then
    raise exception 'Solo un admin activo puede operar reservas fijas.';
  end if;

  if p_student_id is null or p_membership_id is null then
    raise exception 'Alumno y programa son requeridos.';
  end if;

  v_weekdays := (
    select array_agg(distinct day_value order by day_value)
    from unnest(coalesce(p_weekdays, array[]::integer[])) as days(day_value)
    where day_value between 1 and 7
  );

  if coalesce(array_length(v_weekdays, 1), 0) = 0 then
    raise exception 'Selecciona al menos un dia.';
  end if;

  if p_start_time is null then
    raise exception 'Horario requerido.';
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
  into v_membership
  from public.memberships m
  where m.id = p_membership_id
    and m.student_id = p_student_id;

  if not found then
    raise exception 'El programa no pertenece al alumno.';
  end if;

  select *
  into v_plan
  from public.plans p
  where p.id = v_membership.plan_id;

  if not found then
    raise exception 'Plan no disponible.';
  end if;

  if v_membership.status <> 'active'::public.membership_status then
    raise exception 'El programa no esta activo.';
  end if;

  if private.membership_is_fully_paid(v_membership.id) is not true then
    raise exception 'El programa no tiene pago completo.';
  end if;

  for v_candidate in
    select
      s.id as session_id,
      s.activity_id,
      a.name as activity_name,
      a.slug as activity_slug,
      s.title,
      s.starts_at,
      s.ends_at,
      s.capacity,
      s.active as session_active,
      s.cancelled_at,
      p.plan_type,
      coalesce(pa.weekly_class_limit, pa.monthly_credits, p.package_class_count) as weekly_class_limit,
      case
        when p.plan_type <> 'package' then private.weekly_activity_usage(
          p_student_id,
          v_membership.id,
          s.activity_id,
          s.starts_at
        )
        else null
      end as weekly_classes_used,
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
        order by b.created_at desc
        limit 1
      ) as existing_booking_id,
      exists (
        select 1
        from public.bookings b
        join public.attendance att on att.booking_id = b.id
        where b.session_id = s.id
          and b.student_id = p_student_id
      ) as has_attendance_history
    from public.class_sessions s
    join public.activities a on a.id = s.activity_id
    join public.plan_activities pa on pa.activity_id = s.activity_id
    join public.plans p on p.id = pa.plan_id
    where pa.plan_id = v_membership.plan_id
      and s.starts_at::date between v_membership.start_date and v_membership.end_date
      and extract(isodow from s.starts_at at time zone 'America/Argentina/Buenos_Aires')::integer = any(v_weekdays)
      and (s.starts_at at time zone 'America/Argentina/Buenos_Aires')::time = p_start_time
    order by s.starts_at asc, a.name asc
  loop
    v_status := 'available';
    v_reason := null;
    v_classes_charged := 0;

    select *
    into v_existing
    from public.bookings b
    where b.id = v_candidate.existing_booking_id;

    if v_candidate.session_active is not true or v_candidate.cancelled_at is not null then
      v_status := 'skipped_other';
      v_reason := 'Clase cancelada o inactiva';
      v_skipped_other_count := v_skipped_other_count + 1;
    elsif v_existing.id is not null and v_existing.status in (
      'booked'::public.booking_status,
      'attended'::public.booking_status,
      'no_show'::public.booking_status
    ) then
      v_status := 'already_booked';
      v_reason := 'Ya existe una reserva o historial activo para esta clase';
      v_already_booked_count := v_already_booked_count + 1;
    elsif v_existing.id is not null
      and v_existing.status = 'cancelled'::public.booking_status
      and v_candidate.has_attendance_history then
      v_status := 'skipped_conflict';
      v_reason := 'La reserva cancelada tiene historial de asistencia';
      v_skipped_conflict_count := v_skipped_conflict_count + 1;
    elsif v_candidate.active_bookings >= v_candidate.capacity then
      v_status := 'skipped_full';
      v_reason := 'Sin cupos disponibles';
      v_skipped_full_count := v_skipped_full_count + 1;
    elsif v_candidate.plan_type = 'package' then
      if coalesce(v_membership.remaining_credits, 0) - v_package_planned <= 0 then
        v_status := 'skipped_no_permission';
        v_reason := 'Sin creditos disponibles';
        v_skipped_no_permission_count := v_skipped_no_permission_count + 1;
      else
        v_available_count := v_available_count + 1;
        v_package_planned := v_package_planned + 1;
        v_classes_charged := 1;
      end if;
    elsif v_candidate.weekly_class_limit is null then
      v_status := 'skipped_no_permission';
      v_reason := 'El plan no tiene limite semanal configurado';
      v_skipped_no_permission_count := v_skipped_no_permission_count + 1;
    else
      v_week_key := concat(
        v_candidate.activity_id::text,
        ':',
        date_trunc(
          'week',
          v_candidate.starts_at at time zone 'America/Argentina/Buenos_Aires'
        )::date::text
      );
      v_planned_for_week := coalesce((v_weekly_planned ->> v_week_key)::integer, 0);

      if coalesce(v_candidate.weekly_classes_used, 0) + v_planned_for_week >= v_candidate.weekly_class_limit then
        v_status := 'skipped_weekly_limit';
        v_reason := 'Supera el limite semanal del programa';
        v_skipped_weekly_limit_count := v_skipped_weekly_limit_count + 1;
      else
        v_available_count := v_available_count + 1;
        v_weekly_planned := jsonb_set(
          v_weekly_planned,
          array[v_week_key],
          to_jsonb(v_planned_for_week + 1),
          true
        );
      end if;
    end if;

    if p_execute and v_status = 'available' then
      if v_candidate.plan_type = 'package' then
        update public.memberships
        set
          remaining_credits = remaining_credits - 1,
          updated_at = now()
        where id = v_membership.id
        returning * into v_membership;
      end if;

      if v_existing.id is not null and v_existing.status = 'cancelled'::public.booking_status then
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
        where id = v_existing.id
        returning * into v_booking;
      else
        insert into public.bookings (
          session_id,
          student_id,
          membership_id,
          credits_charged
        )
        values (
          v_candidate.session_id,
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
        'booking.fixed_schedule_created_by_admin',
        jsonb_build_object(
          'student_id', p_student_id,
          'session_id', v_candidate.session_id,
          'membership_id', v_membership.id,
          'activity_id', v_candidate.activity_id,
          'source', 'admin.students.fixed_schedule',
          'classes_charged', v_classes_charged
        )
      );

      v_status := 'created';
      v_reason := 'Reserva creada';
      v_created_count := v_created_count + 1;
    end if;

    v_details := v_details || jsonb_build_array(
      jsonb_build_object(
        'session_id', v_candidate.session_id,
        'activity_id', v_candidate.activity_id,
        'activity_name', v_candidate.activity_name,
        'activity_slug', v_candidate.activity_slug,
        'title', v_candidate.title,
        'starts_at', v_candidate.starts_at,
        'ends_at', v_candidate.ends_at,
        'capacity', v_candidate.capacity,
        'reserved_count', v_candidate.active_bookings,
        'status', v_status,
        'reason', v_reason
      )
    );
  end loop;

  return jsonb_build_object(
    'mode', case when p_execute then 'execute' else 'preview' end,
    'student_id', p_student_id,
    'membership_id', p_membership_id,
    'weekdays', v_weekdays,
    'start_time', left(p_start_time::text, 5),
    'total_found', jsonb_array_length(v_details),
    'created_count', v_created_count,
    'available_count', case when p_execute then v_created_count else v_available_count end,
    'already_booked_count', v_already_booked_count,
    'skipped_full_count', v_skipped_full_count,
    'skipped_out_of_validity_count', v_skipped_out_of_validity_count,
    'skipped_weekly_limit_count', v_skipped_weekly_limit_count,
    'skipped_no_permission_count', v_skipped_no_permission_count,
    'skipped_conflict_count', v_skipped_conflict_count,
    'skipped_other_count', v_skipped_other_count,
    'details', v_details
  );
end;
$$;

create or replace function public.admin_list_fixed_schedule_options_for_student(
  p_student_id uuid,
  p_membership_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_actor uuid := auth.uid();
  v_membership public.memberships%rowtype;
begin
  if v_actor is null or not coalesce(private.is_admin(), false) then
    raise exception 'Solo un admin activo puede ver horarios fijos.';
  end if;

  select *
  into v_membership
  from public.memberships m
  where m.id = p_membership_id
    and m.student_id = p_student_id;

  if not found then
    raise exception 'El programa no pertenece al alumno.';
  end if;

  return coalesce(
    (
      select jsonb_agg(
        jsonb_build_object(
          'start_time', item.start_time,
          'label', item.start_time || ' · ' || item.activity_names,
          'activity_names', item.activity_names,
          'sessions_count', item.sessions_count
        )
        order by item.start_time
      )
      from (
        select
          left(((s.starts_at at time zone 'America/Argentina/Buenos_Aires')::time)::text, 5) as start_time,
          string_agg(distinct a.name, ', ' order by a.name) as activity_names,
          count(*)::int as sessions_count
        from public.class_sessions s
        join public.activities a on a.id = s.activity_id
        join public.plan_activities pa on pa.activity_id = s.activity_id
        where pa.plan_id = v_membership.plan_id
          and s.starts_at::date between v_membership.start_date and v_membership.end_date
          and s.active = true
          and s.cancelled_at is null
        group by (s.starts_at at time zone 'America/Argentina/Buenos_Aires')::time
      ) item
    ),
    '[]'::jsonb
  );
end;
$$;

create or replace function public.admin_preview_fixed_schedule_for_student(
  p_student_id uuid,
  p_membership_id uuid,
  p_weekdays integer[],
  p_start_time time
)
returns jsonb
language sql
security definer
set search_path = public, private
as $$
  select private.admin_fixed_schedule_summary(
    p_student_id,
    p_membership_id,
    p_weekdays,
    p_start_time,
    false
  );
$$;

create or replace function public.admin_bulk_book_fixed_schedule_for_student(
  p_student_id uuid,
  p_membership_id uuid,
  p_weekdays integer[],
  p_start_time time
)
returns jsonb
language sql
security definer
set search_path = public, private
as $$
  select private.admin_fixed_schedule_summary(
    p_student_id,
    p_membership_id,
    p_weekdays,
    p_start_time,
    true
  );
$$;

revoke all on function private.admin_fixed_schedule_summary(uuid, uuid, integer[], time, boolean) from public, anon, authenticated;
revoke all on function public.admin_list_fixed_schedule_options_for_student(uuid, uuid) from public, anon;
revoke all on function public.admin_preview_fixed_schedule_for_student(uuid, uuid, integer[], time) from public, anon;
revoke all on function public.admin_bulk_book_fixed_schedule_for_student(uuid, uuid, integer[], time) from public, anon;

grant execute on function public.admin_list_fixed_schedule_options_for_student(uuid, uuid) to authenticated;
grant execute on function public.admin_preview_fixed_schedule_for_student(uuid, uuid, integer[], time) to authenticated;
grant execute on function public.admin_bulk_book_fixed_schedule_for_student(uuid, uuid, integer[], time) to authenticated;
