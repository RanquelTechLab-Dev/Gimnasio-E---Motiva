-- RANV2-13: admin CRUD for plans and activities.
-- Admin-only RPCs. Physical deletes are blocked when an entity has operational history.

alter table public.activities
  add column if not exists color_hex text,
  add column if not exists default_capacity int,
  add column if not exists max_capacity int;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'activities_color_hex_check'
      and conrelid = 'public.activities'::regclass
  ) then
    alter table public.activities
      add constraint activities_color_hex_check
      check (color_hex is null or color_hex ~ '^#[0-9A-Fa-f]{6}$');
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'activities_default_capacity_check'
      and conrelid = 'public.activities'::regclass
  ) then
    alter table public.activities
      add constraint activities_default_capacity_check
      check (default_capacity is null or default_capacity > 0);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'activities_max_capacity_check'
      and conrelid = 'public.activities'::regclass
  ) then
    alter table public.activities
      add constraint activities_max_capacity_check
      check (max_capacity is null or max_capacity > 0);
  end if;
end $$;

update public.activities
set
  max_capacity = 1,
  default_capacity = coalesce(default_capacity, 1),
  updated_at = now()
where slug = 'personalizado_1_1'
  and (max_capacity is distinct from 1 or default_capacity is distinct from 1);

create or replace function private.slugify_basic(p_value text)
returns text
language plpgsql
immutable
set search_path = public, private
as $$
declare
  v_slug text;
begin
  v_slug := lower(btrim(coalesce(p_value, '')));
  v_slug := translate(
    v_slug,
    'áàäâãéèëêíìïîóòöôõúùüûñç',
    'aaaaaeeeeiiiiooooouuuunc'
  );
  v_slug := regexp_replace(v_slug, '[^a-z0-9]+', '_', 'g');
  v_slug := regexp_replace(v_slug, '^_+|_+$', '', 'g');

  if v_slug = '' then
    raise exception 'No se pudo generar un identificador valido.';
  end if;

  return v_slug;
end;
$$;

create or replace function private.unique_plan_slug(p_name text, p_plan_id uuid default null)
returns text
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_base text := private.slugify_basic(p_name);
  v_slug text := v_base;
  v_counter int := 2;
begin
  while exists (
    select 1
    from public.plans p
    where p.slug = v_slug
      and (p_plan_id is null or p.id <> p_plan_id)
  ) loop
    v_slug := v_base || '_' || v_counter::text;
    v_counter := v_counter + 1;
  end loop;

  return v_slug;
end;
$$;

create or replace function private.unique_activity_slug(p_name text, p_activity_id uuid default null)
returns text
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_base text := private.slugify_basic(p_name);
  v_slug text := v_base;
  v_counter int := 2;
begin
  while exists (
    select 1
    from public.activities a
    where a.slug = v_slug
      and (p_activity_id is null or a.id <> p_activity_id)
  ) loop
    v_slug := v_base || '_' || v_counter::text;
    v_counter := v_counter + 1;
  end loop;

  return v_slug;
end;
$$;

create or replace function private.apply_plan_activity_config(
  p_plan_id uuid,
  p_plan_type text,
  p_activities jsonb
)
returns void
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_item jsonb;
  v_activity_id uuid;
  v_weekly_limit int;
  v_monthly_credits int;
  v_count int := 0;
begin
  if p_activities is null or jsonb_typeof(p_activities) <> 'array' then
    raise exception 'Las actividades del plan deben enviarse como lista.';
  end if;

  for v_item in select * from jsonb_array_elements(p_activities) loop
    v_activity_id := nullif(v_item->>'activity_id', '')::uuid;

    if v_activity_id is null then
      raise exception 'Cada actividad del plan debe tener activity_id.';
    end if;

    if not exists (
      select 1 from public.activities a where a.id = v_activity_id
    ) then
      raise exception 'La actividad indicada no existe.';
    end if;

    if p_plan_type = 'weekly' then
      v_weekly_limit := nullif(v_item->>'weekly_class_limit', '')::int;
      v_monthly_credits := null;

      if v_weekly_limit is null or v_weekly_limit <= 0 then
        raise exception 'Los planes semanales requieren limite semanal mayor a cero por actividad.';
      end if;
    elsif p_plan_type = 'package' then
      v_weekly_limit := null;
      v_monthly_credits := nullif(v_item->>'monthly_credits', '')::int;
    else
      v_weekly_limit := null;
      v_monthly_credits := nullif(v_item->>'monthly_credits', '')::int;
    end if;

    insert into public.plan_activities (
      plan_id,
      activity_id,
      monthly_credits,
      weekly_class_limit
    )
    values (
      p_plan_id,
      v_activity_id,
      v_monthly_credits,
      v_weekly_limit
    )
    on conflict (plan_id, activity_id) do update
    set
      monthly_credits = excluded.monthly_credits,
      weekly_class_limit = excluded.weekly_class_limit;

    v_count := v_count + 1;
  end loop;

  if p_plan_type = 'weekly' and v_count = 0 then
    raise exception 'Los planes semanales requieren al menos una actividad.';
  end if;

  delete from public.plan_activities pa
  where pa.plan_id = p_plan_id
    and not exists (
      select 1
      from jsonb_array_elements(p_activities) item
      where nullif(item->>'activity_id', '')::uuid = pa.activity_id
    );
end;
$$;

create or replace function public.admin_create_plan(
  p_name text,
  p_description text,
  p_price numeric,
  p_billing_period_days int,
  p_plan_type text,
  p_package_class_count int,
  p_active boolean,
  p_activities jsonb
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

  v_slug := private.unique_plan_slug(p_name);

  insert into public.plans (
    name,
    slug,
    description,
    price,
    billing_period_days,
    plan_type,
    package_class_count,
    active
  )
  values (
    btrim(p_name),
    v_slug,
    nullif(btrim(coalesce(p_description, '')), ''),
    p_price,
    p_billing_period_days,
    p_plan_type,
    case when p_plan_type = 'package' then p_package_class_count else null end,
    coalesce(p_active, true)
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
      'package_class_count', v_plan.package_class_count
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
  p_activities jsonb
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
        'active', v_previous.active
      ),
      'new', jsonb_build_object(
        'name', v_plan.name,
        'slug', v_plan.slug,
        'description', v_plan.description,
        'price', v_plan.price,
        'billing_period_days', v_plan.billing_period_days,
        'plan_type', v_plan.plan_type,
        'package_class_count', v_plan.package_class_count,
        'active', v_plan.active
      )
    )
  );

  return jsonb_build_object('action', 'updated', 'plan_id', v_plan.id, 'has_history', v_has_history);
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

  if p_default_capacity is not null and p_max_capacity is not null and p_default_capacity > p_max_capacity then
    raise exception 'El cupo por defecto no puede superar el cupo maximo.';
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

  if p_default_capacity is not null and p_max_capacity is not null and p_default_capacity > p_max_capacity then
    raise exception 'El cupo por defecto no puede superar el cupo maximo.';
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
    default_capacity = p_default_capacity,
    max_capacity = p_max_capacity,
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

create or replace function public.admin_archive_activity(p_activity_id uuid)
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

  select * into v_activity
  from public.activities a
  where a.id = p_activity_id
  for update;

  if not found then
    raise exception 'No se encontro la actividad.';
  end if;

  update public.activities a
  set active = false,
      updated_at = now()
  where a.id = p_activity_id;

  insert into public.audit_logs (actor_id, entity_type, entity_id, action, metadata)
  values (
    v_actor,
    'activity',
    p_activity_id,
    'activity.archived',
    jsonb_build_object('name', v_activity.name, 'slug', v_activity.slug)
  );

  return jsonb_build_object('action', 'archived', 'activity_id', p_activity_id);
end;
$$;

create or replace function public.admin_delete_activity(p_activity_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_actor uuid;
  v_activity public.activities%rowtype;
  v_usage integer;
begin
  v_actor := private.ensure_admin();

  select * into v_activity
  from public.activities a
  where a.id = p_activity_id
  for update;

  if not found then
    raise exception 'No se encontro la actividad.';
  end if;

  select (
    (select count(*) from public.plan_activities pa where pa.activity_id = p_activity_id)
    + (select count(*) from public.class_sessions s where s.activity_id = p_activity_id)
    + (select count(*)
       from public.bookings b
       join public.class_sessions s on s.id = b.session_id
       where s.activity_id = p_activity_id)
    + (select count(*)
       from public.attendance att
       join public.class_sessions s on s.id = att.session_id
       where s.activity_id = p_activity_id)
  ) into v_usage;

  if v_usage > 0 then
    raise exception 'Esta actividad tiene historial o esta vinculada a planes. No se puede eliminar, pero podes archivarla.';
  end if;

  delete from public.activities a
  where a.id = p_activity_id;

  insert into public.audit_logs (actor_id, entity_type, entity_id, action, metadata)
  values (
    v_actor,
    'activity',
    p_activity_id,
    'activity.deleted',
    jsonb_build_object('name', v_activity.name, 'slug', v_activity.slug)
  );

  return jsonb_build_object('action', 'deleted', 'activity_id', p_activity_id);
end;
$$;

create or replace function private.enforce_personalized_session_capacity()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_activity public.activities%rowtype;
begin
  select * into v_activity
  from public.activities a
  where a.id = new.activity_id;

  if v_activity.max_capacity is not null and new.capacity > v_activity.max_capacity then
    raise exception 'La actividad permite maximo % alumno(s).', v_activity.max_capacity;
  end if;

  if v_activity.slug = 'personalizado_1_1' and new.capacity > 1 then
    raise exception 'Personalizado 1:1 permite maximo 1 alumno.';
  end if;

  return new;
end;
$$;

revoke all on function private.slugify_basic(text) from public, anon;
revoke all on function private.unique_plan_slug(text, uuid) from public, anon;
revoke all on function private.unique_activity_slug(text, uuid) from public, anon;
revoke all on function private.apply_plan_activity_config(uuid, text, jsonb) from public, anon;

revoke all on function public.admin_create_plan(text, text, numeric, int, text, int, boolean, jsonb) from public, anon;
revoke all on function public.admin_update_plan(uuid, text, text, numeric, int, text, int, boolean, jsonb) from public, anon;
revoke all on function public.admin_create_activity(text, text, boolean, boolean, boolean, text, int, int) from public, anon;
revoke all on function public.admin_update_activity(uuid, text, text, boolean, boolean, boolean, text, int, int) from public, anon;
revoke all on function public.admin_archive_activity(uuid) from public, anon;
revoke all on function public.admin_delete_activity(uuid) from public, anon;

grant execute on function public.admin_create_plan(text, text, numeric, int, text, int, boolean, jsonb) to authenticated;
grant execute on function public.admin_update_plan(uuid, text, text, numeric, int, text, int, boolean, jsonb) to authenticated;
grant execute on function public.admin_create_activity(text, text, boolean, boolean, boolean, text, int, int) to authenticated;
grant execute on function public.admin_update_activity(uuid, text, text, boolean, boolean, boolean, text, int, int) to authenticated;
grant execute on function public.admin_archive_activity(uuid) to authenticated;
grant execute on function public.admin_delete_activity(uuid) to authenticated;
