create or replace function private.require_exact_confirmation(
  p_value text,
  p_expected text,
  p_action text default 'confirmar esta accion'
)
returns void
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if coalesce(btrim(p_value), '') <> p_expected then
    raise exception 'Para % debes escribir exactamente: %', p_action, p_expected;
  end if;
end;
$$;

revoke all on function private.require_exact_confirmation(text, text, text)
from public, anon;
grant execute on function private.require_exact_confirmation(text, text, text)
to authenticated;

create or replace function public.admin_preview_delete_student(p_profile_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_actor uuid;
  v_profile public.profiles%rowtype;
  v_memberships_count integer := 0;
  v_payments_count integer := 0;
  v_bookings_count integer := 0;
  v_attendance_count integer := 0;
  v_files_count integer := 0;
  v_training_notes_count integer := 0;
  v_fixed_schedules_count integer := 0;
  v_drive_file_ids text[] := '{}';
  v_warnings text[] := '{}';
begin
  v_actor := private.ensure_admin();

  select *
  into v_profile
  from public.profiles p
  where p.id = p_profile_id
  for update;

  if not found then
    raise exception 'No se encontro el alumno.';
  end if;

  if v_profile.id = v_actor then
    raise exception 'No podes eliminar tu propio usuario desde esta accion.';
  end if;

  if v_profile.role <> 'student' then
    raise exception 'Solo se pueden eliminar perfiles de alumno.';
  end if;

  select count(*)::int
  into v_memberships_count
  from public.memberships
  where student_id = p_profile_id;

  select count(*)::int
  into v_payments_count
  from public.payments
  where student_id = p_profile_id;

  select count(*)::int
  into v_bookings_count
  from public.bookings
  where student_id = p_profile_id;

  select count(*)::int
  into v_attendance_count
  from public.attendance
  where student_id = p_profile_id;

  select count(*)::int,
         coalesce(array_agg(f.drive_file_id) filter (where f.drive_file_id is not null), '{}')
  into v_files_count, v_drive_file_ids
  from public.files f
  where f.student_id = p_profile_id;

  select count(*)::int
  into v_training_notes_count
  from public.training_notes
  where student_id = p_profile_id;

  select count(*)::int
  into v_fixed_schedules_count
  from public.student_fixed_schedules
  where student_id = p_profile_id;

  if array_length(v_drive_file_ids, 1) > 0 then
    v_warnings := array_append(
      v_warnings,
      'Este alumno tiene archivos de Drive asociados. La Edge Function debe borrarlos antes del delete DB.'
    );
  end if;

  return jsonb_build_object(
    'ok', true,
    'action', 'preview_delete_student',
    'affected', jsonb_build_object(
      'memberships', v_memberships_count,
      'payments', v_payments_count,
      'bookings', v_bookings_count,
      'attendance', v_attendance_count,
      'files', v_files_count,
      'training_notes', v_training_notes_count,
      'fixed_schedules', v_fixed_schedules_count
    ),
    'warnings', to_jsonb(v_warnings),
    'details', jsonb_build_object(
      'student_id', v_profile.id,
      'email', v_profile.email,
      'role', v_profile.role,
      'full_name', trim(concat_ws(' ', v_profile.first_name, v_profile.last_name)),
      'active', v_profile.active,
      'drive_file_ids', to_jsonb(v_drive_file_ids),
      'confirmation_required', 'ELIMINAR ALUMNO DEFINITIVAMENTE'
    )
  );
end;
$$;

create or replace function public.admin_delete_student_database(
  p_profile_id uuid,
  p_confirm text
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_actor uuid;
  v_profile public.profiles%rowtype;
  v_deleted_attendance integer := 0;
  v_deleted_bookings integer := 0;
  v_deleted_fixed_schedules integer := 0;
  v_deleted_training_notes integer := 0;
  v_deleted_files integer := 0;
  v_deleted_payments integer := 0;
  v_deleted_memberships integer := 0;
  v_deleted_profiles integer := 0;
  v_drive_file_ids text[] := '{}';
begin
  v_actor := private.ensure_admin();

  select *
  into v_profile
  from public.profiles p
  where p.id = p_profile_id
  for update;

  if not found then
    raise exception 'No se encontro el alumno.';
  end if;

  if v_profile.id = v_actor then
    raise exception 'No podes eliminar tu propio usuario desde esta accion.';
  end if;

  if v_profile.role <> 'student' then
    raise exception 'Solo se pueden eliminar perfiles de alumno.';
  end if;

  perform private.require_exact_confirmation(
    p_confirm,
    'ELIMINAR ALUMNO DEFINITIVAMENTE',
    'eliminar el alumno definitivamente'
  );

  select coalesce(array_agg(f.drive_file_id) filter (where f.drive_file_id is not null), '{}')
  into v_drive_file_ids
  from public.files f
  where f.student_id = p_profile_id;

  insert into public.audit_logs (actor_id, entity_type, entity_id, action, metadata)
  values (
    v_actor,
    'student',
    p_profile_id,
    'student.deleted_definitive',
    jsonb_build_object(
      'had_drive_files', coalesce(array_length(v_drive_file_ids, 1), 0) > 0,
      'drive_file_ids', to_jsonb(v_drive_file_ids)
    )
  );

  delete from public.attendance
  where student_id = p_profile_id;
  get diagnostics v_deleted_attendance = row_count;

  delete from public.bookings
  where student_id = p_profile_id;
  get diagnostics v_deleted_bookings = row_count;

  delete from public.student_fixed_schedules
  where student_id = p_profile_id;
  get diagnostics v_deleted_fixed_schedules = row_count;

  delete from public.training_notes
  where student_id = p_profile_id;
  get diagnostics v_deleted_training_notes = row_count;

  delete from public.files
  where student_id = p_profile_id;
  get diagnostics v_deleted_files = row_count;

  delete from public.payments
  where student_id = p_profile_id;
  get diagnostics v_deleted_payments = row_count;

  delete from public.memberships
  where student_id = p_profile_id;
  get diagnostics v_deleted_memberships = row_count;

  delete from public.profiles
  where id = p_profile_id;
  get diagnostics v_deleted_profiles = row_count;

  return jsonb_build_object(
    'ok', true,
    'action', 'deleted',
    'student_id', p_profile_id,
    'affected', jsonb_build_object(
      'attendance', v_deleted_attendance,
      'bookings', v_deleted_bookings,
      'fixed_schedules', v_deleted_fixed_schedules,
      'training_notes', v_deleted_training_notes,
      'files', v_deleted_files,
      'payments', v_deleted_payments,
      'memberships', v_deleted_memberships,
      'profiles', v_deleted_profiles
    ),
    'warnings', jsonb_build_array(),
    'details', jsonb_build_object(
      'drive_file_ids', to_jsonb(v_drive_file_ids),
      'auth_user_cleanup_required', true
    )
  );
end;
$$;

create or replace function public.admin_preview_delete_payment(p_payment_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_actor uuid;
  v_payment public.payments%rowtype;
  v_membership public.memberships%rowtype;
  v_profile public.profiles%rowtype;
  v_required_amount numeric(12, 2) := 0;
  v_approved_paid_total numeric(12, 2) := 0;
  v_approved_without_payment numeric(12, 2) := 0;
  v_future_bookings_to_cancel integer := 0;
  v_warnings text[] := '{}';
begin
  v_actor := private.ensure_admin();

  select *
  into v_payment
  from public.payments p
  where p.id = p_payment_id
  for update;

  if not found then
    raise exception 'No se encontro el pago.';
  end if;

  select *
  into v_profile
  from public.profiles p
  where p.id = v_payment.student_id;

  if v_payment.membership_id is not null then
    select *
    into v_membership
    from public.memberships m
    where m.id = v_payment.membership_id;

    if found then
      v_required_amount := private.membership_required_amount(v_membership.id);
      v_approved_paid_total := private.membership_approved_paid_total(v_membership.id);
      v_approved_without_payment := greatest(
        v_approved_paid_total - case
          when v_payment.status = 'approved'::public.payment_status then v_payment.amount
          else 0
        end,
        0
      )::numeric(12, 2);

      if v_payment.status = 'approved'::public.payment_status
        and v_approved_without_payment < v_required_amount then
        select count(*)::int
        into v_future_bookings_to_cancel
        from public.bookings b
        join public.class_sessions s on s.id = b.session_id
        where b.membership_id = v_membership.id
          and b.status = 'booked'::public.booking_status
          and s.starts_at >= now();

        if v_future_bookings_to_cancel > 0 then
          v_warnings := array_append(
            v_warnings,
            'Si se elimina este pago, el programa puede quedar suspendido y cancelar reservas futuras activas.'
          );
        end if;
      end if;
    end if;
  end if;

  return jsonb_build_object(
    'ok', true,
    'action', 'preview_delete_payment',
    'affected', jsonb_build_object(
      'future_active_bookings_to_cancel', v_future_bookings_to_cancel
    ),
    'warnings', to_jsonb(v_warnings),
    'details', jsonb_build_object(
      'payment_id', v_payment.id,
      'student_id', v_payment.student_id,
      'student_email', v_profile.email,
      'membership_id', v_payment.membership_id,
      'amount', v_payment.amount,
      'status', v_payment.status,
      'method', v_payment.method,
      'paid_at', v_payment.paid_at,
      'required_amount', nullif(v_required_amount, 0),
      'approved_paid_total', v_approved_paid_total,
      'approved_without_payment', v_approved_without_payment,
      'confirmation_required', 'ELIMINAR PAGO'
    )
  );
end;
$$;

create or replace function public.admin_delete_payment_definitive(
  p_payment_id uuid,
  p_confirm text
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_actor uuid;
  v_payment public.payments%rowtype;
  v_membership_id uuid;
  v_deleted integer := 0;
  v_reconcile jsonb := jsonb_build_object('action', 'skipped', 'reason', 'no_membership');
begin
  v_actor := private.ensure_admin();

  select *
  into v_payment
  from public.payments p
  where p.id = p_payment_id
  for update;

  if not found then
    raise exception 'No se encontro el pago.';
  end if;

  perform private.require_exact_confirmation(
    p_confirm,
    'ELIMINAR PAGO',
    'eliminar el pago'
  );

  v_membership_id := v_payment.membership_id;

  insert into public.audit_logs (actor_id, entity_type, entity_id, action, metadata)
  values (
    v_actor,
    'payment',
    v_payment.id,
    'payment.deleted_definitive',
    jsonb_build_object(
      'student_id', v_payment.student_id,
      'membership_id', v_payment.membership_id,
      'amount', v_payment.amount,
      'status', v_payment.status,
      'method', v_payment.method,
      'paid_at', v_payment.paid_at
    )
  );

  delete from public.payments
  where id = p_payment_id;
  get diagnostics v_deleted = row_count;

  if v_membership_id is not null then
    v_reconcile := private.reconcile_membership_payment_state(
      v_membership_id,
      v_actor,
      'Pago eliminado definitivamente por administracion.'
    );
  end if;

  return jsonb_build_object(
    'ok', true,
    'action', 'deleted',
    'payment_id', p_payment_id,
    'membership_id', v_membership_id,
    'affected', jsonb_build_object('payments', v_deleted),
    'warnings', case
      when (v_reconcile ->> 'current_status') = 'suspended' then
        jsonb_build_array('El programa quedo suspendido despues de eliminar el pago.')
      else
        jsonb_build_array()
    end,
    'details', jsonb_build_object(
      'reconcile', v_reconcile
    )
  );
end;
$$;

create or replace function public.admin_preview_delete_class_session(p_session_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_actor uuid;
  v_session public.class_sessions%rowtype;
  v_activity public.activities%rowtype;
  v_bookings_count integer := 0;
  v_attendance_count integer := 0;
  v_confirmation text := 'ELIMINAR';
  v_warnings text[] := '{}';
begin
  v_actor := private.ensure_admin();

  select *
  into v_session
  from public.class_sessions s
  where s.id = p_session_id
  for update;

  if not found then
    raise exception 'No se encontro la clase.';
  end if;

  select *
  into v_activity
  from public.activities a
  where a.id = v_session.activity_id;

  select count(*)::int
  into v_bookings_count
  from public.bookings
  where session_id = p_session_id;

  select count(*)::int
  into v_attendance_count
  from public.attendance
  where session_id = p_session_id;

  if v_bookings_count + v_attendance_count > 0 then
    v_confirmation := 'ELIMINAR CLASE Y RESERVAS';
    v_warnings := array_append(
      v_warnings,
      'Esta accion eliminara reservas y asistencia relacionadas con esta clase.'
    );
  end if;

  if v_session.recurring_rule_id is not null then
    v_warnings := array_append(
      v_warnings,
      'Como la clase pertenece a un horario recurrente, se registrara una excepcion para que no reaparezca.'
    );
  end if;

  return jsonb_build_object(
    'ok', true,
    'action', 'preview_delete_class_session',
    'affected', jsonb_build_object(
      'bookings', v_bookings_count,
      'attendance', v_attendance_count
    ),
    'warnings', to_jsonb(v_warnings),
    'details', jsonb_build_object(
      'session_id', v_session.id,
      'activity_id', v_session.activity_id,
      'activity_name', v_activity.name,
      'starts_at', v_session.starts_at,
      'ends_at', v_session.ends_at,
      'capacity', v_session.capacity,
      'recurring_rule_id', v_session.recurring_rule_id,
      'active', v_session.active,
      'cancelled_at', v_session.cancelled_at,
      'confirmation_required', v_confirmation
    )
  );
end;
$$;

create or replace function public.admin_delete_class_session_definitive(
  p_session_id uuid,
  p_confirm text
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_actor uuid;
  v_session public.class_sessions%rowtype;
  v_bookings_count integer := 0;
  v_attendance_count integer := 0;
  v_deleted_attendance integer := 0;
  v_deleted_bookings integer := 0;
  v_deleted_sessions integer := 0;
  v_confirmation text := 'ELIMINAR';
begin
  v_actor := private.ensure_admin();

  select *
  into v_session
  from public.class_sessions s
  where s.id = p_session_id
  for update;

  if not found then
    raise exception 'No se encontro la clase.';
  end if;

  select count(*)::int
  into v_bookings_count
  from public.bookings
  where session_id = p_session_id;

  select count(*)::int
  into v_attendance_count
  from public.attendance
  where session_id = p_session_id;

  if v_bookings_count + v_attendance_count > 0 then
    v_confirmation := 'ELIMINAR CLASE Y RESERVAS';
  end if;

  perform private.require_exact_confirmation(
    p_confirm,
    v_confirmation,
    'eliminar la clase definitivamente'
  );

  if v_session.recurring_rule_id is not null then
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
      'cancelled',
      null,
      v_actor
    )
    on conflict (
      recurring_rule_id,
      occurrence_starts_at,
      occurrence_ends_at
    )
    do update
    set action = excluded.action,
        class_session_id = null,
        created_by = excluded.created_by;
  end if;

  insert into public.audit_logs (actor_id, entity_type, entity_id, action, metadata)
  values (
    v_actor,
    'class_session',
    v_session.id,
    'class.deleted_definitive',
    jsonb_build_object(
      'activity_id', v_session.activity_id,
      'starts_at', v_session.starts_at,
      'ends_at', v_session.ends_at,
      'capacity', v_session.capacity,
      'recurring_rule_id', v_session.recurring_rule_id,
      'bookings_count', v_bookings_count,
      'attendance_count', v_attendance_count
    )
  );

  delete from public.attendance
  where session_id = p_session_id;
  get diagnostics v_deleted_attendance = row_count;

  delete from public.bookings
  where session_id = p_session_id;
  get diagnostics v_deleted_bookings = row_count;

  delete from public.class_sessions
  where id = p_session_id;
  get diagnostics v_deleted_sessions = row_count;

  return jsonb_build_object(
    'ok', true,
    'action', 'deleted',
    'session_id', p_session_id,
    'affected', jsonb_build_object(
      'attendance', v_deleted_attendance,
      'bookings', v_deleted_bookings,
      'class_sessions', v_deleted_sessions
    ),
    'warnings', jsonb_build_array(),
    'details', jsonb_build_object(
      'recurring_exception_created', v_session.recurring_rule_id is not null
    )
  );
end;
$$;

create or replace function public.admin_delete_student_file_metadata_definitive(
  p_file_id uuid,
  p_confirm text
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_actor uuid;
  v_file public.files%rowtype;
  v_deleted integer := 0;
begin
  v_actor := private.ensure_admin();

  select *
  into v_file
  from public.files f
  where f.id = p_file_id
  for update;

  if not found then
    raise exception 'No se encontro el archivo.';
  end if;

  perform private.require_exact_confirmation(
    p_confirm,
    'ELIMINAR ARCHIVO',
    'eliminar el archivo'
  );

  insert into public.audit_logs (actor_id, entity_type, entity_id, action, metadata)
  values (
    v_actor,
    'file',
    v_file.id,
    'file.deleted_definitive',
    jsonb_build_object(
      'student_id', v_file.student_id,
      'title', v_file.title,
      'kind', v_file.kind,
      'drive_file_id', v_file.drive_file_id
    )
  );

  delete from public.files
  where id = p_file_id;
  get diagnostics v_deleted = row_count;

  return jsonb_build_object(
    'ok', true,
    'action', 'deleted',
    'affected', jsonb_build_object('files', v_deleted),
    'details', jsonb_build_object(
      'file_id', p_file_id,
      'student_id', v_file.student_id
    )
  );
end;
$$;

create or replace function public.admin_preview_demo_cleanup()
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_actor uuid;
  v_deletable jsonb := '[]'::jsonb;
  v_blocked jsonb := '[]'::jsonb;
begin
  v_actor := private.ensure_admin();

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', p.id,
        'email', p.email,
        'full_name', trim(concat_ws(' ', p.first_name, p.last_name)),
        'role', p.role
      )
      order by p.created_at
    ),
    '[]'::jsonb
  )
  into v_deletable
  from public.profiles p
  where p.role = 'student'
    and lower(coalesce(p.email, '')) in ('ranqueltechlab@gmail.com');

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', p.id,
        'email', p.email,
        'full_name', trim(concat_ws(' ', p.first_name, p.last_name)),
        'role', p.role
      )
      order by p.created_at
    ),
    '[]'::jsonb
  )
  into v_blocked
  from public.profiles p
  where p.role = 'student'
    and lower(coalesce(p.email, '')) not in ('ranqueltechlab@gmail.com');

  return jsonb_build_object(
    'ok', jsonb_array_length(v_blocked) = 0,
    'action', 'preview_demo_cleanup',
    'affected', jsonb_build_object(
      'deletable_profiles', jsonb_array_length(v_deletable),
      'blocked_profiles', jsonb_array_length(v_blocked)
    ),
    'warnings', case
      when jsonb_array_length(v_blocked) > 0 then
        jsonb_build_array(
          'La limpieza demo esta bloqueada porque hay perfiles de alumno fuera de la allowlist.'
        )
      else
        jsonb_build_array(
          'La limpieza demo definitiva de Drive/Auth debe orquestarse desde la app admin.'
        )
    end,
    'details', jsonb_build_object(
      'protected_admin_email', 'e.motiva.gym@gmail.com',
      'deletable_profiles', v_deletable,
      'blocked_profiles', v_blocked,
      'confirmation_required', 'ELIMINAR DEMO'
    )
  );
end;
$$;

create or replace function public.admin_execute_demo_cleanup(p_confirm text)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_actor uuid;
  v_preview jsonb;
  v_profile record;
  v_deleted_count integer := 0;
  v_deleted_ids uuid[] := '{}';
begin
  v_actor := private.ensure_admin();

  perform private.require_exact_confirmation(
    p_confirm,
    'ELIMINAR DEMO',
    'ejecutar la limpieza demo'
  );

  v_preview := public.admin_preview_demo_cleanup();

  if coalesce((v_preview ->> 'ok')::boolean, false) is false then
    raise exception 'La limpieza demo esta bloqueada hasta revisar perfiles fuera de la allowlist.';
  end if;

  for v_profile in
    select p.id
    from public.profiles p
    where p.role = 'student'
      and lower(coalesce(p.email, '')) in ('ranqueltechlab@gmail.com')
  loop
    perform public.admin_delete_student_database(
      v_profile.id,
      'ELIMINAR ALUMNO DEFINITIVAMENTE'
    );
    v_deleted_count := v_deleted_count + 1;
    v_deleted_ids := array_append(v_deleted_ids, v_profile.id);
  end loop;

  return jsonb_build_object(
    'ok', true,
    'action', 'executed_demo_cleanup',
    'affected', jsonb_build_object('deleted_profiles', v_deleted_count),
    'warnings', jsonb_build_array(
      'La limpieza demo por SQL no elimina usuarios Auth ni archivos en Drive. Usa la app admin para el flujo completo.'
    ),
    'details', jsonb_build_object(
      'deleted_profile_ids', to_jsonb(v_deleted_ids)
    )
  );
end;
$$;

revoke all on function public.admin_preview_delete_student(uuid) from public, anon;
revoke all on function public.admin_delete_student_database(uuid, text) from public, anon;
revoke all on function public.admin_preview_delete_payment(uuid) from public, anon;
revoke all on function public.admin_delete_payment_definitive(uuid, text) from public, anon;
revoke all on function public.admin_preview_delete_class_session(uuid) from public, anon;
revoke all on function public.admin_delete_class_session_definitive(uuid, text) from public, anon;
revoke all on function public.admin_delete_student_file_metadata_definitive(uuid, text) from public, anon;
revoke all on function public.admin_preview_demo_cleanup() from public, anon;
revoke all on function public.admin_execute_demo_cleanup(text) from public, anon;

grant execute on function public.admin_preview_delete_student(uuid) to authenticated;
grant execute on function public.admin_delete_student_database(uuid, text) to authenticated;
grant execute on function public.admin_preview_delete_payment(uuid) to authenticated;
grant execute on function public.admin_delete_payment_definitive(uuid, text) to authenticated;
grant execute on function public.admin_preview_delete_class_session(uuid) to authenticated;
grant execute on function public.admin_delete_class_session_definitive(uuid, text) to authenticated;
grant execute on function public.admin_delete_student_file_metadata_definitive(uuid, text) to authenticated;
grant execute on function public.admin_preview_demo_cleanup() to authenticated;
grant execute on function public.admin_execute_demo_cleanup(text) to authenticated;
