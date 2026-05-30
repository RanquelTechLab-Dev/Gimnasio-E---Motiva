-- RAN-34 follow-up:
-- Make deleting a recurring class default to deleting the full recurring
-- schedule. The one-off action remains available only when the UI explicitly
-- sends p_scope = 'single' and is labelled "Cancelar solo esta fecha".

create or replace function public.admin_delete_class_session(
  p_session_id uuid,
  p_scope text default null
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
  v_requested_scope text := lower(nullif(btrim(coalesce(p_scope, '')), ''));
  v_scope text;
  v_deleted_sessions integer := 0;
  v_cancelled_sessions integer := 0;
  v_cancelled_at timestamptz := now();
begin
  v_actor := private.ensure_admin();

  select * into v_session
  from public.class_sessions s
  where s.id = p_session_id
  for update;

  if not found then
    raise exception 'La clase no existe.';
  end if;

  v_scope := coalesce(
    v_requested_scope,
    case
      when v_session.recurring_rule_id is not null then 'series'
      else 'single'
    end
  );

  if v_scope not in ('single', 'series') then
    raise exception 'El alcance de eliminacion no es valido.';
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
        and s.starts_at >= v_cancelled_at
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
        'cancelled_future_sessions_with_history', v_cancelled_sessions,
        'defaulted_scope', v_requested_scope is null
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
