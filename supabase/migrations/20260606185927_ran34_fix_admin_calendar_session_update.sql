create or replace function public.update_class_session(
  session_id uuid,
  activity_id uuid,
  title text,
  starts_at timestamptz,
  ends_at timestamptz,
  capacity integer,
  coach_name text default null,
  notes text default null,
  active boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_session public.class_sessions%rowtype;
  v_activity public.activities%rowtype;
  v_actor uuid := auth.uid();
  v_title text;
  v_activity_changed boolean;
  v_time_changed boolean;
  v_capacity_changed boolean;
  v_consuming_bookings integer;
  v_history_count integer;
  v_finalized_count integer;
  v_previous jsonb;
begin
  if v_actor is null or not private.is_admin() then
    raise exception 'Solo un admin activo puede editar clases.';
  end if;

  select * into v_session
  from public.class_sessions s
  where s.id = update_class_session.session_id
  for update;

  if not found then
    raise exception 'La clase no existe.';
  end if;

  if v_session.cancelled_at is not null then
    raise exception 'No se puede editar una clase cancelada.';
  end if;

  if update_class_session.starts_at is null
    or update_class_session.ends_at is null
    or update_class_session.ends_at <= update_class_session.starts_at then
    raise exception 'El horario de la clase no es valido.';
  end if;

  if update_class_session.capacity is null or update_class_session.capacity <= 0 then
    raise exception 'El cupo debe ser mayor a cero.';
  end if;

  select * into v_activity
  from public.activities a
  where a.id = update_class_session.activity_id
    and a.active = true;

  if not found then
    raise exception 'La actividad no existe o esta inactiva.';
  end if;

  select count(*) into v_consuming_bookings
  from public.bookings b
  where b.session_id = update_class_session.session_id
    and b.status in ('booked', 'attended', 'no_show');

  if update_class_session.capacity < v_consuming_bookings then
    raise exception 'El cupo no puede ser menor a las reservas existentes (%).', v_consuming_bookings;
  end if;

  select count(*) into v_history_count
  from public.bookings b
  where b.session_id = update_class_session.session_id
    and (
      b.status in ('booked', 'attended', 'no_show')
      or exists (
        select 1
        from public.attendance att
        where att.booking_id = b.id
      )
    );

  select count(*) into v_finalized_count
  from public.bookings b
  where b.session_id = update_class_session.session_id
    and (
      b.status in ('attended', 'no_show')
      or exists (
        select 1
        from public.attendance att
        where att.booking_id = b.id
      )
    );

  v_activity_changed :=
    update_class_session.activity_id is distinct from v_session.activity_id;
  v_time_changed :=
    update_class_session.starts_at is distinct from v_session.starts_at
    or update_class_session.ends_at is distinct from v_session.ends_at;
  v_capacity_changed :=
    update_class_session.capacity is distinct from v_session.capacity;

  if v_activity_changed and v_history_count > 0 then
    raise exception 'No se puede cambiar la actividad de una clase con reservas o asistencia. Podes ajustar horario y cupo, o cancelar esta clase y crear una nueva.';
  end if;

  if v_time_changed and v_finalized_count > 0 then
    raise exception 'No se puede cambiar el horario de una clase con asistencia o ausentes ya cargados.';
  end if;

  if v_time_changed
    and v_consuming_bookings > 0
    and update_class_session.ends_at <= now() then
    raise exception 'No se puede mover una clase con reservas a un horario ya finalizado.';
  end if;

  if coalesce(update_class_session.active, true) and exists (
    select 1
    from public.class_sessions existing
    where existing.id <> update_class_session.session_id
      and existing.activity_id = update_class_session.activity_id
      and existing.starts_at = update_class_session.starts_at
      and existing.ends_at = update_class_session.ends_at
      and existing.active = true
      and existing.cancelled_at is null
  ) then
    raise exception 'Ya existe una clase de ese tipo en este horario.';
  end if;

  v_title := coalesce(
    nullif(btrim(coalesce(update_class_session.title, '')), ''),
    v_activity.name
  );

  v_previous := jsonb_build_object(
    'activity_id', v_session.activity_id,
    'title', v_session.title,
    'starts_at', v_session.starts_at,
    'ends_at', v_session.ends_at,
    'capacity', v_session.capacity,
    'active', v_session.active
  );

  if v_session.recurring_rule_id is not null
    and (v_activity_changed or v_time_changed) then
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
      'edited',
      v_session.id,
      v_actor
    )
    on conflict (
      recurring_rule_id,
      occurrence_starts_at,
      occurrence_ends_at
    )
    do update set
      action = excluded.action,
      class_session_id = excluded.class_session_id,
      created_by = excluded.created_by;
  end if;

  update public.class_sessions
  set
    activity_id = update_class_session.activity_id,
    title = v_title,
    starts_at = update_class_session.starts_at,
    ends_at = update_class_session.ends_at,
    capacity = update_class_session.capacity,
    trainer_name = nullif(btrim(coalesce(update_class_session.coach_name, '')), ''),
    notes = nullif(btrim(coalesce(update_class_session.notes, '')), ''),
    active = coalesce(update_class_session.active, true),
    updated_at = now()
  where id = update_class_session.session_id
  returning * into v_session;

  insert into public.audit_logs (actor_id, entity_type, entity_id, action, metadata)
  values (
    v_actor,
    'class_session',
    v_session.id,
    'class.updated',
    jsonb_build_object(
      'previous', v_previous,
      'current', jsonb_build_object(
        'activity_id', v_session.activity_id,
        'title', v_session.title,
        'starts_at', v_session.starts_at,
        'ends_at', v_session.ends_at,
        'capacity', v_session.capacity,
        'active', v_session.active
      ),
      'consuming_bookings', v_consuming_bookings,
      'activity_changed', v_activity_changed,
      'time_changed', v_time_changed,
      'capacity_changed', v_capacity_changed
    )
  );

  return jsonb_build_object(
    'session_id', v_session.id,
    'activity_id', v_session.activity_id,
    'starts_at', v_session.starts_at,
    'ends_at', v_session.ends_at,
    'capacity', v_session.capacity,
    'active', v_session.active,
    'consuming_bookings', v_consuming_bookings
  );
end;
$$;

revoke all on function public.update_class_session(
  uuid,
  uuid,
  text,
  timestamptz,
  timestamptz,
  integer,
  text,
  text,
  boolean
) from public, anon;

grant execute on function public.update_class_session(
  uuid,
  uuid,
  text,
  timestamptz,
  timestamptz,
  integer,
  text,
  text,
  boolean
) to authenticated;
