-- RANV2-13: admin calendar fixes.
-- Fixes class cancellation ambiguity without touching weekly plan limit logic.

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

drop trigger if exists class_sessions_personalized_capacity_guard on public.class_sessions;

create trigger class_sessions_personalized_capacity_guard
before insert or update of activity_id, capacity on public.class_sessions
for each row
execute function private.enforce_personalized_session_capacity();

create or replace function public.cancel_class_session(
  session_id uuid,
  reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_session public.class_sessions%rowtype;
  v_actor uuid := auth.uid();
  v_cancelled_count integer := 0;
  v_cancelled_at timestamptz := now();
  v_reason text := nullif(btrim(coalesce(cancel_class_session.reason, '')), '');
begin
  if v_actor is null or not private.is_admin() then
    raise exception 'Solo un admin activo puede cancelar clases.';
  end if;

  select * into v_session
  from public.class_sessions s
  where s.id = cancel_class_session.session_id
  for update;

  if not found then
    raise exception 'La clase no existe.';
  end if;

  if v_session.cancelled_at is not null then
    raise exception 'La clase ya esta cancelada.';
  end if;

  update public.memberships m
  set
    remaining_credits = m.remaining_credits + b.credits_charged,
    updated_at = now()
  from public.bookings b
  where b.session_id = cancel_class_session.session_id
    and b.status = 'booked'
    and b.credits_charged > 0
    and b.credit_returned_at is null
    and b.membership_id = m.id
    and m.remaining_credits is not null;

  update public.bookings b
  set
    status = 'cancelled',
    cancelled_at = v_cancelled_at,
    cancelled_by = v_actor,
    cancel_reason = v_reason,
    credit_returned_at = case
      when b.credits_charged > 0 and b.credit_returned_at is null then v_cancelled_at
      else b.credit_returned_at
    end,
    updated_at = now()
  where b.session_id = cancel_class_session.session_id
    and b.status = 'booked';

  get diagnostics v_cancelled_count = row_count;

  update public.class_sessions s
  set
    active = false,
    cancelled_at = v_cancelled_at,
    cancelled_by = v_actor,
    cancel_reason = v_reason,
    updated_at = now()
  where s.id = cancel_class_session.session_id
  returning * into v_session;

  insert into public.audit_logs (actor_id, entity_type, entity_id, action, metadata)
  values (
    v_actor,
    'class_session',
    v_session.id,
    'class.cancelled',
    jsonb_build_object(
      'reason', v_reason,
      'cancelled_bookings', v_cancelled_count
    )
  );

  insert into public.audit_logs (actor_id, entity_type, entity_id, action, metadata)
  select
    v_actor,
    'booking',
    b.id,
    'booking.cancelled',
    jsonb_build_object(
      'session_id', b.session_id,
      'student_id', b.student_id,
      'membership_id', b.membership_id,
      'classes_charged', b.credits_charged,
      'class_returned', b.credit_returned_at is not null,
      'reason', v_reason,
      'source', 'class.cancelled'
    )
  from public.bookings b
  where b.session_id = cancel_class_session.session_id
    and b.cancelled_by = v_actor
    and b.cancelled_at = v_cancelled_at;

  return jsonb_build_object(
    'session_id', v_session.id,
    'cancelled_bookings', v_cancelled_count
  );
end;
$$;

revoke all on function public.cancel_class_session(uuid, text) from public, anon;
grant execute on function public.cancel_class_session(uuid, text) to authenticated;
