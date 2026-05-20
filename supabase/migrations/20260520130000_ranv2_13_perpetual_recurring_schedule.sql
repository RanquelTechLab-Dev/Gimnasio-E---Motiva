-- RANV2-13 perpetual recurring schedule rules.
-- Adds indefinite weekly class rules and materializes concrete class_sessions
-- only for the requested calendar range. Existing sessions, bookings,
-- attendance and weekly/package booking logic remain untouched.

create table if not exists public.class_recurring_rules (
  id uuid primary key default gen_random_uuid(),
  activity_id uuid not null references public.activities(id),
  title text not null,
  weekday int not null check (weekday between 0 and 6),
  start_time time not null,
  end_time time not null,
  capacity int not null check (capacity > 0),
  trainer_name text,
  notes text,
  active boolean not null default true,
  valid_from date not null,
  valid_until date,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint class_recurring_rules_time_check check (end_time > start_time),
  constraint class_recurring_rules_valid_range_check check (
    valid_until is null or valid_until >= valid_from
  )
);

alter table public.class_recurring_rules
  add column if not exists activity_id uuid,
  add column if not exists title text,
  add column if not exists weekday int,
  add column if not exists start_time time,
  add column if not exists end_time time,
  add column if not exists capacity int,
  add column if not exists trainer_name text,
  add column if not exists notes text,
  add column if not exists active boolean not null default true,
  add column if not exists valid_from date,
  add column if not exists valid_until date,
  add column if not exists created_by uuid,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

alter table public.class_sessions
  add column if not exists recurring_rule_id uuid references public.class_recurring_rules(id);

create index if not exists class_recurring_rules_active_range_idx
  on public.class_recurring_rules (active, weekday, valid_from, valid_until);

create index if not exists class_sessions_recurring_rule_id_idx
  on public.class_sessions (recurring_rule_id);

create unique index if not exists class_recurring_rules_active_exact_idx
  on public.class_recurring_rules (
    activity_id,
    weekday,
    start_time,
    end_time,
    valid_from,
    coalesce(valid_until, date '9999-12-31')
  )
  where active = true;

alter table public.class_recurring_rules enable row level security;

drop policy if exists "Admins can read recurring rules" on public.class_recurring_rules;
create policy "Admins can read recurring rules"
on public.class_recurring_rules
for select
to authenticated
using (private.is_admin());

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
        from public.class_sessions existing
        where existing.activity_id = ro.activity_id
          and existing.starts_at = ro.starts_at
          and existing.ends_at = ro.ends_at
      )
    returning id
  )
  select count(*) into v_inserted from inserted;

  return v_inserted;
end;
$$;

create or replace function public.materialize_recurring_class_sessions(
  from_date timestamptz,
  to_date timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_actor uuid := auth.uid();
  v_inserted integer := 0;
begin
  if v_actor is null then
    raise exception 'Se requiere sesion activa.';
  end if;

  if not exists (
    select 1
    from public.profiles p
    where p.id = v_actor
      and p.active = true
  ) then
    raise exception 'El perfil no existe o esta inactivo.';
  end if;

  v_inserted := private.materialize_recurring_class_sessions(from_date, to_date);

  return jsonb_build_object('created_sessions', v_inserted);
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
  p_valid_from date default current_date,
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

  if p_capacity is null or p_capacity <= 0 then
    raise exception 'El cupo debe ser mayor a cero.';
  end if;

  if v_activity.max_capacity is not null and p_capacity > v_activity.max_capacity then
    raise exception 'El tipo de clase permite maximo % alumno(s).', v_activity.max_capacity;
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
    coalesce(p_valid_from, current_date),
    p_valid_until,
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
  do update set
    title = excluded.title,
    capacity = excluded.capacity,
    trainer_name = excluded.trainer_name,
    notes = excluded.notes,
    updated_at = now()
  returning * into v_rule;

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

  return jsonb_build_object('action', 'created', 'rule_id', v_rule.id);
end;
$$;

create or replace function public.admin_archive_class_recurring_rule(p_rule_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_actor uuid := auth.uid();
  v_rule public.class_recurring_rules%rowtype;
begin
  if v_actor is null or not private.is_admin() then
    raise exception 'Solo un admin activo puede pausar horarios recurrentes.';
  end if;

  update public.class_recurring_rules r
  set active = false,
      updated_at = now()
  where r.id = p_rule_id
  returning * into v_rule;

  if not found then
    raise exception 'La regla recurrente no existe.';
  end if;

  insert into public.audit_logs (actor_id, entity_type, entity_id, action, metadata)
  values (
    v_actor,
    'class_recurring_rule',
    v_rule.id,
    'class_recurring_rule.archived',
    jsonb_build_object('activity_id', v_rule.activity_id)
  );

  return jsonb_build_object('action', 'archived', 'rule_id', v_rule.id);
end;
$$;

create or replace function public.admin_list_class_recurring_rules()
returns table (
  rule_id uuid,
  activity_id uuid,
  activity_name text,
  activity_slug text,
  title text,
  weekday int,
  start_time time,
  end_time time,
  capacity int,
  trainer_name text,
  notes text,
  active boolean,
  valid_from date,
  valid_until date
)
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if auth.uid() is null or not private.is_admin() then
    raise exception 'Solo un admin activo puede listar horarios recurrentes.';
  end if;

  return query
  select
    r.id,
    r.activity_id,
    a.name,
    a.slug,
    r.title,
    r.weekday,
    r.start_time,
    r.end_time,
    r.capacity,
    r.trainer_name,
    r.notes,
    r.active,
    r.valid_from,
    r.valid_until
  from public.class_recurring_rules r
  join public.activities a on a.id = r.activity_id
  order by r.active desc, r.weekday asc, r.start_time asc, a.name asc;
end;
$$;

with source_rules(activity_slug, title, weekday, start_time, end_time, capacity, notes) as (
  values
    ('funcional', 'Funcional', 1, time '07:00', time '08:00', 10, 'Horario funcional inicial para el combo Semipersonalizado y Funcional.'),
    ('funcional', 'Funcional', 3, time '07:00', time '08:00', 10, 'Horario funcional inicial para el combo Semipersonalizado y Funcional.'),
    ('funcional', 'Funcional', 5, time '07:00', time '08:00', 10, 'Horario funcional inicial para el combo Semipersonalizado y Funcional.'),
    ('funcional', 'Funcional', 1, time '19:00', time '20:00', 10, 'Horario funcional inicial para el combo Semipersonalizado y Funcional.'),
    ('funcional', 'Funcional', 3, time '19:00', time '20:00', 10, 'Horario funcional inicial para el combo Semipersonalizado y Funcional.'),
    ('funcional', 'Funcional', 5, time '19:00', time '20:00', 10, 'Horario funcional inicial para el combo Semipersonalizado y Funcional.'),
    ('neurofuncional', 'Neurofuncional', 1, time '07:00', time '08:00', 10, 'Cronograma semanal fuente.'),
    ('neurofuncional', 'Neurofuncional', 3, time '07:00', time '08:00', 10, 'Cronograma semanal fuente.'),
    ('neurofuncional', 'Neurofuncional', 5, time '07:00', time '08:00', 10, 'Cronograma semanal fuente.'),
    ('neurofuncional', 'Neurofuncional', 1, time '19:00', time '20:00', 10, 'Cronograma semanal fuente.'),
    ('neurofuncional', 'Neurofuncional', 3, time '19:00', time '20:00', 10, 'Cronograma semanal fuente.'),
    ('neurofuncional', 'Neurofuncional', 5, time '19:00', time '20:00', 10, 'Cronograma semanal fuente.'),
    ('ninos', 'Programa Kids', 1, time '17:00', time '18:00', 10, 'Cronograma semanal fuente.'),
    ('ninos', 'Programa Kids', 3, time '17:00', time '18:00', 10, 'Cronograma semanal fuente.'),
    ('ninos', 'Programa Kids', 5, time '17:00', time '18:00', 10, 'Cronograma semanal fuente.'),
    ('plan_entrenamiento', 'Plan de entrenamiento', 1, time '08:00', time '09:00', 10, 'Horario compartido Plan / Semipersonalizado segun fuente.'),
    ('semi_personalizado', 'Semipersonalizado', 1, time '08:00', time '09:00', 10, 'Horario compartido Plan / Semipersonalizado segun fuente.'),
    ('plan_entrenamiento', 'Plan de entrenamiento', 1, time '09:00', time '10:00', 10, 'Horario compartido Plan / Semipersonalizado segun fuente.'),
    ('semi_personalizado', 'Semipersonalizado', 1, time '09:00', time '10:00', 10, 'Horario compartido Plan / Semipersonalizado segun fuente.'),
    ('plan_entrenamiento', 'Plan de entrenamiento', 1, time '10:00', time '11:00', 10, 'Horario compartido Plan / Semipersonalizado segun fuente.'),
    ('semi_personalizado', 'Semipersonalizado', 1, time '10:00', time '11:00', 10, 'Horario compartido Plan / Semipersonalizado segun fuente.'),
    ('plan_entrenamiento', 'Plan de entrenamiento', 1, time '15:00', time '16:00', 10, 'Horario compartido Plan / Semipersonalizado segun fuente.'),
    ('semi_personalizado', 'Semipersonalizado', 1, time '15:00', time '16:00', 10, 'Horario compartido Plan / Semipersonalizado segun fuente.'),
    ('plan_entrenamiento', 'Plan de entrenamiento', 1, time '16:00', time '17:00', 10, 'Horario compartido Plan / Semipersonalizado segun fuente.'),
    ('semi_personalizado', 'Semipersonalizado', 1, time '16:00', time '17:00', 10, 'Horario compartido Plan / Semipersonalizado segun fuente.'),
    ('plan_entrenamiento', 'Plan de entrenamiento', 1, time '18:00', time '19:00', 10, 'Horario compartido Plan / Semipersonalizado segun fuente.'),
    ('semi_personalizado', 'Semipersonalizado', 1, time '18:00', time '19:00', 10, 'Horario compartido Plan / Semipersonalizado segun fuente.'),
    ('plan_entrenamiento', 'Plan de entrenamiento', 2, time '07:00', time '08:00', 10, 'Horario compartido Plan / Semipersonalizado segun fuente.'),
    ('semi_personalizado', 'Semipersonalizado', 2, time '07:00', time '08:00', 10, 'Horario compartido Plan / Semipersonalizado segun fuente.'),
    ('plan_entrenamiento', 'Plan de entrenamiento', 2, time '08:00', time '09:00', 10, 'Horario compartido Plan / Semipersonalizado segun fuente.'),
    ('semi_personalizado', 'Semipersonalizado', 2, time '08:00', time '09:00', 10, 'Horario compartido Plan / Semipersonalizado segun fuente.'),
    ('plan_entrenamiento', 'Plan de entrenamiento', 2, time '09:00', time '10:00', 10, 'Horario compartido Plan / Semipersonalizado segun fuente.'),
    ('semi_personalizado', 'Semipersonalizado', 2, time '09:00', time '10:00', 10, 'Horario compartido Plan / Semipersonalizado segun fuente.'),
    ('plan_entrenamiento', 'Plan de entrenamiento', 2, time '10:00', time '11:00', 10, 'Horario compartido Plan / Semipersonalizado segun fuente.'),
    ('semi_personalizado', 'Semipersonalizado', 2, time '10:00', time '11:00', 10, 'Horario compartido Plan / Semipersonalizado segun fuente.'),
    ('plan_entrenamiento', 'Plan de entrenamiento', 2, time '15:00', time '16:00', 10, 'Horario compartido Plan / Semipersonalizado segun fuente.'),
    ('semi_personalizado', 'Semipersonalizado', 2, time '15:00', time '16:00', 10, 'Horario compartido Plan / Semipersonalizado segun fuente.'),
    ('plan_entrenamiento', 'Plan de entrenamiento', 2, time '16:00', time '17:00', 10, 'Horario compartido Plan / Semipersonalizado segun fuente.'),
    ('semi_personalizado', 'Semipersonalizado', 2, time '16:00', time '17:00', 10, 'Horario compartido Plan / Semipersonalizado segun fuente.'),
    ('plan_entrenamiento', 'Plan de entrenamiento', 2, time '17:00', time '18:00', 10, 'Horario compartido Plan / Semipersonalizado segun fuente.'),
    ('semi_personalizado', 'Semipersonalizado', 2, time '17:00', time '18:00', 10, 'Horario compartido Plan / Semipersonalizado segun fuente.'),
    ('plan_entrenamiento', 'Plan de entrenamiento', 2, time '18:00', time '19:00', 10, 'Horario compartido Plan / Semipersonalizado segun fuente.'),
    ('semi_personalizado', 'Semipersonalizado', 2, time '18:00', time '19:00', 10, 'Horario compartido Plan / Semipersonalizado segun fuente.'),
    ('plan_entrenamiento', 'Plan de entrenamiento', 2, time '19:00', time '20:00', 10, 'Horario compartido Plan / Semipersonalizado segun fuente.'),
    ('semi_personalizado', 'Semipersonalizado', 2, time '19:00', time '20:00', 10, 'Horario compartido Plan / Semipersonalizado segun fuente.')
),
expanded_rules as (
  select
    a.id as activity_id,
    sr.title,
    sr.weekday,
    sr.start_time,
    sr.end_time,
    sr.capacity,
    sr.notes
  from source_rules sr
  join public.activities a on a.slug = sr.activity_slug
)
insert into public.class_recurring_rules (
  activity_id,
  title,
  weekday,
  start_time,
  end_time,
  capacity,
  notes,
  active,
  valid_from
)
select
  er.activity_id,
  er.title,
  er.weekday,
  er.start_time,
  er.end_time,
  er.capacity,
  er.notes,
  true,
  date '2026-05-25'
from expanded_rules er
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
  notes = excluded.notes,
  updated_at = now();

revoke all on table public.class_recurring_rules from anon;
revoke all on function private.materialize_recurring_class_sessions(timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function public.materialize_recurring_class_sessions(timestamptz, timestamptz) from public, anon;
revoke all on function public.admin_create_class_recurring_rule(uuid, text, int, time, time, int, text, text, date, date) from public, anon;
revoke all on function public.admin_archive_class_recurring_rule(uuid) from public, anon;
revoke all on function public.admin_list_class_recurring_rules() from public, anon;

grant execute on function public.materialize_recurring_class_sessions(timestamptz, timestamptz) to authenticated;
grant execute on function public.admin_create_class_recurring_rule(uuid, text, int, time, time, int, text, text, date, date) to authenticated;
grant execute on function public.admin_archive_class_recurring_rule(uuid) to authenticated;
grant execute on function public.admin_list_class_recurring_rules() to authenticated;
