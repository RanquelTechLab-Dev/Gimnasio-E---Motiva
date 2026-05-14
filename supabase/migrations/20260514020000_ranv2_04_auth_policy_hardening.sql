-- RANV2-04: auth policy hardening before frontend auth.
-- Keeps business schema unchanged and prepares RLS for authenticated clients.

create schema if not exists private;

revoke all on schema private from public;
revoke all on schema private from anon;
grant usage on schema private to authenticated;

create or replace function private.current_profile_role()
returns public.user_role
language sql
stable
security definer
set search_path = public, private
as $$
  select p.role
  from public.profiles p
  where p.id = (select auth.uid())
    and p.active = true
  limit 1;
$$;

create or replace function private.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public, private
as $$
  select coalesce(private.current_profile_role() = 'admin'::public.user_role, false);
$$;

revoke all on function private.current_profile_role() from public, anon;
revoke all on function private.is_admin() from public, anon;
grant execute on function private.current_profile_role() to authenticated;
grant execute on function private.is_admin() to authenticated;

revoke all on function public.current_profile_role() from public, anon, authenticated;
revoke all on function public.is_admin() from public, anon, authenticated;
revoke all on function public.set_updated_at() from public, anon, authenticated;

create index if not exists attendance_recorded_by_idx on public.attendance (recorded_by);
create index if not exists files_uploaded_by_idx on public.files (uploaded_by);
create index if not exists payments_approved_by_idx on public.payments (approved_by);
create index if not exists payments_rejected_by_idx on public.payments (rejected_by);
create index if not exists plan_activities_activity_id_idx on public.plan_activities (activity_id);
create index if not exists training_notes_created_by_idx on public.training_notes (created_by);

do $$
begin
  drop policy if exists "profiles admin all" on public.profiles;
  drop policy if exists "profiles student select own" on public.profiles;
  drop policy if exists "profiles select access" on public.profiles;
  drop policy if exists "profiles admin insert" on public.profiles;
  drop policy if exists "profiles admin update" on public.profiles;
  drop policy if exists "profiles admin delete" on public.profiles;

  drop policy if exists "activities authenticated select active" on public.activities;
  drop policy if exists "activities admin all" on public.activities;
  drop policy if exists "activities select access" on public.activities;
  drop policy if exists "activities admin insert" on public.activities;
  drop policy if exists "activities admin update" on public.activities;
  drop policy if exists "activities admin delete" on public.activities;

  drop policy if exists "plans authenticated select active" on public.plans;
  drop policy if exists "plans admin all" on public.plans;
  drop policy if exists "plans select access" on public.plans;
  drop policy if exists "plans admin insert" on public.plans;
  drop policy if exists "plans admin update" on public.plans;
  drop policy if exists "plans admin delete" on public.plans;

  drop policy if exists "plan_activities authenticated select" on public.plan_activities;
  drop policy if exists "plan_activities admin all" on public.plan_activities;
  drop policy if exists "plan_activities select access" on public.plan_activities;
  drop policy if exists "plan_activities admin insert" on public.plan_activities;
  drop policy if exists "plan_activities admin update" on public.plan_activities;
  drop policy if exists "plan_activities admin delete" on public.plan_activities;

  drop policy if exists "memberships admin all" on public.memberships;
  drop policy if exists "memberships student select own" on public.memberships;
  drop policy if exists "memberships select access" on public.memberships;
  drop policy if exists "memberships admin insert" on public.memberships;
  drop policy if exists "memberships admin update" on public.memberships;
  drop policy if exists "memberships admin delete" on public.memberships;

  drop policy if exists "payments admin all" on public.payments;
  drop policy if exists "payments student select own" on public.payments;
  drop policy if exists "payments select access" on public.payments;
  drop policy if exists "payments admin insert" on public.payments;
  drop policy if exists "payments admin update" on public.payments;
  drop policy if exists "payments admin delete" on public.payments;

  drop policy if exists "class_sessions authenticated select active" on public.class_sessions;
  drop policy if exists "class_sessions admin all" on public.class_sessions;
  drop policy if exists "class_sessions select access" on public.class_sessions;
  drop policy if exists "class_sessions admin insert" on public.class_sessions;
  drop policy if exists "class_sessions admin update" on public.class_sessions;
  drop policy if exists "class_sessions admin delete" on public.class_sessions;

  drop policy if exists "bookings admin all" on public.bookings;
  drop policy if exists "bookings student select own" on public.bookings;
  drop policy if exists "bookings select access" on public.bookings;
  drop policy if exists "bookings admin insert" on public.bookings;
  drop policy if exists "bookings admin update" on public.bookings;
  drop policy if exists "bookings admin delete" on public.bookings;

  drop policy if exists "attendance admin all" on public.attendance;
  drop policy if exists "attendance student select own" on public.attendance;
  drop policy if exists "attendance select access" on public.attendance;
  drop policy if exists "attendance admin insert" on public.attendance;
  drop policy if exists "attendance admin update" on public.attendance;
  drop policy if exists "attendance admin delete" on public.attendance;

  drop policy if exists "training_notes admin all" on public.training_notes;
  drop policy if exists "training_notes student select own" on public.training_notes;
  drop policy if exists "training_notes select access" on public.training_notes;
  drop policy if exists "training_notes admin insert" on public.training_notes;
  drop policy if exists "training_notes admin update" on public.training_notes;
  drop policy if exists "training_notes admin delete" on public.training_notes;

  drop policy if exists "files admin all" on public.files;
  drop policy if exists "files student select own" on public.files;
  drop policy if exists "files select access" on public.files;
  drop policy if exists "files admin insert" on public.files;
  drop policy if exists "files admin update" on public.files;
  drop policy if exists "files admin delete" on public.files;

  drop policy if exists "email_logs admin all" on public.email_logs;
  drop policy if exists "email_logs admin select" on public.email_logs;
  drop policy if exists "email_logs admin insert" on public.email_logs;
  drop policy if exists "email_logs admin update" on public.email_logs;
  drop policy if exists "email_logs admin delete" on public.email_logs;

  drop policy if exists "drive_status admin all" on public.drive_status;
  drop policy if exists "drive_status admin select" on public.drive_status;
  drop policy if exists "drive_status admin insert" on public.drive_status;
  drop policy if exists "drive_status admin update" on public.drive_status;
  drop policy if exists "drive_status admin delete" on public.drive_status;

  drop policy if exists "audit_logs admin select" on public.audit_logs;
  drop policy if exists "audit_logs admin insert" on public.audit_logs;
end $$;

drop function if exists public.is_admin();
drop function if exists public.current_profile_role();

create policy "profiles select access"
on public.profiles
for select
to authenticated
using ((select private.is_admin()) or id = (select auth.uid()));

create policy "profiles admin insert"
on public.profiles
for insert
to authenticated
with check ((select private.is_admin()));

create policy "profiles admin update"
on public.profiles
for update
to authenticated
using ((select private.is_admin()))
with check ((select private.is_admin()));

create policy "profiles admin delete"
on public.profiles
for delete
to authenticated
using ((select private.is_admin()));

create policy "activities select access"
on public.activities
for select
to authenticated
using ((select private.is_admin()) or active = true);

create policy "activities admin insert"
on public.activities
for insert
to authenticated
with check ((select private.is_admin()));

create policy "activities admin update"
on public.activities
for update
to authenticated
using ((select private.is_admin()))
with check ((select private.is_admin()));

create policy "activities admin delete"
on public.activities
for delete
to authenticated
using ((select private.is_admin()));

create policy "plans select access"
on public.plans
for select
to authenticated
using ((select private.is_admin()) or active = true);

create policy "plans admin insert"
on public.plans
for insert
to authenticated
with check ((select private.is_admin()));

create policy "plans admin update"
on public.plans
for update
to authenticated
using ((select private.is_admin()))
with check ((select private.is_admin()));

create policy "plans admin delete"
on public.plans
for delete
to authenticated
using ((select private.is_admin()));

create policy "plan_activities select access"
on public.plan_activities
for select
to authenticated
using (
  (select private.is_admin())
  or exists (
    select 1
    from public.plans p
    join public.activities a on a.id = plan_activities.activity_id
    where p.id = plan_activities.plan_id
      and p.active = true
      and a.active = true
  )
);

create policy "plan_activities admin insert"
on public.plan_activities
for insert
to authenticated
with check ((select private.is_admin()));

create policy "plan_activities admin update"
on public.plan_activities
for update
to authenticated
using ((select private.is_admin()))
with check ((select private.is_admin()));

create policy "plan_activities admin delete"
on public.plan_activities
for delete
to authenticated
using ((select private.is_admin()));

create policy "memberships select access"
on public.memberships
for select
to authenticated
using ((select private.is_admin()) or student_id = (select auth.uid()));

create policy "memberships admin insert"
on public.memberships
for insert
to authenticated
with check ((select private.is_admin()));

create policy "memberships admin update"
on public.memberships
for update
to authenticated
using ((select private.is_admin()))
with check ((select private.is_admin()));

create policy "memberships admin delete"
on public.memberships
for delete
to authenticated
using ((select private.is_admin()));

create policy "payments select access"
on public.payments
for select
to authenticated
using ((select private.is_admin()) or student_id = (select auth.uid()));

create policy "payments admin insert"
on public.payments
for insert
to authenticated
with check ((select private.is_admin()));

create policy "payments admin update"
on public.payments
for update
to authenticated
using ((select private.is_admin()))
with check ((select private.is_admin()));

create policy "payments admin delete"
on public.payments
for delete
to authenticated
using ((select private.is_admin()));

create policy "class_sessions select access"
on public.class_sessions
for select
to authenticated
using ((select private.is_admin()) or active = true);

create policy "class_sessions admin insert"
on public.class_sessions
for insert
to authenticated
with check ((select private.is_admin()));

create policy "class_sessions admin update"
on public.class_sessions
for update
to authenticated
using ((select private.is_admin()))
with check ((select private.is_admin()));

create policy "class_sessions admin delete"
on public.class_sessions
for delete
to authenticated
using ((select private.is_admin()));

create policy "bookings select access"
on public.bookings
for select
to authenticated
using ((select private.is_admin()) or student_id = (select auth.uid()));

create policy "bookings admin insert"
on public.bookings
for insert
to authenticated
with check ((select private.is_admin()));

create policy "bookings admin update"
on public.bookings
for update
to authenticated
using ((select private.is_admin()))
with check ((select private.is_admin()));

create policy "bookings admin delete"
on public.bookings
for delete
to authenticated
using ((select private.is_admin()));

create policy "attendance select access"
on public.attendance
for select
to authenticated
using ((select private.is_admin()) or student_id = (select auth.uid()));

create policy "attendance admin insert"
on public.attendance
for insert
to authenticated
with check ((select private.is_admin()));

create policy "attendance admin update"
on public.attendance
for update
to authenticated
using ((select private.is_admin()))
with check ((select private.is_admin()));

create policy "attendance admin delete"
on public.attendance
for delete
to authenticated
using ((select private.is_admin()));

create policy "training_notes select access"
on public.training_notes
for select
to authenticated
using ((select private.is_admin()) or student_id = (select auth.uid()));

create policy "training_notes admin insert"
on public.training_notes
for insert
to authenticated
with check ((select private.is_admin()));

create policy "training_notes admin update"
on public.training_notes
for update
to authenticated
using ((select private.is_admin()))
with check ((select private.is_admin()));

create policy "training_notes admin delete"
on public.training_notes
for delete
to authenticated
using ((select private.is_admin()));

create policy "files select access"
on public.files
for select
to authenticated
using ((select private.is_admin()) or student_id = (select auth.uid()));

create policy "files admin insert"
on public.files
for insert
to authenticated
with check ((select private.is_admin()));

create policy "files admin update"
on public.files
for update
to authenticated
using ((select private.is_admin()))
with check ((select private.is_admin()));

create policy "files admin delete"
on public.files
for delete
to authenticated
using ((select private.is_admin()));

create policy "email_logs admin select"
on public.email_logs
for select
to authenticated
using ((select private.is_admin()));

create policy "email_logs admin insert"
on public.email_logs
for insert
to authenticated
with check ((select private.is_admin()));

create policy "email_logs admin update"
on public.email_logs
for update
to authenticated
using ((select private.is_admin()))
with check ((select private.is_admin()));

create policy "email_logs admin delete"
on public.email_logs
for delete
to authenticated
using ((select private.is_admin()));

create policy "drive_status admin select"
on public.drive_status
for select
to authenticated
using ((select private.is_admin()));

create policy "drive_status admin insert"
on public.drive_status
for insert
to authenticated
with check ((select private.is_admin()));

create policy "drive_status admin update"
on public.drive_status
for update
to authenticated
using ((select private.is_admin()))
with check ((select private.is_admin()));

create policy "drive_status admin delete"
on public.drive_status
for delete
to authenticated
using ((select private.is_admin()));

create policy "audit_logs admin select"
on public.audit_logs
for select
to authenticated
using ((select private.is_admin()));

create policy "audit_logs admin insert"
on public.audit_logs
for insert
to authenticated
with check ((select private.is_admin()));
