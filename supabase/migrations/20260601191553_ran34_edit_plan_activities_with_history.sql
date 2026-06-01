-- RAN-34: allow editing included plan activities even when a plan has
-- operational history. This updates only plans and plan_activities; it does
-- not delete plans, memberships, payments, students, files or audit logs.

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
  v_activities_changed boolean := false;
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

  v_activities_changed := v_previous_activities is distinct from v_next_activities;

  if v_has_history and (
    v_previous.plan_type is distinct from p_plan_type
    or v_previous.package_class_count is distinct from (
      case when p_plan_type = 'package' then p_package_class_count else null end
    )
  ) then
    insert into public.audit_logs (actor_id, entity_type, entity_id, action, metadata)
    values (
      v_actor,
      'plan',
      p_plan_id,
      'plan.update_blocked',
      jsonb_build_object(
        'reason', 'plan_type_or_package_history',
        'message', 'Plan con membresias o pagos asociados.',
        'old_plan_type', v_previous.plan_type,
        'requested_plan_type', p_plan_type,
        'old_package_class_count', v_previous.package_class_count,
        'requested_package_class_count', p_package_class_count
      )
    );

    raise exception 'Este plan tiene historial operativo. Podes editar sus actividades incluidas, pero no cambiar el tipo de plan o la cantidad del paquete.';
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

  perform private.apply_plan_activity_config(
    v_plan.id,
    v_plan.plan_type,
    coalesce(p_activities, '[]'::jsonb)
  );

  insert into public.audit_logs (actor_id, entity_type, entity_id, action, metadata)
  values (
    v_actor,
    'plan',
    v_plan.id,
    'plan.updated',
    jsonb_build_object(
      'has_history', v_has_history,
      'activities_changed', v_activities_changed,
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
        'max_active_memberships', v_previous.max_active_memberships,
        'activities', v_previous_activities
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
        'max_active_memberships', v_plan.max_active_memberships,
        'activities', v_next_activities
      )
    )
  );

  return jsonb_build_object('action', 'updated', 'plan_id', v_plan.id, 'has_history', v_has_history);
end;
$$;

revoke all on function public.admin_update_plan(uuid, text, text, numeric, int, text, int, boolean, jsonb, boolean, int) from public, anon;
grant execute on function public.admin_update_plan(uuid, text, text, numeric, int, text, int, boolean, jsonb, boolean, int) to authenticated;
