-- RAN-31 final QA fixes:
-- - Separate internal active plans from student-visible plans.
-- - Add optional active-membership limit per plan.
-- - Backfill recurring schedule validity/materialization for the current demo week.

alter table public.plans
  add column if not exists visible_to_students boolean not null default true,
  add column if not exists max_active_memberships integer;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'plans_max_active_memberships_check'
      and conrelid = 'public.plans'::regclass
  ) then
    alter table public.plans
      add constraint plans_max_active_memberships_check
      check (max_active_memberships is null or max_active_memberships > 0);
  end if;
end $$;

create index if not exists memberships_plan_active_dates_idx
  on public.memberships (plan_id, status, start_date, end_date);

drop function if exists public.admin_create_plan(text, text, numeric, int, text, int, boolean, jsonb);
drop function if exists public.admin_update_plan(uuid, text, text, numeric, int, text, int, boolean, jsonb);

create or replace function public.admin_create_plan(
  p_name text,
  p_description text,
  p_price numeric,
  p_billing_period_days int,
  p_plan_type text,
  p_package_class_count int,
  p_active boolean,
  p_activities jsonb,
  p_visible_to_students boolean default true,
  p_max_active_memberships int default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_actor uuid;
  v_plan public.plans%rowtype;
  v_slug text;
begin
  v_actor := private.ensure_admin();

  if nullif(btrim(p_name), '') is null then
    raise exception 'El nombre del plan es obligatorio.';
  end if;

  if p_price is null or p_price < 0 then
    raise exception 'El precio debe ser mayor o igual a cero.';
  end if;

  if p_billing_period_days is null or p_billing_period_days <= 0 then
    raise exception 'El periodo de facturacion debe ser mayor a cero.';
  end if;

  if p_plan_type not in ('weekly', 'package', 'manual') then
    raise exception 'Tipo de plan invalido.';
  end if;

  if p_plan_type = 'package' and (p_package_class_count is null or p_package_class_count <= 0) then
    raise exception 'Los paquetes requieren cantidad de clases mayor a cero.';
  end if;

  if p_plan_type <> 'package' and p_package_class_count is not null then
    raise exception 'Solo los planes de paquete pueden tener clases de paquete.';
  end if;

  if p_max_active_memberships is not null and p_max_active_memberships <= 0 then
    raise exception 'El limite de inscriptos debe ser mayor a cero o quedar vacio.';
  end if;

  v_slug := private.unique_plan_slug(p_name);

  insert into public.plans (
    name,
    slug,
    description,
    price,
    billing_period_days,
    plan_type,
    package_class_count,
    active,
    visible_to_students,
    max_active_memberships
  )
  values (
    btrim(p_name),
    v_slug,
    nullif(btrim(coalesce(p_description, '')), ''),
    p_price,
    p_billing_period_days,
    p_plan_type,
    case when p_plan_type = 'package' then p_package_class_count else null end,
    coalesce(p_active, true),
    coalesce(p_visible_to_students, true),
    p_max_active_memberships
  )
  returning * into v_plan;

  perform private.apply_plan_activity_config(v_plan.id, p_plan_type, coalesce(p_activities, '[]'::jsonb));

  insert into public.audit_logs (actor_id, entity_type, entity_id, action, metadata)
  values (
    v_actor,
    'plan',
    v_plan.id,
    'plan.created',
    jsonb_build_object(
      'name', v_plan.name,
      'slug', v_plan.slug,
      'plan_type', v_plan.plan_type,
      'package_class_count', v_plan.package_class_count,
      'visible_to_students', v_plan.visible_to_students,
      'max_active_memberships', v_plan.max_active_memberships
    )
  );

  return jsonb_build_object('action', 'created', 'plan_id', v_plan.id);
end;
$$;

create or replace function public.admin_update_plan(
  p_plan_id uuid,
  p_name text,
  p_description text,
  p_price numeric,
  p_billing_period_days int,
  p_plan_type text,
  p_package_class_count int,
  p_active boolean,
  p_activities jsonb,
  p_visible_to_students boolean default true,
  p_max_active_memberships int default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_actor uuid;
  v_previous public.plans%rowtype;
  v_plan public.plans%rowtype;
  v_has_history boolean;
  v_previous_activities jsonb;
  v_next_activities jsonb;
begin
  v_actor := private.ensure_admin();

  if nullif(btrim(p_name), '') is null then
    raise exception 'El nombre del plan es obligatorio.';
  end if;

  if p_price is null or p_price < 0 then
    raise exception 'El precio debe ser mayor o igual a cero.';
  end if;

  if p_billing_period_days is null or p_billing_period_days <= 0 then
    raise exception 'El periodo de facturacion debe ser mayor a cero.';
  end if;

  if p_plan_type not in ('weekly', 'package', 'manual') then
    raise exception 'Tipo de plan invalido.';
  end if;

  if p_plan_type = 'package' and (p_package_class_count is null or p_package_class_count <= 0) then
    raise exception 'Los paquetes requieren cantidad de clases mayor a cero.';
  end if;

  if p_plan_type <> 'package' and p_package_class_count is not null then
    raise exception 'Solo los planes de paquete pueden tener clases de paquete.';
  end if;

  if p_max_active_memberships is not null and p_max_active_memberships <= 0 then
    raise exception 'El limite de inscriptos debe ser mayor a cero o quedar vacio.';
  end if;

  select * into v_previous
  from public.plans p
  where p.id = p_plan_id
  for update;

  if not found then
    raise exception 'No se encontro el plan.';
  end if;

  select exists (
    select 1 from public.memberships m where m.plan_id = p_plan_id
  ) or exists (
    select 1
    from public.payments pay
    join public.memberships m on m.id = pay.membership_id
    where m.plan_id = p_plan_id
  ) into v_has_history;

  if v_has_history then
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'activity_id', pa.activity_id,
          'weekly_class_limit', pa.weekly_class_limit,
          'monthly_credits', pa.monthly_credits
        )
        order by pa.activity_id
      ),
      '[]'::jsonb
    ) into v_previous_activities
    from public.plan_activities pa
    where pa.plan_id = p_plan_id;

    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'activity_id', nullif(item->>'activity_id', '')::uuid,
          'weekly_class_limit', case
            when nullif(item->>'weekly_class_limit', '') is null then null
            else (item->>'weekly_class_limit')::int
          end,
          'monthly_credits', case
            when nullif(item->>'monthly_credits', '') is null then null
            else (item->>'monthly_credits')::int
          end
        )
        order by nullif(item->>'activity_id', '')::uuid
      ),
      '[]'::jsonb
    ) into v_next_activities
    from jsonb_array_elements(coalesce(p_activities, '[]'::jsonb)) item;

    if v_previous.plan_type is distinct from p_plan_type
      or v_previous.package_class_count is distinct from (
        case when p_plan_type = 'package' then p_package_class_count else null end
      )
      or v_previous_activities is distinct from v_next_activities
    then
      insert into public.audit_logs (actor_id, entity_type, entity_id, action, metadata)
      values (
        v_actor,
        'plan',
        p_plan_id,
        'plan.update_blocked',
        jsonb_build_object(
          'reason', 'structural_history',
          'message', 'Plan con membresias o pagos asociados.',
          'old_plan_type', v_previous.plan_type,
          'requested_plan_type', p_plan_type,
          'old_package_class_count', v_previous.package_class_count,
          'requested_package_class_count', p_package_class_count,
          'old_activities', v_previous_activities,
          'requested_activities', v_next_activities
        )
      );

      raise exception 'Este plan tiene membresias o pagos asociados. Para no afectar alumnos existentes, crea un plan nuevo y archiva el anterior.';
    end if;
  end if;

  update public.plans p
  set
    name = btrim(p_name),
    slug = private.unique_plan_slug(p_name, p_plan_id),
    description = nullif(btrim(coalesce(p_description, '')), ''),
    price = p_price,
    billing_period_days = p_billing_period_days,
    plan_type = case when v_has_history then v_previous.plan_type else p_plan_type end,
    package_class_count = case
      when v_has_history then v_previous.package_class_count
      when p_plan_type = 'package' then p_package_class_count
      else null
    end,
    active = coalesce(p_active, true),
    visible_to_students = coalesce(p_visible_to_students, true),
    max_active_memberships = p_max_active_memberships,
    updated_at = now()
  where p.id = p_plan_id
  returning * into v_plan;

  if not v_has_history then
    perform private.apply_plan_activity_config(v_plan.id, p_plan_type, coalesce(p_activities, '[]'::jsonb));
  end if;

  insert into public.audit_logs (actor_id, entity_type, entity_id, action, metadata)
  values (
    v_actor,
    'plan',
    v_plan.id,
    'plan.updated',
    jsonb_build_object(
      'has_history', v_has_history,
      'old', jsonb_build_object(
        'name', v_previous.name,
        'slug', v_previous.slug,
        'description', v_previous.description,
        'price', v_previous.price,
        'billing_period_days', v_previous.billing_period_days,
        'plan_type', v_previous.plan_type,
        'package_class_count', v_previous.package_class_count,
        'active', v_previous.active,
        'visible_to_students', v_previous.visible_to_students,
        'max_active_memberships', v_previous.max_active_memberships
      ),
      'new', jsonb_build_object(
        'name', v_plan.name,
        'slug', v_plan.slug,
        'description', v_plan.description,
        'price', v_plan.price,
        'billing_period_days', v_plan.billing_period_days,
        'plan_type', v_plan.plan_type,
        'package_class_count', v_plan.package_class_count,
        'active', v_plan.active,
        'visible_to_students', v_plan.visible_to_students,
        'max_active_memberships', v_plan.max_active_memberships
      )
    )
  );

  return jsonb_build_object('action', 'updated', 'plan_id', v_plan.id, 'has_history', v_has_history);
end;
$$;

create or replace function public.assign_membership(
  student_id uuid,
  plan_id uuid,
  start_date date,
  end_date date,
  remaining_credits int default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_actor_id uuid := auth.uid();
  v_student public.profiles%rowtype;
  v_membership public.memberships%rowtype;
  v_plan public.plans%rowtype;
  v_remaining_classes int;
  v_active_overlapping_memberships int := 0;
begin
  if v_actor_id is null or not coalesce(private.is_admin(), false) then
    raise exception 'Solo un admin activo puede asignar membresias.';
  end if;

  if start_date is null or end_date is null or end_date < start_date then
    raise exception 'El rango de fechas de membresia es invalido.';
  end if;

  if remaining_credits is not null and remaining_credits < 0 then
    raise exception 'Las clases restantes no pueden ser negativas.';
  end if;

  select * into v_student
  from public.profiles p
  where p.id = assign_membership.student_id
    and p.role = 'student'::public.user_role;

  if not found then
    raise exception 'El alumno no existe.';
  end if;

  select * into v_plan
  from public.plans p
  where p.id = assign_membership.plan_id
    and p.active = true;

  if not found then
    raise exception 'El plan no existe o no esta activo.';
  end if;

  if v_plan.max_active_memberships is not null then
    select count(*) into v_active_overlapping_memberships
    from public.memberships m
    where m.plan_id = assign_membership.plan_id
      and m.status = 'active'::public.membership_status
      and daterange(m.start_date, m.end_date, '[]')
        && daterange(assign_membership.start_date, assign_membership.end_date, '[]');

    if v_active_overlapping_memberships >= v_plan.max_active_memberships then
      raise exception 'Este plan alcanzo el limite de inscriptos.';
    end if;
  end if;

  v_remaining_classes := case
    when v_plan.plan_type = 'weekly' then null
    when v_plan.plan_type = 'package' then coalesce(remaining_credits, v_plan.package_class_count)
    else remaining_credits
  end;

  if v_plan.plan_type = 'package' and v_remaining_classes is null then
    raise exception 'El paquete personalizado necesita cantidad de clases.';
  end if;

  insert into public.memberships (
    student_id,
    plan_id,
    status,
    start_date,
    end_date,
    remaining_credits
  )
  values (
    assign_membership.student_id,
    assign_membership.plan_id,
    'active'::public.membership_status,
    assign_membership.start_date,
    assign_membership.end_date,
    v_remaining_classes
  )
  returning * into v_membership;

  update public.profiles
  set
    last_payment_at = coalesce(last_payment_at, now()),
    updated_at = now()
  where id = v_membership.student_id;

  insert into public.audit_logs (actor_id, entity_type, entity_id, action, metadata)
  values (
    v_actor_id,
    'membership',
    v_membership.id,
    'membership.assigned',
    jsonb_build_object(
      'student_id', v_membership.student_id,
      'plan_id', v_membership.plan_id,
      'plan_type', v_plan.plan_type,
      'start_date', v_membership.start_date,
      'end_date', v_membership.end_date,
      'remaining_classes', v_membership.remaining_credits,
      'max_active_memberships', v_plan.max_active_memberships
    )
  );

  return jsonb_build_object(
    'membership_id', v_membership.id,
    'student_id', v_membership.student_id,
    'plan_id', v_membership.plan_id,
    'plan_type', v_plan.plan_type,
    'status', v_membership.status,
    'start_date', v_membership.start_date,
    'end_date', v_membership.end_date,
    'remaining_classes', v_membership.remaining_credits
  );
end;
$$;

-- The initial reset started the perpetual schedule on 2026-05-25.
-- For the demo/current week, the same source schedule must be valid from 2026-05-18.
update public.class_recurring_rules
set valid_from = date '2026-05-18',
    updated_at = now()
where active = true
  and valid_from = date '2026-05-25';

select private.materialize_recurring_class_sessions(
  '2026-05-18 00:00:00 America/Argentina/Buenos_Aires'::timestamptz,
  '2026-05-25 00:00:00 America/Argentina/Buenos_Aires'::timestamptz
);

revoke all on function public.admin_create_plan(text, text, numeric, int, text, int, boolean, jsonb, boolean, int) from public, anon;
revoke all on function public.admin_update_plan(uuid, text, text, numeric, int, text, int, boolean, jsonb, boolean, int) from public, anon;
grant execute on function public.admin_create_plan(text, text, numeric, int, text, int, boolean, jsonb, boolean, int) to authenticated;
grant execute on function public.admin_update_plan(uuid, text, text, numeric, int, text, int, boolean, jsonb, boolean, int) to authenticated;
