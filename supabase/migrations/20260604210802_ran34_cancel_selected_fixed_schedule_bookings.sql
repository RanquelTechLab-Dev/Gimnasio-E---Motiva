-- RAN-34: cancel selected fixed-schedule bookings from Admin -> Alumnos.
--
-- Safety:
-- - No bookings are deleted.
-- - No payments, students/profiles, memberships, attendance or files are touched.
-- - Only selected bookings with status booked are updated to cancelled.

create or replace function public.admin_cancel_fixed_schedule_selected_bookings(
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
  v_cancelled_ids uuid[];
  v_cancelled_count integer := 0;
  v_details jsonb := '[]'::jsonb;
begin
  if v_actor is null or not coalesce(private.is_admin(), false) then
    raise exception 'Solo un admin activo puede cancelar reservas fijas.';
  end if;

  if v_reason is null then
    raise exception 'El motivo de cancelacion es obligatorio.';
  end if;

  select coalesce(array_agg(distinct booking_id), array[]::uuid[])
  into v_requested_ids
  from unnest(coalesce(p_booking_ids, array[]::uuid[])) as input_ids(booking_id)
  where booking_id is not null;

  v_requested_count := coalesce(array_length(v_requested_ids, 1), 0);

  if v_requested_count = 0 then
    raise exception 'Selecciona al menos una reserva para cancelar.';
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
      cs.starts_at
    from requested r
    left join public.bookings b on b.id = r.booking_id
    left join public.class_sessions cs on cs.id = b.session_id
  ),
  eligible as (
    select c.booking_id
    from candidates c
    where c.booking_id is not null
      and c.booking_status = 'booked'::public.booking_status
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
    where b.id in (select booking_id from eligible)
    returning b.id
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
      u.id is not null as cancelled,
      case
        when c.booking_id is null then 'not_found'
        when c.booking_status = 'cancelled'::public.booking_status then 'already_cancelled'
        when c.booking_status <> 'booked'::public.booking_status then 'not_active'
        when u.id is not null then null
        else 'not_cancelled'
      end as skipped_reason
    from candidates c
    left join updated u on u.id = c.booking_id
  )
  select
    coalesce(array_agg(requested_booking_id) filter (where cancelled), array[]::uuid[]),
    count(*) filter (where cancelled)::integer,
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
          'cancelled', cancelled,
          'skipped_reason', skipped_reason
        )
        order by starts_at nulls last, requested_booking_id
      ),
      '[]'::jsonb
    )
  into v_cancelled_ids, v_cancelled_count, v_details
  from detail_rows;

  insert into public.audit_logs (actor_id, entity_type, entity_id, action, metadata)
  values (
    v_actor,
    'booking',
    coalesce(v_cancelled_ids[1], v_requested_ids[1]),
    'fixed_schedule.selected_bookings_cancelled_by_admin',
    jsonb_build_object(
      'reason', v_reason,
      'requested_count', v_requested_count,
      'cancelled_count', v_cancelled_count,
      'skipped_count', v_requested_count - v_cancelled_count,
      'requested_booking_ids', to_jsonb(v_requested_ids),
      'cancelled_booking_ids', to_jsonb(v_cancelled_ids),
      'details', v_details,
      'does_not_delete_bookings', true
    )
  );

  return jsonb_build_object(
    'requested_count', v_requested_count,
    'cancelled_count', v_cancelled_count,
    'skipped_count', v_requested_count - v_cancelled_count,
    'details', v_details,
    'does_not_delete_bookings', true
  );
end;
$$;

revoke all on function public.admin_cancel_fixed_schedule_selected_bookings(uuid[], text)
  from public, anon;

grant execute on function public.admin_cancel_fixed_schedule_selected_bookings(uuid[], text)
  to authenticated;
