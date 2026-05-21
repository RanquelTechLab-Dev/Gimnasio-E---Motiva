-- RANV2-13 demo cleanup.
-- Walter authorized removing the remaining test student before Carolina demo.
-- Preserve the real admin Auth user/profile and keep catalog/schedule data.

do $$
declare
  v_admin_id uuid;
  v_profile_count int;
  v_deleted_profiles int := 0;
begin
  select id into v_admin_id
  from public.profiles
  where email = 'e.motiva.gym@gmail.com'
    and role = 'admin'
    and active = true;

  if v_admin_id is null then
    raise exception 'Demo cleanup abortado: no existe admin activo e.motiva.gym@gmail.com.';
  end if;

  select count(*) into v_profile_count
  from public.profiles;

  if v_profile_count > 2 then
    raise exception 'Demo cleanup abortado: hay % perfiles. Solo esta autorizado para admin y alumno de prueba.', v_profile_count;
  end if;

  delete from public.attendance;
  delete from public.bookings;
  delete from public.payments;
  delete from public.memberships;
  delete from public.files;
  delete from public.training_notes;

  delete from auth.users au
  using public.profiles p
  where au.id = p.id
    and p.email <> 'e.motiva.gym@gmail.com';

  get diagnostics v_deleted_profiles = row_count;

  delete from public.profiles
  where email <> 'e.motiva.gym@gmail.com';

  update public.profiles
  set
    active = true,
    last_payment_at = null,
    last_real_activity_at = null,
    updated_at = now()
  where id = v_admin_id;

  insert into public.audit_logs (actor_id, entity_type, entity_id, action, metadata)
  values (
    v_admin_id,
    'system',
    null,
    'demo_clean_only_admin',
    jsonb_build_object(
      'preserved_admin_email', 'e.motiva.gym@gmail.com',
      'deleted_test_auth_users', v_deleted_profiles,
      'preserved_catalog_schedule', true
    )
  );
end $$;
