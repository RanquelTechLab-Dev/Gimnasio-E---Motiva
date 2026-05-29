create or replace function public.admin_delete_class_session(p_session_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_actor uuid;
  v_session public.class_sessions%rowtype;
  v_bookings integer;
  v_attendance integer;
  v_exception_updates integer := 0;
begin
  v_actor := private.ensure_admin();

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

  if v_bookings + v_attendance > 0 then
    raise exception 'Esta clase tiene historial. No se puede eliminar; podes cancelarla.';
  end if;

  if v_session.recurring_rule_id is not null then
    update public.class_recurring_rule_exceptions cre
    set
      action = 'cancelled',
      class_session_id = null,
      created_by = v_actor
    where cre.class_session_id = p_session_id;

    get diagnostics v_exception_updates = row_count;

    if v_exception_updates = 0 then
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
  end if;

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
      'recurring_exception_action',
        case when v_session.recurring_rule_id is null then null else 'cancelled' end
    )
  );

  return jsonb_build_object(
    'action',
    'deleted',
    'session_id',
    p_session_id,
    'recurring_exception',
    v_session.recurring_rule_id is not null
  );
end;
$$;

revoke all on function public.admin_delete_class_session(uuid) from public, anon;
grant execute on function public.admin_delete_class_session(uuid) to authenticated;
