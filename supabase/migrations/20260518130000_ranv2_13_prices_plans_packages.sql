-- RANV2-13: real prices, plans and class packages from docs/source-assets/Precios.jpeg.
-- This is a catalog/data migration only. It does not change schema.

insert into public.activities (name, slug, description, requires_24h_cancel, flexible_schedule, active)
values
  ('Neurofuncional', 'neurofuncional', 'Actividad grupal neurofuncional.', false, false, true),
  ('Funcional', 'funcional', 'Actividad grupal funcional.', false, false, true),
  ('Semi personalizado', 'semi_personalizado', 'Actividad semi personalizada.', false, false, true),
  ('Programa Kids', 'ninos', 'Actividad para ninos.', false, false, true),
  ('Plan de entrenamiento', 'plan_entrenamiento', 'Trabajo con plan de entrenamiento.', false, false, true),
  ('Personalizado 1:1', 'personalizado_1_1', 'Clase personalizada individual con cancelacion anticipada.', true, false, true)
on conflict (slug) do update set
  name = excluded.name,
  description = excluded.description,
  requires_24h_cancel = excluded.requires_24h_cancel,
  flexible_schedule = excluded.flexible_schedule,
  active = excluded.active,
  updated_at = now();

insert into public.plans (name, slug, description, price, billing_period_days, active)
values
  (
    'Neurofuncional 3 veces por semana',
    'neurofuncional_3x',
    'Fuente Precios.jpeg: frecuencia semanal 3, cupo grupal 10.',
    40000,
    30,
    true
  ),
  (
    'Semipersonalizado 5 veces por semana',
    'semipersonalizado_5x',
    'Fuente Precios.jpeg: frecuencia semanal 5, cupo grupal 10.',
    60000,
    30,
    true
  ),
  (
    'Semipersonalizado 3 veces por semana',
    'semipersonalizado_3x',
    'Fuente Precios.jpeg: frecuencia semanal 3, cupo grupal 10.',
    50000,
    30,
    true
  ),
  (
    'Combo semipersonalizado y funcional',
    'combo_semipersonalizado_funcional',
    'Fuente Precios.jpeg: 3 funcional + 2 semipersonalizado, cupo grupal 10.',
    50000,
    30,
    true
  ),
  (
    'Programa Kids 3 veces por semana',
    'programa_kids_3x',
    'Fuente Precios.jpeg: frecuencia semanal 3, cupo grupal 10.',
    40000,
    30,
    true
  ),
  (
    'Con plan de entrenamiento 5 veces por semana',
    'plan_entrenamiento_5x',
    'Fuente Precios.jpeg: frecuencia semanal 5, cupo grupal 10.',
    35000,
    30,
    true
  ),
  (
    'Con plan de entrenamiento 3 veces por semana',
    'plan_entrenamiento_3x',
    'Fuente Precios.jpeg: frecuencia semanal 3, cupo grupal 10.',
    25000,
    30,
    true
  ),
  (
    'Personalizado 1 clase',
    'personalizado_1_clase',
    'Fuente Precios.jpeg: paquete personalizado de 1 clase, cupo 1.',
    45000,
    30,
    true
  ),
  (
    'Personalizado 4 clases',
    'personalizado_4_clases',
    'Fuente Precios.jpeg: paquete personalizado de 4 clases, cupo 1.',
    170000,
    30,
    true
  ),
  (
    'Personalizado 8 clases',
    'personalizado_8_clases',
    'Fuente Precios.jpeg: paquete personalizado de 8 clases, cupo 1.',
    320000,
    30,
    true
  ),
  (
    'Personalizado 12 clases',
    'personalizado_12_clases',
    'Fuente Precios.jpeg: paquete personalizado de 12 clases, cupo 1.',
    450000,
    30,
    true
  )
on conflict (slug) do update set
  name = excluded.name,
  description = excluded.description,
  price = excluded.price,
  billing_period_days = excluded.billing_period_days,
  active = excluded.active,
  updated_at = now();

with source_plan(slug) as (
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
)
delete from public.plan_activities pa
using public.plans p, source_plan sp
where pa.plan_id = p.id
  and p.slug = sp.slug;

insert into public.plan_activities (plan_id, activity_id, monthly_credits)
select p.id, a.id, source.monthly_credits
from (
  values
    ('neurofuncional_3x', 'neurofuncional', 12),
    ('semipersonalizado_5x', 'semi_personalizado', 20),
    ('semipersonalizado_3x', 'semi_personalizado', 12),
    ('combo_semipersonalizado_funcional', 'funcional', 12),
    ('combo_semipersonalizado_funcional', 'semi_personalizado', 8),
    ('programa_kids_3x', 'ninos', 12),
    ('plan_entrenamiento_5x', 'plan_entrenamiento', 20),
    ('plan_entrenamiento_3x', 'plan_entrenamiento', 12),
    ('personalizado_1_clase', 'personalizado_1_1', 1),
    ('personalizado_4_clases', 'personalizado_1_1', 4),
    ('personalizado_8_clases', 'personalizado_1_1', 8),
    ('personalizado_12_clases', 'personalizado_1_1', 12)
) as source(plan_slug, activity_slug, monthly_credits)
join public.plans p on p.slug = source.plan_slug
join public.activities a on a.slug = source.activity_slug
on conflict (plan_id, activity_id) do update set
  monthly_credits = excluded.monthly_credits;

update public.plans
set
  active = false,
  description = 'Plan base anterior conservado solo por historial. Usar el catalogo vigente cargado desde Precios.jpeg.',
  updated_at = now()
where slug in (
  'plan_funcional',
  'plan_semi_personalizado',
  'plan_ninos',
  'plan_cognitivo',
  'plan_personalizado_1_1'
);
