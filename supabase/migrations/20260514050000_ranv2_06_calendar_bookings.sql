-- RANV2-06: calendar, class sessions, bookings, capacity and credit rules.

alter table public.class_sessions
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancelled_by uuid references public.profiles(id) on delete set null,
  add column if not exists cancel_reason text;

alter table public.bookings
  add column if not exists membership_id uuid references public.memberships(id) on delete set null,
  add column if not exists credits_charged integer not null default 0 check (credits_charged >= 0),
  add column if not exists credit_returned_at timestamptz,
  add column if not exists cancelled_by uuid references public.profiles(id) on delete set null;

alter table public.bookings
  drop constraint if exists bookings_session_id_student_id_key;

create unique index if not exists bookings_active_session_student_idx
on public.bookings (session_id, student_id)
where status = 'booked';

create index if not exists class_sessions_active_starts_at_idx on public.class_sessions (active, starts_at);
create index if not exists class_sessions_cancelled_at_idx on public.class_sessions (cancelled_at);
create index if not exists bookings_session_status_idx on public.bookings (session_id, status);
create index if not exists bookings_student_status_idx on public.bookings (student_id, status);
create index if not exists bookings_membership_id_idx on public.bookings (membership_id);

create or replace function public.create_class_session(
  activity_id uuid,
  title text,
  starts_at timestamptz,
  ends_at timestamptz,
  capacity integer,
  coach_name text default null,
  notes text default null
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
begin
  if v_actor is null or not private.is_admin() then
    raise exception 'Solo un admin activo puede crear clases.';
  end if;

  if btrim(coalesce(title, '')) = '' then
    raise exception 'El titulo de la clase es obligatorio.';
  end if;

  if starts_at is null or ends_at is null or ends_at <= starts_at then
    raise exception 'El horario de la clase no es valido.';
  end if;

  if capacity is null or capacity <= 0 then
    raise exception 'El cupo debe ser mayor a cero.';
  end if;

  select * into v_activity
  from public.activities a
  where a.id = create_class_session.activity_id
    and a.active = true;

  if not found then
    raise exception 'La actividad no existe o esta inactiva.';
  end if;

  insert into public.class_sessions (
    activity_id,
    title,
    starts_at,
    ends_at,
    capacity,
    trainer_name,
    notes,
    active
  )
  values (
    create_class_session.activity_id,
    btrim(create_class_session.title),
    create_class_session.starts_at,
    create_class_session.ends_at,
    create_class_session.capacity,
    nullif(btrim(coalesce(create_class_session.coach_name, '')), ''),
    nullif(btrim(coalesce(create_class_session.notes, '')), ''),
    true
  )
  returning * into v_session;

  insert into public.audit_logs (actor_id, entity_type, entity_id, action, metadata)
  values (
    v_actor,
    'class_session',
    v_session.id,
    'class.created',
    jsonb_build_object(
      'activity_id', v_session.activity_id,
      'starts_at', v_session.starts_at,
      'ends_at', v_session.ends_at,
      'capacity', v_session.capacity
    )
  );

  return jsonb_build_object(
    'session_id', v_session.id,
    'activity_id', v_session.activity_id,
    'starts_at', v_session.starts_at,
    'ends_at', v_session.ends_at,
    'capacity', v_session.capacity
  );
end;
$$;

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
  v_active_bookings integer;
  v_actor uuid := auth.uid();
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

  if btrim(coalesce(title, '')) = '' then
    raise exception 'El titulo de la clase es obligatorio.';
  end if;

  if starts_at is null or ends_at is null or ends_at <= starts_at then
    raise exception 'El horario de la clase no es valido.';
  end if;

  if capacity is null or capacity <= 0 then
    raise exception 'El cupo debe ser mayor a cero.';
  end if;

  select count(*) into v_active_bookings
  from public.bookings b
  where b.session_id = update_class_session.session_id
    and b.status = 'booked';

  if capacity < v_active_bookings then
    raise exception 'El cupo no puede ser menor a las reservas activas (%).', v_active_bookings;
  end if;

  if v_active_bookings > 0 and (
    update_class_session.activity_id is distinct from v_session.activity_id or
    update_class_session.starts_at is distinct from v_session.starts_at or
    update_class_session.ends_at is distinct from v_session.ends_at
  ) then
    raise exception 'No se puede cambiar actividad ni horario de una clase con reservas activas. Cancela la clase o crea una nueva.';
  end if;

  select * into v_activity
  from public.activities a
  where a.id = update_class_session.activity_id
    and a.active = true;

  if not found then
    raise exception 'La actividad no existe o esta inactiva.';
  end if;

  update public.class_sessions
  set
    activity_id = update_class_session.activity_id,
    title = btrim(update_class_session.title),
    starts_at = update_class_session.starts_at,
    ends_at = update_class_session.ends_at,
    capacity = update_class_session.capacity,
    trainer_name = nullif(btrim(coalesce(update_class_session.coach_name, '')), ''),
    notes = nullif(btrim(coalesce(update_class_session.notes, '')), ''),
    active = update_class_session.active,
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
      'activity_id', v_session.activity_id,
      'starts_at', v_session.starts_at,
      'ends_at', v_session.ends_at,
      'capacity', v_session.capacity,
      'active', v_session.active
    )
  );

  return jsonb_build_object(
    'session_id', v_session.id,
    'activity_id', v_session.activity_id,
    'starts_at', v_session.starts_at,
    'ends_at', v_session.ends_at,
    'capacity', v_session.capacity,
    'active', v_session.active
  );
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
  v_cancelled_count integer;
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

  update public.bookings
  set
    status = 'cancelled',
    cancelled_at = now(),
    cancelled_by = v_actor,
    cancel_reason = nullif(btrim(coalesce(cancel_class_session.reason, '')), ''),
    credit_returned_at = case
      when credits_charged > 0 and credit_returned_at is null then now()
      else credit_returned_at
    end,
    updated_at = now()
  where session_id = cancel_class_session.session_id
    and status = 'booked';

  get diagnostics v_cancelled_count = row_count;

  update public.class_sessions
  set
    active = false,
    cancelled_at = now(),
    cancelled_by = v_actor,
    cancel_reason = nullif(btrim(coalesce(cancel_class_session.reason, '')), ''),
    updated_at = now()
  where id = cancel_class_session.session_id
  returning * into v_session;

  insert into public.audit_logs (actor_id, entity_type, entity_id, action, metadata)
  values (
    v_actor,
    'class_session',
    v_session.id,
    'class.cancelled',
    jsonb_build_object(
      'reason', nullif(btrim(coalesce(cancel_class_session.reason, '')), ''),
      'cancelled_bookings', v_cancelled_count
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
      'credits_charged', b.credits_charged,
      'credit_returned', b.credit_returned_at is not null,
      'reason', nullif(btrim(coalesce(cancel_class_session.reason, '')), ''),
      'source', 'class.cancelled'
    )
  from public.bookings b
  where b.session_id = cancel_class_session.session_id
    and b.cancelled_by = v_actor
    and b.cancelled_at >= now() - interval '5 seconds';

  return jsonb_build_object(
    'session_id', v_session.id,
    'cancelled_bookings', v_cancelled_count
  );
end;
$$;

create or replace function public.book_class_session(session_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_actor uuid := auth.uid();
  v_profile public.profiles%rowtype;
  v_session public.class_sessions%rowtype;
  v_activity public.activities%rowtype;
  v_membership public.memberships%rowtype;
  v_active_bookings integer;
  v_booking public.bookings%rowtype;
  v_credits_charged integer := 0;
begin
  if v_actor is null then
    raise exception 'Se requiere sesion activa.';
  end if;

  select * into v_profile
  from public.profiles p
  where p.id = v_actor
    and p.active = true;

  if not found then
    raise exception 'El perfil no existe o esta inactivo.';
  end if;

  select * into v_session
  from public.class_sessions s
  where s.id = book_class_session.session_id
  for update;

  if not found then
    raise exception 'La clase no existe.';
  end if;

  if v_session.active is not true or v_session.cancelled_at is not null then
    raise exception 'La clase no esta activa.';
  end if;

  if v_session.starts_at <= now() then
    raise exception 'No se puede reservar una clase que ya comenzo.';
  end if;

  select * into v_activity
  from public.activities a
  where a.id = v_session.activity_id
    and a.active = true;

  if not found then
    raise exception 'La actividad no esta disponible.';
  end if;

  if exists (
    select 1
    from public.bookings b
    where b.session_id = v_session.id
      and b.student_id = v_actor
      and b.status = 'booked'
  ) then
    raise exception 'El alumno ya tiene una reserva activa para esta clase.';
  end if;

  select count(*) into v_active_bookings
  from public.bookings b
  where b.session_id = v_session.id
    and b.status = 'booked';

  if v_active_bookings >= v_session.capacity then
    raise exception 'No hay cupos disponibles para esta clase.';
  end if;

  select m.* into v_membership
  from public.memberships m
  join public.plan_activities pa on pa.plan_id = m.plan_id
  where m.student_id = v_actor
    and m.status = 'active'
    and v_session.starts_at::date between m.start_date and m.end_date
    and pa.activity_id = v_session.activity_id
    and (m.remaining_credits is null or m.remaining_credits > 0)
  order by m.end_date asc, m.created_at asc
  limit 1
  for update of m;

  if not found then
    raise exception 'No hay membresia activa con plan, fecha y creditos disponibles para esta actividad.';
  end if;

  if v_membership.remaining_credits is not null then
    update public.memberships
    set
      remaining_credits = remaining_credits - 1,
      updated_at = now()
    where id = v_membership.id
    returning * into v_membership;
    v_credits_charged := 1;
  end if;

  insert into public.bookings (
    session_id,
    student_id,
    membership_id,
    status,
    credits_charged
  )
  values (
    v_session.id,
    v_actor,
    v_membership.id,
    'booked',
    v_credits_charged
  )
  returning * into v_booking;

  insert into public.audit_logs (actor_id, entity_type, entity_id, action, metadata)
  values (
    v_actor,
    'booking',
    v_booking.id,
    'booking.created',
    jsonb_build_object(
      'session_id', v_booking.session_id,
      'student_id', v_booking.student_id,
      'membership_id', v_booking.membership_id,
      'credits_charged', v_booking.credits_charged
    )
  );

  return jsonb_build_object(
    'booking_id', v_booking.id,
    'session_id', v_booking.session_id,
    'student_id', v_booking.student_id,
    'membership_id', v_booking.membership_id,
    'credits_charged', v_booking.credits_charged,
    'status', v_booking.status
  );
end;
$$;

create or replace function public.cancel_booking(
  booking_id uuid,
  reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_actor uuid := auth.uid();
  v_is_admin boolean;
  v_booking public.bookings%rowtype;
  v_session public.class_sessions%rowtype;
  v_activity public.activities%rowtype;
  v_should_return_credit boolean := false;
  v_late_24h boolean := false;
begin
  if v_actor is null then
    raise exception 'Se requiere sesion activa.';
  end if;

  v_is_admin := private.is_admin();

  select * into v_booking
  from public.bookings b
  where b.id = cancel_booking.booking_id
  for update;

  if not found then
    raise exception 'La reserva no existe.';
  end if;

  if not v_is_admin and v_booking.student_id <> v_actor then
    raise exception 'No se puede cancelar una reserva de otro alumno.';
  end if;

  if v_booking.status <> 'booked' then
    raise exception 'La reserva no esta activa.';
  end if;

  select * into v_session
  from public.class_sessions s
  where s.id = v_booking.session_id;

  select * into v_activity
  from public.activities a
  where a.id = v_session.activity_id;

  if v_activity.requires_24h_cancel then
    v_late_24h := now() > (v_session.starts_at - interval '24 hours');
    v_should_return_credit := not v_late_24h;
  else
    if not v_is_admin and now() >= v_session.starts_at then
      raise exception 'No se puede cancelar una clase que ya comenzo.';
    end if;
    v_should_return_credit := now() < v_session.starts_at;
  end if;

  if v_should_return_credit
    and v_booking.credits_charged > 0
    and v_booking.credit_returned_at is null
    and v_booking.membership_id is not null then
    update public.memberships
    set
      remaining_credits = remaining_credits + v_booking.credits_charged,
      updated_at = now()
    where id = v_booking.membership_id
      and remaining_credits is not null;
  end if;

  update public.bookings
  set
    status = 'cancelled',
    cancelled_at = now(),
    cancelled_by = v_actor,
    cancel_reason = nullif(btrim(coalesce(cancel_booking.reason, '')), ''),
    charged_as_attended = case
      when v_activity.requires_24h_cancel and v_late_24h then true
      else charged_as_attended
    end,
    credit_returned_at = case
      when v_should_return_credit and credits_charged > 0 and credit_returned_at is null then now()
      else credit_returned_at
    end,
    updated_at = now()
  where id = v_booking.id
  returning * into v_booking;

  insert into public.audit_logs (actor_id, entity_type, entity_id, action, metadata)
  values (
    v_actor,
    'booking',
    v_booking.id,
    'booking.cancelled',
    jsonb_build_object(
      'session_id', v_booking.session_id,
      'student_id', v_booking.student_id,
      'membership_id', v_booking.membership_id,
      'credits_charged', v_booking.credits_charged,
      'credit_returned', v_booking.credit_returned_at is not null,
      'charged_as_attended', v_booking.charged_as_attended,
      'reason', nullif(btrim(coalesce(cancel_booking.reason, '')), '')
    )
  );

  return jsonb_build_object(
    'booking_id', v_booking.id,
    'status', v_booking.status,
    'credit_returned', v_booking.credit_returned_at is not null,
    'charged_as_attended', v_booking.charged_as_attended
  );
end;
$$;

create or replace function public.list_calendar_sessions(
  from_date timestamptz,
  to_date timestamptz
)
returns table (
  session_id uuid,
  activity_id uuid,
  activity_name text,
  activity_slug text,
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
  block_reason text
)
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_actor uuid := auth.uid();
  v_is_admin boolean;
begin
  if v_actor is null then
    raise exception 'Se requiere sesion activa.';
  end if;

  if from_date is null or to_date is null or to_date <= from_date then
    raise exception 'El rango de fechas no es valido.';
  end if;

  v_is_admin := private.is_admin();

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
      exists (
        select 1
        from public.memberships m
        join public.plan_activities pa on pa.plan_id = m.plan_id
        where m.student_id = v_actor
          and m.status = 'active'
          and s.starts_at::date between m.start_date and m.end_date
          and pa.activity_id = s.activity_id
          and (m.remaining_credits is null or m.remaining_credits > 0)
      ) as has_eligible_membership
    from public.class_sessions s
    join public.activities a on a.id = s.activity_id
    where s.starts_at >= list_calendar_sessions.from_date
      and s.starts_at < list_calendar_sessions.to_date
      and (v_is_admin or (s.active = true and s.cancelled_at is null))
  )
  select
    sr.id,
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
      when sr.has_eligible_membership is not true then 'Tu membresia no permite esta clase o no tiene creditos'
      else null
    end as block_reason
  from session_rows sr
  order by sr.starts_at asc;
end;
$$;

create or replace function public.list_my_bookings()
returns table (
  booking_id uuid,
  session_id uuid,
  activity_name text,
  activity_slug text,
  title text,
  starts_at timestamptz,
  ends_at timestamptz,
  booking_status public.booking_status,
  booked_at timestamptz,
  cancelled_at timestamptz,
  cancel_reason text,
  charged_as_attended boolean,
  credits_charged integer,
  credit_returned_at timestamptz,
  can_cancel boolean,
  cancel_block_reason text
)
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_actor uuid := auth.uid();
begin
  if v_actor is null then
    raise exception 'Se requiere sesion activa.';
  end if;

  return query
  select
    b.id,
    s.id,
    a.name,
    a.slug,
    s.title,
    s.starts_at,
    s.ends_at,
    b.status,
    b.booked_at,
    b.cancelled_at,
    b.cancel_reason,
    b.charged_as_attended,
    b.credits_charged,
    b.credit_returned_at,
    case
      when b.status <> 'booked' then false
      when a.requires_24h_cancel then true
      when now() < s.starts_at then true
      else false
    end as can_cancel,
    case
      when b.status <> 'booked' then 'La reserva ya no esta activa'
      when a.requires_24h_cancel then null
      when now() < s.starts_at then null
      else 'La clase ya comenzo'
    end as cancel_block_reason
  from public.bookings b
  join public.class_sessions s on s.id = b.session_id
  join public.activities a on a.id = s.activity_id
  where b.student_id = v_actor
  order by s.starts_at desc;
end;
$$;

revoke all on function public.create_class_session(uuid, text, timestamptz, timestamptz, integer, text, text) from public, anon;
revoke all on function public.update_class_session(uuid, uuid, text, timestamptz, timestamptz, integer, text, text, boolean) from public, anon;
revoke all on function public.cancel_class_session(uuid, text) from public, anon;
revoke all on function public.book_class_session(uuid) from public, anon;
revoke all on function public.cancel_booking(uuid, text) from public, anon;
revoke all on function public.list_calendar_sessions(timestamptz, timestamptz) from public, anon;
revoke all on function public.list_my_bookings() from public, anon;

grant execute on function public.create_class_session(uuid, text, timestamptz, timestamptz, integer, text, text) to authenticated;
grant execute on function public.update_class_session(uuid, uuid, text, timestamptz, timestamptz, integer, text, text, boolean) to authenticated;
grant execute on function public.cancel_class_session(uuid, text) to authenticated;
grant execute on function public.book_class_session(uuid) to authenticated;
grant execute on function public.cancel_booking(uuid, text) to authenticated;
grant execute on function public.list_calendar_sessions(timestamptz, timestamptz) to authenticated;
grant execute on function public.list_my_bookings() to authenticated;
