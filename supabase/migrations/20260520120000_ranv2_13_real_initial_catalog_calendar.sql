-- RANV2-13 real initial catalog and calendar base.
-- Source assets:
-- - docs/source-assets/Precios.jpeg
-- - docs/source-assets/Plan Actividades.jpeg
--
-- This migration is intentionally data-only and idempotent:
-- - upserts real class types and commercial plans;
-- - aligns plan/activity limits with the confirmed source catalog;
-- - inserts a bounded initial schedule without duplicating exact sessions;
-- - does not touch payments, memberships, bookings, attendance or files.

insert into public.activities (
  name,
  slug,
  description,
  requires_24h_cancel,
  flexible_schedule,
  active,
  color_hex,
  default_capacity,
  max_capacity,
  updated_at
)
values
  (
    'Funcional',
    'funcional',
    'Clase grupal funcional segun cronograma semanal.',
    false,
    false,
    true,
    '#2FBF9F',
    10,
    10,
    now()
  ),
  (
    'Neurofuncional',
    'neurofuncional',
    'Clase grupal neurofuncional segun cronograma semanal.',
    false,
    false,
    true,
    '#2394C7',
    10,
    10,
    now()
  ),
  (
    'Semipersonalizado',
    'semi_personalizado',
    'Clase semipersonalizada grupal segun cronograma semanal.',
    false,
    false,
    true,
    '#75CFC2',
    10,
    10,
    now()
  ),
  (
    'Programa Kids',
    'ninos',
    'Clase grupal para Programa Kids / ninos.',
    false,
    false,
    true,
    '#8C7AE6',
    10,
    10,
    now()
  ),
  (
    'Plan de entrenamiento',
    'plan_entrenamiento',
    'Clase para alumnos con plan de entrenamiento.',
    false,
    false,
    true,
    '#F0C75E',
    10,
    10,
    now()
  ),
  (
    'Cognitivo',
    'cognitivo',
    'Tipo de clase cognitiva disponible para activar segun demanda.',
    false,
    true,
    true,
    '#67B7DC',
    5,
    5,
    now()
  ),
  (
    'Personalizado 1:1',
    'personalizado_1_1',
    'Clase personalizada individual con cupo maximo de 1 alumno.',
    true,
    true,
    true,
    '#E98383',
    1,
    1,
    now()
  )
on conflict (slug) do update
set name = excluded.name,
    description = excluded.description,
    requires_24h_cancel = excluded.requires_24h_cancel,
    flexible_schedule = excluded.flexible_schedule,
    active = excluded.active,
    color_hex = excluded.color_hex,
    default_capacity = excluded.default_capacity,
    max_capacity = excluded.max_capacity,
    updated_at = now();

insert into public.plans (
  name,
  slug,
  description,
  price,
  billing_period_days,
  active,
  plan_type,
  package_class_count,
  updated_at
)
values
  (
    'Neurofuncional 3 veces por semana',
    'neurofuncional_3x',
    'Plan semanal neurofuncional con hasta 3 clases por semana.',
    40000,
    30,
    true,
    'weekly',
    null,
    now()
  ),
  (
    'Semipersonalizado 5 veces por semana',
    'semipersonalizado_5x',
    'Plan semanal semipersonalizado con hasta 5 clases por semana.',
    60000,
    30,
    true,
    'weekly',
    null,
    now()
  ),
  (
    'Semipersonalizado 3 veces por semana',
    'semipersonalizado_3x',
    'Plan semanal semipersonalizado con hasta 3 clases por semana.',
    50000,
    30,
    true,
    'weekly',
    null,
    now()
  ),
  (
    'Combo semipersonalizado y funcional',
    'combo_semipersonalizado_funcional',
    'Combo semanal con 3 clases funcionales y 2 semipersonalizadas por semana.',
    50000,
    30,
    true,
    'weekly',
    null,
    now()
  ),
  (
    'Programa Kids 3 veces por semana',
    'programa_kids_3x',
    'Plan semanal Programa Kids con hasta 3 clases por semana.',
    40000,
    30,
    true,
    'weekly',
    null,
    now()
  ),
  (
    'Con plan de entrenamiento 5 veces por semana',
    'plan_entrenamiento_5x',
    'Plan semanal con plan de entrenamiento y hasta 5 clases por semana.',
    35000,
    30,
    true,
    'weekly',
    null,
    now()
  ),
  (
    'Con plan de entrenamiento 3 veces por semana',
    'plan_entrenamiento_3x',
    'Plan semanal con plan de entrenamiento y hasta 3 clases por semana.',
    25000,
    30,
    true,
    'weekly',
    null,
    now()
  ),
  (
    'Personalizado 1 clase',
    'personalizado_1_clase',
    'Paquete personalizado de 1 clase individual.',
    45000,
    30,
    true,
    'package',
    1,
    now()
  ),
  (
    'Personalizado 4 clases',
    'personalizado_4_clases',
    'Paquete personalizado de 4 clases individuales.',
    170000,
    30,
    true,
    'package',
    4,
    now()
  ),
  (
    'Personalizado 8 clases',
    'personalizado_8_clases',
    'Paquete personalizado de 8 clases individuales.',
    320000,
    30,
    true,
    'package',
    8,
    now()
  ),
  (
    'Personalizado 12 clases',
    'personalizado_12_clases',
    'Paquete personalizado de 12 clases individuales.',
    450000,
    30,
    true,
    'package',
    12,
    now()
  )
on conflict (slug) do update
set name = excluded.name,
    description = excluded.description,
    price = excluded.price,
    billing_period_days = excluded.billing_period_days,
    active = excluded.active,
    plan_type = excluded.plan_type,
    package_class_count = excluded.package_class_count,
    updated_at = now();

with source_plan_slugs(slug) as (
  values
    ('neurofuncional_3x'),
    ('semipersonalizado_5x'),
    ('semipersonalizado_3x'),
    ('combo_semipersonalizado_funcional'),
    ('programa_kids_3x'),
    ('plan_entrenamiento_5x'),
    ('plan_entrenamiento_3x'),
    ('personalizado_1_clase'),
    ('personalizado_4_clases'),
    ('personalizado_8_clases'),
    ('personalizado_12_clases')
),
source_config(plan_slug, activity_slug, monthly_credits, weekly_class_limit) as (
  values
    ('neurofuncional_3x', 'neurofuncional', null::int, 3),
    ('semipersonalizado_5x', 'semi_personalizado', null::int, 5),
    ('semipersonalizado_3x', 'semi_personalizado', null::int, 3),
    ('combo_semipersonalizado_funcional', 'funcional', null::int, 3),
    ('combo_semipersonalizado_funcional', 'semi_personalizado', null::int, 2),
    ('programa_kids_3x', 'ninos', null::int, 3),
    ('plan_entrenamiento_5x', 'plan_entrenamiento', null::int, 5),
    ('plan_entrenamiento_3x', 'plan_entrenamiento', null::int, 3),
    ('personalizado_1_clase', 'personalizado_1_1', 1, null::int),
    ('personalizado_4_clases', 'personalizado_1_1', 4, null::int),
    ('personalizado_8_clases', 'personalizado_1_1', 8, null::int),
    ('personalizado_12_clases', 'personalizado_1_1', 12, null::int)
),
removed_extra_config as (
  delete from public.plan_activities pa
  using public.plans p
  where pa.plan_id = p.id
    and p.slug in (select slug from source_plan_slugs)
    and not exists (
      select 1
      from source_config sc
      join public.activities a on a.slug = sc.activity_slug
      where sc.plan_slug = p.slug
        and a.id = pa.activity_id
    )
  returning pa.plan_id
)
insert into public.plan_activities (
  plan_id,
  activity_id,
  monthly_credits,
  weekly_class_limit
)
select
  p.id,
  a.id,
  sc.monthly_credits,
  sc.weekly_class_limit
from source_config sc
join public.plans p on p.slug = sc.plan_slug
join public.activities a on a.slug = sc.activity_slug
on conflict (plan_id, activity_id) do update
set monthly_credits = excluded.monthly_credits,
    weekly_class_limit = excluded.weekly_class_limit;

update public.plans
set active = false,
    description = coalesce(description, '') || case
      when coalesce(description, '') ilike '%Archivado por catalogo real RANV2-13%' then ''
      else ' Archivado por catalogo real RANV2-13.'
    end,
    updated_at = now()
where slug in (
  'plan_funcional',
  'plan_semi_personalizado',
  'plan_ninos',
  'plan_cognitivo',
  'plan_personalizado_1_1'
);

with settings as (
  select
    date '2026-05-25' as start_monday,
    8 as week_count
),
week_starts as (
  select (s.start_monday + (week_index * 7))::date as week_start
  from settings s
  cross join generate_series(0, (select week_count - 1 from settings)) as week_index
),
source_slots(day_group, start_time, end_time, activity_slug, title, capacity, notes) as (
  values
    ('lmv', time '07:00', time '08:00', 'funcional', 'Funcional', 10, 'Horario funcional inicial para el combo Semipersonalizado y Funcional.'),
    ('lmv', time '07:00', time '08:00', 'neurofuncional', 'Neurofuncional', 10, 'Cronograma semanal fuente: lunes, miercoles y viernes.'),
    ('lmv', time '08:00', time '09:00', 'plan_entrenamiento', 'Plan de entrenamiento', 10, 'Horario compartido Plan / Semipersonalizado segun fuente.'),
    ('lmv', time '08:00', time '09:00', 'semi_personalizado', 'Semipersonalizado', 10, 'Horario compartido Plan / Semipersonalizado segun fuente.'),
    ('lmv', time '09:00', time '10:00', 'plan_entrenamiento', 'Plan de entrenamiento', 10, 'Horario compartido Plan y Semipersonalizado segun fuente.'),
    ('lmv', time '09:00', time '10:00', 'semi_personalizado', 'Semipersonalizado', 10, 'Horario compartido Plan y Semipersonalizado segun fuente.'),
    ('lmv', time '10:00', time '11:00', 'plan_entrenamiento', 'Plan de entrenamiento', 10, 'Horario compartido Plan / Semipersonalizado segun fuente.'),
    ('lmv', time '10:00', time '11:00', 'semi_personalizado', 'Semipersonalizado', 10, 'Horario compartido Plan / Semipersonalizado segun fuente.'),
    ('lmv', time '15:00', time '16:00', 'plan_entrenamiento', 'Plan de entrenamiento', 10, 'Horario compartido Plan / Semipersonalizado segun fuente.'),
    ('lmv', time '15:00', time '16:00', 'semi_personalizado', 'Semipersonalizado', 10, 'Horario compartido Plan / Semipersonalizado segun fuente.'),
    ('lmv', time '16:00', time '17:00', 'plan_entrenamiento', 'Plan de entrenamiento', 10, 'Horario compartido Plan / Semipersonalizado segun fuente.'),
    ('lmv', time '16:00', time '17:00', 'semi_personalizado', 'Semipersonalizado', 10, 'Horario compartido Plan / Semipersonalizado segun fuente.'),
    ('lmv', time '17:00', time '18:00', 'ninos', 'Programa Kids', 10, 'Cronograma semanal fuente: lunes, miercoles y viernes.'),
    ('lmv', time '18:00', time '19:00', 'plan_entrenamiento', 'Plan de entrenamiento', 10, 'Horario compartido Plan y Semipersonalizado segun fuente.'),
    ('lmv', time '18:00', time '19:00', 'semi_personalizado', 'Semipersonalizado', 10, 'Horario compartido Plan y Semipersonalizado segun fuente.'),
    ('lmv', time '19:00', time '20:00', 'funcional', 'Funcional', 10, 'Horario funcional inicial para el combo Semipersonalizado y Funcional.'),
    ('lmv', time '19:00', time '20:00', 'neurofuncional', 'Neurofuncional', 10, 'Cronograma semanal fuente: lunes, miercoles y viernes.'),
    ('mj', time '07:00', time '08:00', 'plan_entrenamiento', 'Plan de entrenamiento', 10, 'Horario compartido Plan y Semipersonalizado segun fuente.'),
    ('mj', time '07:00', time '08:00', 'semi_personalizado', 'Semipersonalizado', 10, 'Horario compartido Plan y Semipersonalizado segun fuente.'),
    ('mj', time '08:00', time '09:00', 'plan_entrenamiento', 'Plan de entrenamiento', 10, 'Horario compartido Plan / Semipersonalizado segun fuente.'),
    ('mj', time '08:00', time '09:00', 'semi_personalizado', 'Semipersonalizado', 10, 'Horario compartido Plan / Semipersonalizado segun fuente.'),
    ('mj', time '09:00', time '10:00', 'plan_entrenamiento', 'Plan de entrenamiento', 10, 'Horario compartido Plan y Semipersonalizado segun fuente.'),
    ('mj', time '09:00', time '10:00', 'semi_personalizado', 'Semipersonalizado', 10, 'Horario compartido Plan y Semipersonalizado segun fuente.'),
    ('mj', time '10:00', time '11:00', 'plan_entrenamiento', 'Plan de entrenamiento', 10, 'Horario compartido Plan / Semipersonalizado segun fuente.'),
    ('mj', time '10:00', time '11:00', 'semi_personalizado', 'Semipersonalizado', 10, 'Horario compartido Plan / Semipersonalizado segun fuente.'),
    ('mj', time '15:00', time '16:00', 'plan_entrenamiento', 'Plan de entrenamiento', 10, 'Horario compartido Plan / Semipersonalizado segun fuente.'),
    ('mj', time '15:00', time '16:00', 'semi_personalizado', 'Semipersonalizado', 10, 'Horario compartido Plan / Semipersonalizado segun fuente.'),
    ('mj', time '16:00', time '17:00', 'plan_entrenamiento', 'Plan de entrenamiento', 10, 'Horario compartido Plan / Semipersonalizado segun fuente.'),
    ('mj', time '16:00', time '17:00', 'semi_personalizado', 'Semipersonalizado', 10, 'Horario compartido Plan / Semipersonalizado segun fuente.'),
    ('mj', time '17:00', time '18:00', 'plan_entrenamiento', 'Plan de entrenamiento', 10, 'Horario compartido Plan y Semipersonalizado segun fuente.'),
    ('mj', time '17:00', time '18:00', 'semi_personalizado', 'Semipersonalizado', 10, 'Horario compartido Plan y Semipersonalizado segun fuente.'),
    ('mj', time '18:00', time '19:00', 'plan_entrenamiento', 'Plan de entrenamiento', 10, 'Horario compartido Plan / Semipersonalizado segun fuente.'),
    ('mj', time '18:00', time '19:00', 'semi_personalizado', 'Semipersonalizado', 10, 'Horario compartido Plan / Semipersonalizado segun fuente.'),
    ('mj', time '19:00', time '20:00', 'plan_entrenamiento', 'Plan de entrenamiento', 10, 'Horario compartido Plan / Semipersonalizado segun fuente.'),
    ('mj', time '19:00', time '20:00', 'semi_personalizado', 'Semipersonalizado', 10, 'Horario compartido Plan / Semipersonalizado segun fuente.')
),
source_days(day_group, day_offset) as (
  values
    ('lmv', 0),
    ('lmv', 2),
    ('lmv', 4),
    ('mj', 1),
    ('mj', 3)
),
generated_sessions as (
  select
    a.id as activity_id,
    ss.title,
    ((ws.week_start + sd.day_offset + ss.start_time) at time zone 'America/Argentina/Buenos_Aires') as starts_at,
    ((ws.week_start + sd.day_offset + ss.end_time) at time zone 'America/Argentina/Buenos_Aires') as ends_at,
    ss.capacity,
    null::text as trainer_name,
    ss.notes,
    true as active
  from week_starts ws
  join source_days sd on true
  join source_slots ss on ss.day_group = sd.day_group
  join public.activities a on a.slug = ss.activity_slug
)
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
select
  gs.activity_id,
  gs.title,
  gs.starts_at,
  gs.ends_at,
  gs.capacity,
  gs.trainer_name,
  gs.notes,
  gs.active
from generated_sessions gs
where not exists (
  select 1
  from public.class_sessions existing
  where existing.activity_id = gs.activity_id
    and existing.starts_at = gs.starts_at
    and existing.ends_at = gs.ends_at
);
