-- RANV2-13 virgin reset for the real initial catalog and weekly schedule.
-- Walter explicitly authorized deleting current test operational data.
-- Auth users and profiles are preserved; the admin profile is required.

do $$
declare
  v_admin_id uuid;
  v_profile_count int;
begin
  select id into v_admin_id
  from public.profiles
  where email = 'e.motiva.gym@gmail.com'
    and role = 'admin'
    and active = true;

  if v_admin_id is null then
    raise exception 'Reset abortado: no existe el admin activo e.motiva.gym@gmail.com.';
  end if;

  select count(*) into v_profile_count
  from public.profiles;

  if v_profile_count > 2 then
    raise exception 'Reset abortado: hay % perfiles. Este reset solo esta autorizado para base virgen con admin y un usuario de prueba.', v_profile_count;
  end if;

  delete from public.attendance;
  delete from public.bookings;
  delete from public.payments;
  delete from public.memberships;
  delete from public.files;
  delete from public.class_sessions;
  delete from public.class_recurring_rules;
  delete from public.plan_activities;
  delete from public.plans;
  delete from public.activities;

  update public.profiles
  set
    last_payment_at = null,
    last_real_activity_at = null,
    updated_at = now()
  where email <> 'e.motiva.gym@gmail.com';

  insert into public.audit_logs (actor_id, entity_type, entity_id, action, metadata)
  values (
    v_admin_id,
    'system',
    null,
    'virgin_catalog_schedule_reset',
    jsonb_build_object(
      'source_prices', 'docs/source-assets/Precios.jpeg',
      'source_schedule', 'docs/source-assets/Plan Actividades.jpeg',
      'preserved_profiles', true,
      'preserved_auth_users', true
    )
  );
end $$;

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
    'Neurofuncional',
    'neurofuncional',
    'Bloque neurofuncional del cronograma semanal real.',
    false,
    false,
    true,
    '#2394C7',
    10,
    10,
    now()
  ),
  (
    'Programa Kids',
    'ninos',
    'Bloque Programa Kids del cronograma semanal real.',
    false,
    false,
    true,
    '#8B5CF6',
    10,
    10,
    now()
  ),
  (
    'Cognitivo',
    'cognitivo',
    'Bloque cognitivo del cronograma semanal real.',
    false,
    true,
    true,
    '#EF4444',
    5,
    5,
    now()
  ),
  (
    'Personalizado 1:1',
    'personalizado_1_1',
    'Clase personalizada individual. Maximo 1 alumno por clase.',
    true,
    true,
    true,
    '#D946EF',
    1,
    1,
    now()
  ),
  (
    'Plan / Semipersonalizado',
    'plan_semipersonalizado',
    'Bloque mixto del cronograma para plan de entrenamiento y semipersonalizado.',
    false,
    false,
    true,
    '#14B8A6',
    10,
    10,
    now()
  ),
  (
    'Plan / Personalizado / Semipersonalizado',
    'plan_personalizado_semipersonalizado',
    'Bloque mixto del cronograma para plan, personalizado o semipersonalizado.',
    false,
    false,
    true,
    '#38BDF8',
    10,
    10,
    now()
  ),
  (
    'Funcional',
    'funcional',
    'Tipo disponible para el componente funcional del combo. Sin horario fijo inicial porque no aparece como bloque explicito en Plan Actividades.jpeg.',
    false,
    true,
    true,
    '#FACC15',
    10,
    10,
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
    'Plan mensual neurofuncional con hasta 3 clases por semana.',
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
    'Plan mensual semipersonalizado con hasta 5 clases por semana.',
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
    'Plan mensual semipersonalizado con hasta 3 clases por semana.',
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
    'Combo mensual con componente funcional pendiente de horario fijo y componente semipersonalizado.',
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
    'Plan mensual Programa Kids con hasta 3 clases por semana.',
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
    'Plan mensual de entrenamiento con hasta 5 clases por semana.',
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
    'Plan mensual de entrenamiento con hasta 3 clases por semana.',
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
    'Paquete personalizado de 4 clases.',
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
    'Paquete personalizado de 8 clases.',
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
    'Paquete personalizado de 12 clases.',
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

with source_config(plan_slug, activity_slug, monthly_credits, weekly_class_limit) as (
  values
    ('neurofuncional_3x', 'neurofuncional', null::int, 3),
    ('semipersonalizado_5x', 'plan_semipersonalizado', null::int, 5),
    ('semipersonalizado_5x', 'plan_personalizado_semipersonalizado', null::int, 5),
    ('semipersonalizado_3x', 'plan_semipersonalizado', null::int, 3),
    ('semipersonalizado_3x', 'plan_personalizado_semipersonalizado', null::int, 3),
    ('combo_semipersonalizado_funcional', 'funcional', null::int, 3),
    ('combo_semipersonalizado_funcional', 'plan_semipersonalizado', null::int, 2),
    ('programa_kids_3x', 'ninos', null::int, 3),
    ('plan_entrenamiento_5x', 'plan_semipersonalizado', null::int, 5),
    ('plan_entrenamiento_5x', 'plan_personalizado_semipersonalizado', null::int, 5),
    ('plan_entrenamiento_3x', 'plan_semipersonalizado', null::int, 3),
    ('plan_entrenamiento_3x', 'plan_personalizado_semipersonalizado', null::int, 3),
    ('personalizado_1_clase', 'personalizado_1_1', 1, null::int),
    ('personalizado_1_clase', 'plan_personalizado_semipersonalizado', 1, null::int),
    ('personalizado_4_clases', 'personalizado_1_1', 4, null::int),
    ('personalizado_4_clases', 'plan_personalizado_semipersonalizado', 4, null::int),
    ('personalizado_8_clases', 'personalizado_1_1', 8, null::int),
    ('personalizado_8_clases', 'plan_personalizado_semipersonalizado', 8, null::int),
    ('personalizado_12_clases', 'personalizado_1_1', 12, null::int),
    ('personalizado_12_clases', 'plan_personalizado_semipersonalizado', 12, null::int)
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

with source_rules(day_group, start_time, end_time, activity_slug, title, capacity, notes) as (
  values
    ('lmv', time '07:00', time '08:00', 'neurofuncional', 'Neurofuncional', 10, 'Cronograma semanal real: lunes, miercoles y viernes.'),
    ('lmv', time '08:00', time '09:00', 'plan_semipersonalizado', 'Plan / Semipersonalizado', 10, 'Cronograma semanal real.'),
    ('lmv', time '09:00', time '10:00', 'plan_personalizado_semipersonalizado', 'Plan / Personalizado / Semipersonalizado', 10, 'Cronograma semanal real.'),
    ('lmv', time '10:00', time '11:00', 'plan_semipersonalizado', 'Plan / Semipersonalizado', 10, 'Cronograma semanal real.'),
    ('lmv', time '14:00', time '15:00', 'cognitivo', 'Cognitivo', 5, 'Cronograma semanal real.'),
    ('lmv', time '15:00', time '16:00', 'plan_semipersonalizado', 'Plan / Semipersonalizado', 10, 'Cronograma semanal real.'),
    ('lmv', time '16:00', time '17:00', 'plan_semipersonalizado', 'Plan / Semipersonalizado', 10, 'Cronograma semanal real.'),
    ('lmv', time '17:00', time '18:00', 'ninos', 'Programa Kids', 10, 'Cronograma semanal real: lunes, miercoles y viernes.'),
    ('lmv', time '18:00', time '19:00', 'plan_personalizado_semipersonalizado', 'Plan / Personalizado / Semipersonalizado', 10, 'Cronograma semanal real.'),
    ('lmv', time '19:00', time '20:00', 'neurofuncional', 'Neurofuncional', 10, 'Cronograma semanal real: lunes, miercoles y viernes.'),
    ('mj', time '07:00', time '08:00', 'plan_personalizado_semipersonalizado', 'Plan / Personalizado / Semipersonalizado', 10, 'Cronograma semanal real.'),
    ('mj', time '08:00', time '09:00', 'plan_semipersonalizado', 'Plan / Semipersonalizado', 10, 'Cronograma semanal real.'),
    ('mj', time '09:00', time '10:00', 'plan_personalizado_semipersonalizado', 'Plan / Personalizado / Semipersonalizado', 10, 'Cronograma semanal real.'),
    ('mj', time '10:00', time '11:00', 'plan_semipersonalizado', 'Plan / Semipersonalizado', 10, 'Cronograma semanal real.'),
    ('mj', time '14:00', time '15:00', 'cognitivo', 'Cognitivo', 5, 'Cronograma semanal real.'),
    ('mj', time '15:00', time '16:00', 'plan_semipersonalizado', 'Plan / Semipersonalizado', 10, 'Cronograma semanal real.'),
    ('mj', time '16:00', time '17:00', 'plan_semipersonalizado', 'Plan / Semipersonalizado', 10, 'Cronograma semanal real.'),
    ('mj', time '17:00', time '18:00', 'plan_personalizado_semipersonalizado', 'Plan / Personalizado / Semipersonalizado', 10, 'Cronograma semanal real.'),
    ('mj', time '18:00', time '19:00', 'plan_semipersonalizado', 'Plan / Semipersonalizado', 10, 'Cronograma semanal real.'),
    ('mj', time '19:00', time '20:00', 'plan_semipersonalizado', 'Plan / Semipersonalizado', 10, 'Cronograma semanal real.')
),
source_days(day_group, weekday) as (
  values
    ('lmv', 1),
    ('lmv', 3),
    ('lmv', 5),
    ('mj', 2),
    ('mj', 4)
),
expanded_rules as (
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

select private.materialize_recurring_class_sessions(
  timestamptz '2026-05-25 00:00:00-03',
  timestamptz '2026-06-22 00:00:00-03'
);
