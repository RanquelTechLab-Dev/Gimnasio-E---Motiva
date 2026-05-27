-- RAN-31: make class edit unambiguous and prevent exact duplicated sessions.

create table if not exists public.class_recurring_rule_exceptions (
  id uuid primary key default gen_random_uuid(),
  recurring_rule_id uuid not null references public.class_recurring_rules(id) on delete cascade,
  occurrence_starts_at timestamptz not null,
  occurrence_ends_at timestamptz not null,
  action text not null check (action in ('edited', 'cancelled')),
  class_session_id uuid null references public.class_sessions(id) on delete set null,
  created_by uuid null references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint class_recurring_rule_exceptions_time_check check (
    occurrence_ends_at > occurrence_starts_at
  )
);

create unique index if not exists class_recurring_rule_exceptions_occurrence_idx
  on public.class_recurring_rule_exceptions (
    recurring_rule_id,
    occurrence_starts_at,
    occurrence_ends_at
  );

alter table public.class_recurring_rule_exceptions enable row level security;

drop policy if exists "Admins can read recurring rule exceptions"
  on public.class_recurring_rule_exceptions;

create policy "Admins can read recurring rule exceptions"
on public.class_recurring_rule_exceptions
for select
to authenticated
using (private.is_admin());

revoke all on table public.class_recurring_rule_exceptions from anon;

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
  v_title text;
begin
  if v_actor is null or not private.is_admin() then
    raise exception 'Solo un admin activo puede crear clases.';
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

  v_title := coalesce(nullif(btrim(coalesce(create_class_session.title, '')), ''), v_activity.name);

  if exists (
    select 1
    from public.class_sessions existing
    where existing.activity_id = create_class_session.activity_id
      and existing.starts_at = create_class_session.starts_at
      and existing.ends_at = create_class_session.ends_at
      and existing.active = true
      and existing.cancelled_at is null
  ) then
    raise exception 'Ya existe una clase de ese tipo en este horario.';
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
    v_title,
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
  v_history_count integer;
  v_actor uuid := auth.uid();
  v_title text;
  v_structural_change boolean;
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

  v_structural_change :=
    update_class_session.activity_id is distinct from v_session.activity_id or
    update_class_session.starts_at is distinct from v_session.starts_at or
    update_class_session.ends_at is distinct from v_session.ends_at;

  if v_history_count > 0 and v_structural_change then
    raise exception 'No se puede cambiar el tipo de una clase con reservas o asistencia. Podes cancelar esta clase y crear una nueva.';
  end if;

  select * into v_activity
  from public.activities a
  where a.id = update_class_session.activity_id
    and a.active = true;

  if not found then
    raise exception 'La actividad no existe o esta inactiva.';
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

  v_title := coalesce(nullif(btrim(coalesce(update_class_session.title, '')), ''), v_activity.name);

  if v_session.recurring_rule_id is not null and v_structural_change then
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

revoke all on function public.create_class_session(uuid, text, timestamptz, timestamptz, integer, text, text) from public, anon;
revoke all on function public.update_class_session(uuid, uuid, text, timestamptz, timestamptz, integer, text, text, boolean) from public, anon;
grant execute on function public.create_class_session(uuid, text, timestamptz, timestamptz, integer, text, text) to authenticated;
grant execute on function public.update_class_session(uuid, uuid, text, timestamptz, timestamptz, integer, text, text, boolean) to authenticated;

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
        where (
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
    returning id
  )
  select count(*) into v_inserted from inserted;

  return v_inserted;
end;
$$;

insert into public.class_recurring_rule_exceptions (
  recurring_rule_id,
  occurrence_starts_at,
  occurrence_ends_at,
  action,
  class_session_id,
  created_by
)
select
  cs.recurring_rule_id,
  cs.starts_at,
  cs.ends_at,
  'edited',
  cs.id,
  null
from public.class_sessions cs
join public.class_recurring_rules r on r.id = cs.recurring_rule_id
where cs.recurring_rule_id is not null
  and (
    cs.activity_id is distinct from r.activity_id
    or to_char(cs.starts_at at time zone 'America/Argentina/Buenos_Aires', 'HH24:MI:SS')::time is distinct from r.start_time
    or to_char(cs.ends_at at time zone 'America/Argentina/Buenos_Aires', 'HH24:MI:SS')::time is distinct from r.end_time
  )
on conflict (
  recurring_rule_id,
  occurrence_starts_at,
  occurrence_ends_at
)
do update set
  action = excluded.action,
  class_session_id = excluded.class_session_id;

with duplicate_rule_sessions as (
  select
    cs.id,
    row_number() over (
      partition by cs.recurring_rule_id, cs.starts_at, cs.ends_at
      order by
        case when cs.activity_id is distinct from r.activity_id then 0 else 1 end,
        cs.updated_at desc,
        cs.created_at asc
    ) as keep_rank
  from public.class_sessions cs
  join public.class_recurring_rules r on r.id = cs.recurring_rule_id
  where cs.recurring_rule_id is not null
),
safe_to_delete as (
  select drs.id
  from duplicate_rule_sessions drs
  where drs.keep_rank > 1
    and not exists (
      select 1
      from public.bookings b
      where b.session_id = drs.id
    )
    and not exists (
      select 1
      from public.attendance att
      join public.bookings b on b.id = att.booking_id
      where b.session_id = drs.id
    )
)
delete from public.class_sessions cs
using safe_to_delete std
where cs.id = std.id;

update public.class_sessions cs
set title = a.name,
    updated_at = now()
from public.activities a
where a.id = cs.activity_id
  and cs.title <> a.name
  and exists (
    select 1
    from public.activities old_activity
    where old_activity.name = cs.title
  )
  and not exists (
    select 1
    from public.bookings b
    where b.session_id = cs.id
  );

revoke all on function private.materialize_recurring_class_sessions(timestamptz, timestamptz) from public, anon, authenticated;
