-- RAN-34: persist and show saved fixed schedules by student.
--
-- Safety:
-- - No bookings, payments, students/profiles, memberships, attendance or audit logs are deleted.
-- - Existing reservations are not inferred into fixed schedules.
-- - Deactivating a fixed schedule does not cancel existing reservations.

create table if not exists public.student_fixed_schedules (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles(id) on delete restrict,
  membership_id uuid not null references public.memberships(id) on delete restrict,
  activity_id uuid not null references public.activities(id) on delete restrict,
  weekdays integer[] not null,
  start_time time not null,
  active boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_applied_at timestamptz,
  notes text,
  constraint student_fixed_schedules_weekdays_not_empty check (
    array_length(weekdays, 1) > 0
  ),
  constraint student_fixed_schedules_weekdays_iso check (
    weekdays <@ array[1, 2, 3, 4, 5, 6, 7]
  )
);

create index if not exists student_fixed_schedules_student_id_idx
  on public.student_fixed_schedules(student_id);

create index if not exists student_fixed_schedules_membership_id_idx
  on public.student_fixed_schedules(membership_id);

create index if not exists student_fixed_schedules_active_idx
  on public.student_fixed_schedules(active);

create index if not exists student_fixed_schedules_student_active_idx
  on public.student_fixed_schedules(student_id, active);

create unique index if not exists student_fixed_schedules_active_unique_idx
  on public.student_fixed_schedules(
    student_id,
    membership_id,
    activity_id,
    weekdays,
    start_time
  )
  where active;

alter table public.student_fixed_schedules enable row level security;

drop policy if exists "student_fixed_schedules admin all"
  on public.student_fixed_schedules;

create policy "student_fixed_schedules admin all"
on public.student_fixed_schedules
for all
to authenticated
using (coalesce(private.is_admin(), false))
with check (coalesce(private.is_admin(), false));

grant select, insert, update on public.student_fixed_schedules to authenticated;

drop trigger if exists set_student_fixed_schedules_updated_at
  on public.student_fixed_schedules;

create trigger set_student_fixed_schedules_updated_at
before update on public.student_fixed_schedules
for each row execute function public.set_updated_at();

create or replace function public.admin_list_student_fixed_schedules(
  p_student_id uuid
)
returns table (
  schedule_id uuid,
  student_id uuid,
  membership_id uuid,
  plan_name text,
  activity_name text,
  weekdays integer[],
  weekday_labels text,
  start_time time,
  active boolean,
  membership_start_date date,
  membership_end_date date,
  membership_status public.membership_status,
  last_applied_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_actor uuid := auth.uid();
  v_student public.profiles%rowtype;
begin
  if v_actor is null or not coalesce(private.is_admin(), false) then
    raise exception 'Solo un admin activo puede ver horarios habituales.';
  end if;

  if p_student_id is null then
    raise exception 'Alumno requerido.';
  end if;

  select *
  into v_student
  from public.profiles p
  where p.id = p_student_id
    and p.role = 'student'::public.user_role;

  if not found then
    raise exception 'Alumno no encontrado.';
  end if;

  return query
  select
    sfs.id,
    sfs.student_id,
    sfs.membership_id,
    pl.name,
    a.name,
    sfs.weekdays,
    (
      select string_agg(
        case day_value
          when 1 then 'Lun'
          when 2 then 'Mar'
          when 3 then 'Mie'
          when 4 then 'Jue'
          when 5 then 'Vie'
          when 6 then 'Sab'
          when 7 then 'Dom'
          else day_value::text
        end,
        ', '
        order by day_value
      )
      from unnest(sfs.weekdays) as days(day_value)
    ) as weekday_labels,
    sfs.start_time,
    sfs.active,
    m.start_date,
    m.end_date,
    m.status,
    sfs.last_applied_at,
    sfs.created_at,
    sfs.updated_at
  from public.student_fixed_schedules sfs
  join public.memberships m on m.id = sfs.membership_id
  join public.plans pl on pl.id = m.plan_id
  join public.activities a on a.id = sfs.activity_id
  where sfs.student_id = p_student_id
  order by sfs.active desc, sfs.start_time asc, sfs.created_at desc;
end;
$$;

create or replace function public.admin_bulk_book_fixed_schedule_for_student(
  p_student_id uuid,
  p_membership_id uuid,
  p_weekdays integer[],
  p_start_time time
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_actor uuid := auth.uid();
  v_result jsonb;
  v_weekdays integer[];
  v_activity_id uuid;
begin
  if v_actor is null or not coalesce(private.is_admin(), false) then
    raise exception 'Solo un admin activo puede crear reservas fijas.';
  end if;

  v_result := private.admin_fixed_schedule_summary(
    p_student_id,
    p_membership_id,
    p_weekdays,
    p_start_time,
    true
  );

  v_weekdays := array(
    select value::integer
    from jsonb_array_elements_text(v_result->'weekdays') as weekdays(value)
    order by value::integer
  );

  for v_activity_id in
    select distinct (detail->>'activity_id')::uuid
    from jsonb_array_elements(v_result->'details') as details(detail)
    where detail->>'status' in ('created', 'already_booked')
  loop
    insert into public.student_fixed_schedules (
      student_id,
      membership_id,
      activity_id,
      weekdays,
      start_time,
      active,
      created_by,
      last_applied_at,
      notes
    )
    values (
      p_student_id,
      p_membership_id,
      v_activity_id,
      v_weekdays,
      p_start_time,
      true,
      v_actor,
      now(),
      'Guardado automaticamente al crear reservas fijas desde Admin -> Alumnos.'
    )
    on conflict (
      student_id,
      membership_id,
      activity_id,
      weekdays,
      start_time
    )
    where active
    do update set
      active = true,
      last_applied_at = excluded.last_applied_at,
      notes = excluded.notes,
      updated_at = now();
  end loop;

  return v_result;
end;
$$;

create or replace function public.admin_deactivate_student_fixed_schedule(
  p_schedule_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_actor uuid := auth.uid();
  v_schedule public.student_fixed_schedules%rowtype;
begin
  if v_actor is null or not coalesce(private.is_admin(), false) then
    raise exception 'Solo un admin activo puede desactivar horarios habituales.';
  end if;

  if p_schedule_id is null then
    raise exception 'Horario habitual requerido.';
  end if;

  update public.student_fixed_schedules
  set
    active = false,
    updated_at = now()
  where id = p_schedule_id
  returning * into v_schedule;

  if not found then
    raise exception 'Horario habitual no encontrado.';
  end if;

  insert into public.audit_logs (actor_id, entity_type, entity_id, action, metadata)
  values (
    v_actor,
    'student_fixed_schedule',
    v_schedule.id,
    'student_fixed_schedule.deactivated_by_admin',
    jsonb_build_object(
      'student_id', v_schedule.student_id,
      'membership_id', v_schedule.membership_id,
      'activity_id', v_schedule.activity_id,
      'does_not_cancel_bookings', true
    )
  );

  return jsonb_build_object(
    'schedule_id', v_schedule.id,
    'student_id', v_schedule.student_id,
    'active', v_schedule.active,
    'does_not_cancel_bookings', true
  );
end;
$$;

revoke all on function public.admin_list_student_fixed_schedules(uuid)
  from public, anon;
revoke all on function public.admin_deactivate_student_fixed_schedule(uuid)
  from public, anon;
revoke all on function public.admin_bulk_book_fixed_schedule_for_student(
  uuid,
  uuid,
  integer[],
  time
) from public, anon;

grant execute on function public.admin_list_student_fixed_schedules(uuid)
  to authenticated;
grant execute on function public.admin_deactivate_student_fixed_schedule(uuid)
  to authenticated;
grant execute on function public.admin_bulk_book_fixed_schedule_for_student(
  uuid,
  uuid,
  integer[],
  time
) to authenticated;
