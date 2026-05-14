create extension if not exists pgcrypto with schema extensions;

do $$
begin
  create type public.user_role as enum ('admin', 'student');
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type public.membership_status as enum ('active', 'suspended', 'expired', 'cancelled');
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type public.payment_method as enum ('cash', 'transfer');
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type public.payment_status as enum ('pending', 'approved', 'rejected');
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type public.booking_status as enum ('booked', 'cancelled', 'attended', 'no_show');
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type public.attendance_status as enum ('present', 'absent', 'justified');
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type public.file_kind as enum ('training_plan', 'observation', 'attachment');
exception
  when duplicate_object then null;
end $$;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role public.user_role not null default 'student',
  first_name text not null check (btrim(first_name) <> ''),
  last_name text not null check (btrim(last_name) <> ''),
  email text not null check (email = lower(email) and position('@' in email) > 1),
  phone text,
  active boolean not null default true,
  receives_emails boolean not null default true,
  notes text,
  last_payment_at timestamptz,
  last_real_activity_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists profiles_email_key on public.profiles (email);
create index if not exists profiles_role_idx on public.profiles (role);
create index if not exists profiles_active_idx on public.profiles (active);

create table if not exists public.activities (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  slug text not null unique,
  description text,
  requires_24h_cancel boolean not null default false,
  flexible_schedule boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.plans (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  description text,
  price numeric(12, 2) not null default 0 check (price >= 0),
  billing_period_days int not null default 30 check (billing_period_days > 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.plan_activities (
  plan_id uuid not null references public.plans(id) on delete cascade,
  activity_id uuid not null references public.activities(id) on delete cascade,
  monthly_credits int check (monthly_credits is null or monthly_credits >= 0),
  created_at timestamptz not null default now(),
  primary key (plan_id, activity_id)
);

create table if not exists public.memberships (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles(id) on delete restrict,
  plan_id uuid not null references public.plans(id) on delete restrict,
  status public.membership_status not null default 'active',
  start_date date not null,
  end_date date not null,
  remaining_credits int check (remaining_credits is null or remaining_credits >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint memberships_valid_dates check (end_date >= start_date)
);

create index if not exists memberships_student_id_idx on public.memberships (student_id);
create index if not exists memberships_plan_id_idx on public.memberships (plan_id);
create index if not exists memberships_status_idx on public.memberships (status);
create index if not exists memberships_end_date_idx on public.memberships (end_date);

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles(id) on delete restrict,
  membership_id uuid references public.memberships(id) on delete set null,
  amount numeric(12, 2) not null check (amount >= 0),
  method public.payment_method not null,
  status public.payment_status not null default 'pending',
  paid_at timestamptz not null default now(),
  approved_at timestamptz,
  approved_by uuid references public.profiles(id) on delete set null,
  rejected_at timestamptz,
  rejected_by uuid references public.profiles(id) on delete set null,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint payments_approved_fields check (
    (status <> 'approved' and approved_at is null) or
    (status = 'approved' and approved_at is not null)
  ),
  constraint payments_rejected_fields check (
    (status <> 'rejected' and rejected_at is null) or
    (status = 'rejected' and rejected_at is not null)
  )
);

create index if not exists payments_student_id_idx on public.payments (student_id);
create index if not exists payments_membership_id_idx on public.payments (membership_id);
create index if not exists payments_status_idx on public.payments (status);
create index if not exists payments_paid_at_idx on public.payments (paid_at);

create table if not exists public.class_sessions (
  id uuid primary key default gen_random_uuid(),
  activity_id uuid not null references public.activities(id) on delete restrict,
  title text not null check (btrim(title) <> ''),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  capacity int not null check (capacity > 0),
  trainer_name text,
  notes text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint class_sessions_valid_time check (ends_at > starts_at)
);

create index if not exists class_sessions_activity_id_idx on public.class_sessions (activity_id);
create index if not exists class_sessions_starts_at_idx on public.class_sessions (starts_at);
create index if not exists class_sessions_active_idx on public.class_sessions (active);

create table if not exists public.bookings (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.class_sessions(id) on delete cascade,
  student_id uuid not null references public.profiles(id) on delete cascade,
  status public.booking_status not null default 'booked',
  booked_at timestamptz not null default now(),
  cancelled_at timestamptz,
  cancel_reason text,
  charged_as_attended boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (session_id, student_id)
);

create index if not exists bookings_session_id_idx on public.bookings (session_id);
create index if not exists bookings_student_id_idx on public.bookings (student_id);
create index if not exists bookings_status_idx on public.bookings (status);

create table if not exists public.attendance (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings(id) on delete cascade,
  student_id uuid not null references public.profiles(id) on delete cascade,
  session_id uuid not null references public.class_sessions(id) on delete cascade,
  status public.attendance_status not null,
  recorded_by uuid references public.profiles(id) on delete set null,
  recorded_at timestamptz not null default now(),
  notes text,
  created_at timestamptz not null default now(),
  unique (booking_id)
);

create index if not exists attendance_student_id_idx on public.attendance (student_id);
create index if not exists attendance_session_id_idx on public.attendance (session_id);

create table if not exists public.training_notes (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles(id) on delete cascade,
  title text not null check (btrim(title) <> ''),
  body text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists training_notes_student_id_idx on public.training_notes (student_id);

create table if not exists public.files (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles(id) on delete cascade,
  kind public.file_kind not null,
  title text not null check (btrim(title) <> ''),
  drive_file_id text,
  drive_url text,
  mime_type text,
  size_bytes bigint check (size_bytes is null or size_bytes >= 0),
  uploaded_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists files_student_id_idx on public.files (student_id);
create index if not exists files_kind_idx on public.files (kind);

create table if not exists public.email_logs (
  id uuid primary key default gen_random_uuid(),
  student_id uuid references public.profiles(id) on delete set null,
  recipient_email text not null,
  subject text not null,
  provider text not null default 'mailjet',
  status text not null default 'pending',
  sent_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists email_logs_student_id_idx on public.email_logs (student_id);
create index if not exists email_logs_status_idx on public.email_logs (status);
create index if not exists email_logs_created_at_idx on public.email_logs (created_at);

create table if not exists public.drive_status (
  id uuid primary key default gen_random_uuid(),
  used_bytes bigint not null default 0 check (used_bytes >= 0),
  total_bytes bigint check (total_bytes is null or total_bytes >= 0),
  warning_threshold numeric(5, 2) not null default 0.90 check (warning_threshold > 0 and warning_threshold <= 1),
  checked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.profiles(id) on delete set null,
  entity_type text not null,
  entity_id uuid,
  action text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists audit_logs_actor_id_idx on public.audit_logs (actor_id);
create index if not exists audit_logs_entity_idx on public.audit_logs (entity_type, entity_id);
create index if not exists audit_logs_created_at_idx on public.audit_logs (created_at);

create or replace function public.current_profile_role()
returns public.user_role
language sql
stable
security definer
set search_path = public
as $$
  select p.role
  from public.profiles p
  where p.id = auth.uid()
    and p.active = true
  limit 1;
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.current_profile_role() = 'admin'::public.user_role, false);
$$;

do $$
declare
  target_table regclass;
begin
  foreach target_table in array array[
    'public.profiles'::regclass,
    'public.activities'::regclass,
    'public.plans'::regclass,
    'public.memberships'::regclass,
    'public.payments'::regclass,
    'public.class_sessions'::regclass,
    'public.bookings'::regclass,
    'public.training_notes'::regclass,
    'public.files'::regclass,
    'public.drive_status'::regclass
  ]
  loop
    execute format('drop trigger if exists set_updated_at on %s', target_table);
    execute format(
      'create trigger set_updated_at before update on %s for each row execute function public.set_updated_at()',
      target_table
    );
  end loop;
end $$;

alter table public.profiles enable row level security;
alter table public.activities enable row level security;
alter table public.plans enable row level security;
alter table public.plan_activities enable row level security;
alter table public.memberships enable row level security;
alter table public.payments enable row level security;
alter table public.class_sessions enable row level security;
alter table public.bookings enable row level security;
alter table public.attendance enable row level security;
alter table public.training_notes enable row level security;
alter table public.files enable row level security;
alter table public.email_logs enable row level security;
alter table public.drive_status enable row level security;
alter table public.audit_logs enable row level security;

grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant execute on function public.current_profile_role() to authenticated;
grant execute on function public.is_admin() to authenticated;

do $$
begin
  drop policy if exists "profiles admin all" on public.profiles;
  drop policy if exists "profiles student select own" on public.profiles;
  drop policy if exists "activities authenticated select active" on public.activities;
  drop policy if exists "activities admin all" on public.activities;
  drop policy if exists "plans authenticated select active" on public.plans;
  drop policy if exists "plans admin all" on public.plans;
  drop policy if exists "plan_activities authenticated select" on public.plan_activities;
  drop policy if exists "plan_activities admin all" on public.plan_activities;
  drop policy if exists "memberships admin all" on public.memberships;
  drop policy if exists "memberships student select own" on public.memberships;
  drop policy if exists "payments admin all" on public.payments;
  drop policy if exists "payments student select own" on public.payments;
  drop policy if exists "class_sessions authenticated select active" on public.class_sessions;
  drop policy if exists "class_sessions admin all" on public.class_sessions;
  drop policy if exists "bookings admin all" on public.bookings;
  drop policy if exists "bookings student select own" on public.bookings;
  drop policy if exists "attendance admin all" on public.attendance;
  drop policy if exists "attendance student select own" on public.attendance;
  drop policy if exists "training_notes admin all" on public.training_notes;
  drop policy if exists "training_notes student select own" on public.training_notes;
  drop policy if exists "files admin all" on public.files;
  drop policy if exists "files student select own" on public.files;
  drop policy if exists "email_logs admin all" on public.email_logs;
  drop policy if exists "drive_status admin all" on public.drive_status;
  drop policy if exists "audit_logs admin select" on public.audit_logs;
  drop policy if exists "audit_logs admin insert" on public.audit_logs;
end $$;

create policy "profiles admin all"
on public.profiles
for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

create policy "profiles student select own"
on public.profiles
for select
to authenticated
using (id = auth.uid());

create policy "activities authenticated select active"
on public.activities
for select
to authenticated
using (active = true);

create policy "activities admin all"
on public.activities
for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

create policy "plans authenticated select active"
on public.plans
for select
to authenticated
using (active = true);

create policy "plans admin all"
on public.plans
for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

create policy "plan_activities authenticated select"
on public.plan_activities
for select
to authenticated
using (
  exists (
    select 1
    from public.plans p
    join public.activities a on a.id = plan_activities.activity_id
    where p.id = plan_activities.plan_id
      and p.active = true
      and a.active = true
  )
);

create policy "plan_activities admin all"
on public.plan_activities
for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

create policy "memberships admin all"
on public.memberships
for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

create policy "memberships student select own"
on public.memberships
for select
to authenticated
using (student_id = auth.uid());

create policy "payments admin all"
on public.payments
for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

create policy "payments student select own"
on public.payments
for select
to authenticated
using (student_id = auth.uid());

create policy "class_sessions authenticated select active"
on public.class_sessions
for select
to authenticated
using (active = true);

create policy "class_sessions admin all"
on public.class_sessions
for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

create policy "bookings admin all"
on public.bookings
for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

create policy "bookings student select own"
on public.bookings
for select
to authenticated
using (student_id = auth.uid());

create policy "attendance admin all"
on public.attendance
for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

create policy "attendance student select own"
on public.attendance
for select
to authenticated
using (student_id = auth.uid());

create policy "training_notes admin all"
on public.training_notes
for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

create policy "training_notes student select own"
on public.training_notes
for select
to authenticated
using (student_id = auth.uid());

create policy "files admin all"
on public.files
for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

create policy "files student select own"
on public.files
for select
to authenticated
using (student_id = auth.uid());

create policy "email_logs admin all"
on public.email_logs
for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

create policy "drive_status admin all"
on public.drive_status
for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

create policy "audit_logs admin select"
on public.audit_logs
for select
to authenticated
using (public.is_admin());

create policy "audit_logs admin insert"
on public.audit_logs
for insert
to authenticated
with check (public.is_admin());

insert into public.activities (name, slug, description, requires_24h_cancel, flexible_schedule, active)
values
  ('Funcional', 'funcional', 'Actividad grupal funcional.', false, false, true),
  ('Semi personalizado', 'semi_personalizado', 'Actividad semi personalizada.', false, false, true),
  ('Niños', 'ninos', 'Actividad para niños.', false, false, true),
  ('Cognitivo', 'cognitivo', 'Actividad cognitiva con horario flexible segun demanda.', false, true, true),
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
  ('Plan funcional', 'plan_funcional', 'Precio real pendiente de cargar por admin.', 0, 30, true),
  ('Plan semi personalizado', 'plan_semi_personalizado', 'Precio real pendiente de cargar por admin.', 0, 30, true),
  ('Plan niños', 'plan_ninos', 'Precio real pendiente de cargar por admin.', 0, 30, true),
  ('Plan cognitivo', 'plan_cognitivo', 'Precio real pendiente de cargar por admin.', 0, 30, true),
  ('Plan personalizado 1:1', 'plan_personalizado_1_1', 'Precio real pendiente de cargar por admin.', 0, 30, true)
on conflict (slug) do update set
  name = excluded.name,
  description = excluded.description,
  price = excluded.price,
  billing_period_days = excluded.billing_period_days,
  active = excluded.active,
  updated_at = now();

insert into public.plan_activities (plan_id, activity_id, monthly_credits)
select p.id, a.id, null
from public.plans p
join public.activities a on
  (p.slug = 'plan_funcional' and a.slug = 'funcional') or
  (p.slug = 'plan_semi_personalizado' and a.slug = 'semi_personalizado') or
  (p.slug = 'plan_ninos' and a.slug = 'ninos') or
  (p.slug = 'plan_cognitivo' and a.slug = 'cognitivo') or
  (p.slug = 'plan_personalizado_1_1' and a.slug = 'personalizado_1_1')
on conflict (plan_id, activity_id) do nothing;
