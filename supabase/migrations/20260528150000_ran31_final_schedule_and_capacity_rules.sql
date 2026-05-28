-- RAN-31: align recurring calendar with Carolina's definitive weekly table.
-- Also relaxes class type max capacity so admins can override a single class cupo.

update public.activities
set
  name = case slug
    when 'plan_semipersonalizado' then 'Plan Autónomo / Semipersonalizado'
    when 'plan_personalizado_semipersonalizado' then 'Personalizado / Semipersonalizado / Plan Autónomo'
    else name
  end,
  description = case slug
    when 'plan_semipersonalizado' then 'Bloque Plan Autónomo / Semipersonalizado del cronograma semanal definitivo.'
    when 'plan_personalizado_semipersonalizado' then 'Bloque Personalizado / Semipersonalizado / Plan Autónomo del cronograma semanal definitivo.'
    when 'neurofuncional' then 'Bloque Neurofuncional del cronograma semanal definitivo.'
    when 'cognitivo' then 'Bloque Cognitivo del cronograma semanal definitivo.'
    else description
  end,
  default_capacity = case
    when slug = 'cognitivo' then 5
    when slug = 'personalizado_1_1' then 1
    when slug in (
      'neurofuncional',
      'ninos',
      'funcional',
      'plan_semipersonalizado',
      'plan_personalizado_semipersonalizado'
    ) then 10
    else default_capacity
  end,
  max_capacity = case
    when slug = 'personalizado_1_1' then 1
    when slug in (
      'neurofuncional',
      'ninos',
      'funcional',
      'cognitivo',
      'plan_semipersonalizado',
      'plan_personalizado_semipersonalizado'
    ) then null
    else max_capacity
  end,
  updated_at = now()
where slug in (
  'neurofuncional',
  'ninos',
  'funcional',
  'cognitivo',
  'personalizado_1_1',
  'plan_semipersonalizado',
  'plan_personalizado_semipersonalizado'
);

create or replace function private.enforce_personalized_session_capacity()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_activity_slug text;
begin
  select a.slug into v_activity_slug
  from public.activities a
  where a.id = new.activity_id;

  if v_activity_slug = 'personalizado_1_1' and new.capacity > 1 then
    raise exception 'Personalizado 1:1 permite maximo 1 alumno.';
  end if;

  return new;
end;
$$;

create or replace function public.admin_create_activity(
  p_name text,
  p_description text,
  p_requires_24h_cancel boolean,
  p_flexible_schedule boolean,
  p_active boolean,
  p_color_hex text,
  p_default_capacity int,
  p_max_capacity int
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_actor uuid;
  v_activity public.activities%rowtype;
begin
  v_actor := private.ensure_admin();

  if nullif(btrim(p_name), '') is null then
    raise exception 'El nombre de la actividad es obligatorio.';
  end if;

  if p_default_capacity is not null and p_default_capacity <= 0 then
    raise exception 'El cupo por defecto debe ser mayor a cero.';
  end if;

  if p_max_capacity is not null and p_max_capacity <= 0 then
    raise exception 'El cupo maximo debe ser mayor a cero.';
  end if;

  insert into public.activities (
    name,
    slug,
    description,
    requires_24h_cancel,
    flexible_schedule,
    active,
    color_hex,
    default_capacity,
    max_capacity
  )
  values (
    btrim(p_name),
    private.unique_activity_slug(p_name),
    nullif(btrim(coalesce(p_description, '')), ''),
    coalesce(p_requires_24h_cancel, false),
    coalesce(p_flexible_schedule, false),
    coalesce(p_active, true),
    nullif(btrim(coalesce(p_color_hex, '')), ''),
    p_default_capacity,
    p_max_capacity
  )
  returning * into v_activity;

  insert into public.audit_logs (actor_id, entity_type, entity_id, action, metadata)
  values (
    v_actor,
    'activity',
    v_activity.id,
    'activity.created',
    jsonb_build_object('name', v_activity.name, 'slug', v_activity.slug)
  );

  return jsonb_build_object('action', 'created', 'activity_id', v_activity.id);
end;
$$;

create or replace function public.admin_update_activity(
  p_activity_id uuid,
  p_name text,
  p_description text,
  p_requires_24h_cancel boolean,
  p_flexible_schedule boolean,
  p_active boolean,
  p_color_hex text,
  p_default_capacity int,
  p_max_capacity int
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_actor uuid;
  v_previous public.activities%rowtype;
  v_activity public.activities%rowtype;
  v_has_history boolean;
begin
  v_actor := private.ensure_admin();

  if nullif(btrim(p_name), '') is null then
    raise exception 'El nombre de la actividad es obligatorio.';
  end if;

  if p_default_capacity is not null and p_default_capacity <= 0 then
    raise exception 'El cupo por defecto debe ser mayor a cero.';
  end if;

  if p_max_capacity is not null and p_max_capacity <= 0 then
    raise exception 'El cupo maximo debe ser mayor a cero.';
  end if;

  select * into v_previous
  from public.activities a
  where a.id = p_activity_id
  for update;

  if not found then
    raise exception 'No se encontro la actividad.';
  end if;

  select exists (
    select 1 from public.plan_activities pa where pa.activity_id = p_activity_id
  ) or exists (
    select 1 from public.class_sessions s where s.activity_id = p_activity_id
  ) or exists (
    select 1
    from public.bookings b
    join public.class_sessions s on s.id = b.session_id
    where s.activity_id = p_activity_id
  ) or exists (
    select 1
    from public.attendance att
    join public.class_sessions s on s.id = att.session_id
    where s.activity_id = p_activity_id
  ) into v_has_history;

  update public.activities a
  set
    name = btrim(p_name),
    slug = private.unique_activity_slug(p_name, p_activity_id),
    description = nullif(btrim(coalesce(p_description, '')), ''),
    requires_24h_cancel = coalesce(p_requires_24h_cancel, false),
    flexible_schedule = coalesce(p_flexible_schedule, false),
    active = coalesce(p_active, true),
    color_hex = nullif(btrim(coalesce(p_color_hex, '')), ''),
    default_capacity = case
      when v_previous.slug = 'personalizado_1_1' then 1
      else p_default_capacity
    end,
    max_capacity = case
      when v_previous.slug = 'personalizado_1_1' then 1
      else p_max_capacity
    end,
    updated_at = now()
  where a.id = p_activity_id
  returning * into v_activity;

  insert into public.audit_logs (actor_id, entity_type, entity_id, action, metadata)
  values (
    v_actor,
    'activity',
    v_activity.id,
    'activity.updated',
    jsonb_build_object(
      'has_history', v_has_history,
      'old', to_jsonb(v_previous),
      'new', to_jsonb(v_activity)
    )
  );

  return jsonb_build_object('action', 'updated', 'activity_id', v_activity.id, 'has_history', v_has_history);
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
  p_valid_from date default null,
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
  v_existing_rule public.class_recurring_rules%rowtype;
  v_valid_from date := coalesce(p_valid_from, current_date);
  v_valid_until date := p_valid_until;
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

  if v_valid_until is not null and v_valid_until < v_valid_from then
    raise exception 'La fecha final debe ser posterior o igual a la fecha inicial.';
  end if;

  if p_capacity is null or p_capacity <= 0 then
    raise exception 'El cupo debe ser mayor a cero.';
  end if;

  if v_activity.slug = 'personalizado_1_1' and p_capacity > 1 then
    raise exception 'Personalizado 1:1 permite maximo 1 alumno.';
  end if;

  select * into v_existing_rule
  from public.class_recurring_rules r
  where r.active = true
    and r.activity_id = p_activity_id
    and r.weekday = p_weekday
    and r.start_time = p_start_time
    and r.end_time = p_end_time
    and r.valid_from <= coalesce(v_valid_until, date '9999-12-31')
    and v_valid_from <= coalesce(r.valid_until, date '9999-12-31')
  limit 1;

  if found and (
    v_existing_rule.valid_from is distinct from v_valid_from
    or v_existing_rule.valid_until is distinct from v_valid_until
  ) then
    raise exception 'Ya existe un horario recurrente activo para ese tipo, dia y horario. Pausa el anterior antes de crear otro.';
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
    v_valid_from,
    v_valid_until,
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

with source_rules(day_group, start_time, end_time, activity_slug, title, capacity, notes) as (
  values
    ('lmv', time '07:00', time '08:00', 'plan_semipersonalizado', 'Plan Autónomo / Semipersonalizado', 10, 'Cronograma semanal definitivo EMOTIVA.'),
    ('lmv', time '08:00', time '09:00', 'neurofuncional', 'Neurofuncional', 10, 'Cronograma semanal definitivo EMOTIVA.'),
    ('lmv', time '09:00', time '10:00', 'plan_semipersonalizado', 'Plan Autónomo / Semipersonalizado', 10, 'Cronograma semanal definitivo EMOTIVA.'),
    ('lmv', time '10:00', time '11:00', 'plan_personalizado_semipersonalizado', 'Personalizado / Semipersonalizado / Plan Autónomo', 10, 'Cronograma semanal definitivo EMOTIVA.'),
    ('lmv', time '14:00', time '15:00', 'cognitivo', 'Cognitivo', 5, 'Cronograma semanal definitivo EMOTIVA.'),
    ('lmv', time '15:00', time '16:00', 'plan_semipersonalizado', 'Plan Autónomo / Semipersonalizado', 10, 'Cronograma semanal definitivo EMOTIVA.'),
    ('lmv', time '16:00', time '17:00', 'plan_semipersonalizado', 'Plan Autónomo / Semipersonalizado', 10, 'Cronograma semanal definitivo EMOTIVA.'),
    ('lmv', time '17:00', time '18:00', 'plan_semipersonalizado', 'Plan Autónomo / Semipersonalizado', 10, 'Cronograma semanal definitivo EMOTIVA.'),
    ('lmv', time '18:00', time '19:00', 'neurofuncional', 'Neurofuncional', 10, 'Cronograma semanal definitivo EMOTIVA.'),
    ('lmv', time '19:00', time '20:00', 'plan_semipersonalizado', 'Plan Autónomo / Semipersonalizado', 10, 'Cronograma semanal definitivo EMOTIVA.'),
    ('mj', time '07:00', time '08:00', 'plan_personalizado_semipersonalizado', 'Personalizado / Semipersonalizado / Plan Autónomo', 10, 'Cronograma semanal definitivo EMOTIVA.'),
    ('mj', time '08:00', time '09:00', 'plan_semipersonalizado', 'Plan Autónomo / Semipersonalizado', 10, 'Cronograma semanal definitivo EMOTIVA.'),
    ('mj', time '09:00', time '10:00', 'plan_semipersonalizado', 'Plan Autónomo / Semipersonalizado', 10, 'Cronograma semanal definitivo EMOTIVA.'),
    ('mj', time '10:00', time '11:00', 'plan_personalizado_semipersonalizado', 'Personalizado / Semipersonalizado / Plan Autónomo', 10, 'Cronograma semanal definitivo EMOTIVA.'),
    ('mj', time '14:00', time '15:00', 'plan_semipersonalizado', 'Plan Autónomo / Semipersonalizado', 5, 'Cronograma semanal definitivo EMOTIVA.'),
    ('mj', time '15:00', time '16:00', 'plan_semipersonalizado', 'Plan Autónomo / Semipersonalizado', 10, 'Cronograma semanal definitivo EMOTIVA.'),
    ('mj', time '16:00', time '17:00', 'plan_semipersonalizado', 'Plan Autónomo / Semipersonalizado', 10, 'Cronograma semanal definitivo EMOTIVA.'),
    ('mj', time '17:00', time '18:00', 'plan_personalizado_semipersonalizado', 'Personalizado / Semipersonalizado / Plan Autónomo', 10, 'Cronograma semanal definitivo EMOTIVA.'),
    ('mj', time '18:00', time '19:00', 'plan_semipersonalizado', 'Plan Autónomo / Semipersonalizado', 10, 'Cronograma semanal definitivo EMOTIVA.'),
    ('mj', time '19:00', time '20:00', 'plan_semipersonalizado', 'Plan Autónomo / Semipersonalizado', 10, 'Cronograma semanal definitivo EMOTIVA.')
),
source_days(day_group, weekday) as (
  values
    ('lmv', 1),
    ('lmv', 3),
    ('lmv', 5),
    ('mj', 2),
    ('mj', 4)
),
target_rules as (
  select
    a.id as activity_id,
    sr.title,
    sd.weekday,
    sr.start_time,
    sr.end_time,
    sr.capacity,
    sr.notes
  from source_rules sr
  join source_days sd on sd.day_group = sr.day_group
  join public.activities a on a.slug = sr.activity_slug
),
calendar_activity_ids as (
  select id
  from public.activities
  where slug in (
    'neurofuncional',
    'ninos',
    'funcional',
    'cognitivo',
    'plan_semipersonalizado',
    'plan_personalizado_semipersonalizado'
  )
),
deactivated as (
  update public.class_recurring_rules r
  set active = false,
      valid_until = coalesce(valid_until, greatest(r.valid_from, date '2026-05-27')),
      updated_at = now()
  where r.active = true
    and r.activity_id in (select id from calendar_activity_ids)
    and not exists (
      select 1
      from target_rules tr
      where tr.activity_id = r.activity_id
        and tr.weekday = r.weekday
        and tr.start_time = r.start_time
        and tr.end_time = r.end_time
        and r.valid_from = date '2026-05-18'
        and r.valid_until is null
    )
  returning r.id
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
  valid_from,
  valid_until
)
select
  tr.activity_id,
  tr.title,
  tr.weekday,
  tr.start_time,
  tr.end_time,
  tr.capacity,
  tr.notes,
  true,
  date '2026-05-18',
  null::date
from target_rules tr
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
  active = true,
  valid_until = null,
  updated_at = now();

delete from public.class_sessions cs
where cs.starts_at >= timestamptz '2026-05-28 00:00:00-03'
  and cs.recurring_rule_id is not null
  and not exists (
    select 1
    from public.bookings b
    where b.session_id = cs.id
  )
  and not exists (
    select 1
    from public.attendance att
    join public.bookings b on b.id = att.booking_id
    where b.session_id = cs.id
  )
  and not exists (
    select 1
    from public.class_recurring_rule_exceptions cre
    where cre.class_session_id = cs.id
      and cre.action = 'edited'
  );

select private.materialize_recurring_class_sessions(
  timestamptz '2026-05-28 00:00:00-03',
  timestamptz '2026-06-29 00:00:00-03'
);

revoke all on function public.admin_create_activity(text, text, boolean, boolean, boolean, text, int, int) from public, anon;
revoke all on function public.admin_update_activity(uuid, text, text, boolean, boolean, boolean, text, int, int) from public, anon;
revoke all on function public.admin_create_class_recurring_rule(uuid, text, int, time, time, int, text, text, date, date) from public, anon;

grant execute on function public.admin_create_activity(text, text, boolean, boolean, boolean, text, int, int) to authenticated;
grant execute on function public.admin_update_activity(uuid, text, text, boolean, boolean, boolean, text, int, int) to authenticated;
grant execute on function public.admin_create_class_recurring_rule(uuid, text, int, time, time, int, text, text, date, date) to authenticated;
