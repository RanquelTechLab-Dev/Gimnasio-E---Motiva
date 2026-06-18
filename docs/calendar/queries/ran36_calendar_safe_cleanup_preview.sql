-- RAN-36A
-- Read-only preview queries for safe technical cleanup candidates.
-- This file must remain SELECT-only.

-- Protected sessions that must never be touched by technical cleanup.
with protected_ids as (
  select unnest(array[
    '1d36bf20-b1df-4c31-8afb-8176e0e5a29f'::uuid,
    '8cd34e8b-4d68-4ae5-9b09-e255d920fb1e'::uuid,
    '9f6682ba-90ca-467b-bbc9-770cbfb44306'::uuid
  ]) as session_id
)
select session_id
from protected_ids;

-- A. Future cancelled/inactive sessions with no booking or attendance history.
with protected_ids as (
  select unnest(array[
    '1d36bf20-b1df-4c31-8afb-8176e0e5a29f'::uuid,
    '8cd34e8b-4d68-4ae5-9b09-e255d920fb1e'::uuid,
    '9f6682ba-90ca-467b-bbc9-770cbfb44306'::uuid
  ]) as session_id
),
session_stats as (
  select
    s.id as session_id,
    s.starts_at,
    s.ends_at,
    s.title,
    a.name as activity_name,
    s.active,
    s.cancelled_at,
    s.cancel_reason,
    s.notes,
    s.recurring_rule_id,
    count(distinct b.id) filter (
      where b.status in ('booked', 'attended', 'no_show', 'cancelled')
    ) as bookings_count,
    count(distinct att.id) as attendance_count,
    case
      when coalesce(s.title, '') ilike '%TEST RAN-34 CALENDAR%'
        or coalesce(a.name, '') ilike '%TEST RAN-34 CALENDAR%'
        then 'TEST'
      when s.cancel_reason = 'Horario recurrente reemplazado por administracion'
        then 'REPLACED_RULE'
      when s.cancel_reason = 'Horario recurrente pausado por administracion'
        then 'ARCHIVED_RULE'
      when s.cancel_reason = 'Calendar drift repair'
        then 'DRIFT_REPAIR'
      when s.cancel_reason = 'Clase eliminada por administracion'
        then 'ADMIN_DELETE'
      else 'OTHER'
    end as reason_bucket
  from public.class_sessions s
  left join public.activities a on a.id = s.activity_id
  left join public.bookings b on b.session_id = s.id
  left join public.attendance att on att.session_id = s.id
  where s.starts_at >= now()
    and (s.active is not true or s.cancelled_at is not null)
    and s.id not in (select session_id from protected_ids)
  group by
    s.id,
    s.starts_at,
    s.ends_at,
    s.title,
    a.name,
    s.active,
    s.cancelled_at,
    s.cancel_reason,
    s.notes,
    s.recurring_rule_id
)
select
  session_id,
  starts_at,
  ends_at,
  title,
  activity_name,
  active,
  cancelled_at,
  cancel_reason,
  notes,
  recurring_rule_id,
  bookings_count,
  attendance_count,
  reason_bucket
from session_stats
where bookings_count = 0
  and attendance_count = 0
order by starts_at, title, session_id;

-- B1. TEST RAN-34 CALENDAR recurring rules.
select
  r.id as recurring_rule_id,
  r.title,
  a.name as activity_name,
  r.weekday,
  r.start_time,
  r.end_time,
  r.active,
  r.valid_from,
  r.valid_until
from public.class_recurring_rules r
left join public.activities a on a.id = r.activity_id
where coalesce(r.title, '') ilike '%TEST RAN-34 CALENDAR%'
order by r.valid_from, r.start_time, r.id;

-- B2. TEST RAN-34 CALENDAR sessions and history counts.
with test_sessions as (
  select
    s.id as session_id,
    s.recurring_rule_id,
    s.starts_at,
    s.ends_at,
    s.title,
    a.name as activity_name,
    s.active,
    s.cancelled_at,
    s.cancel_reason,
    count(distinct b.id) filter (
      where b.status in ('booked', 'attended', 'no_show', 'cancelled')
    ) as bookings_count,
    count(distinct att.id) as attendance_count
  from public.class_sessions s
  left join public.activities a on a.id = s.activity_id
  left join public.bookings b on b.session_id = s.id
  left join public.attendance att on att.session_id = s.id
  where coalesce(s.title, '') ilike '%TEST RAN-34 CALENDAR%'
  group by
    s.id,
    s.recurring_rule_id,
    s.starts_at,
    s.ends_at,
    s.title,
    a.name,
    s.active,
    s.cancelled_at,
    s.cancel_reason
)
select *
from test_sessions
order by starts_at, session_id;

-- C1. Inactive recurring rules with only future cancelled/inactive sessions.
with rule_session_stats as (
  select
    r.id as recurring_rule_id,
    r.title,
    a.name as activity_name,
    r.weekday,
    r.start_time,
    r.end_time,
    r.valid_from,
    r.valid_until,
    r.active,
    count(*) filter (
      where s.starts_at >= now()
        and s.active is true
        and s.cancelled_at is null
    ) as future_operational_sessions,
    count(*) filter (
      where s.starts_at >= now()
        and (s.active is not true or s.cancelled_at is not null)
    ) as future_cancelled_sessions,
    count(distinct b.id) as lifetime_bookings_count,
    count(distinct att.id) as lifetime_attendance_count
  from public.class_recurring_rules r
  left join public.activities a on a.id = r.activity_id
  left join public.class_sessions s on s.recurring_rule_id = r.id
  left join public.bookings b on b.session_id = s.id
  left join public.attendance att on att.session_id = s.id
  where r.active is false
  group by
    r.id,
    r.title,
    a.name,
    r.weekday,
    r.start_time,
    r.end_time,
    r.valid_from,
    r.valid_until,
    r.active
)
select
  recurring_rule_id,
  title,
  activity_name,
  weekday,
  start_time,
  end_time,
  valid_from,
  valid_until,
  future_cancelled_sessions,
  lifetime_bookings_count,
  lifetime_attendance_count
from rule_session_stats
where future_operational_sessions = 0
  and future_cancelled_sessions > 0
  and lifetime_bookings_count = 0
  and lifetime_attendance_count = 0
order by future_cancelled_sessions desc, valid_from, recurring_rule_id;

-- C2. Inactive recurring rules without any future sessions.
with rule_session_stats as (
  select
    r.id as recurring_rule_id,
    r.title,
    a.name as activity_name,
    r.weekday,
    r.start_time,
    r.end_time,
    r.valid_from,
    r.valid_until,
    count(*) filter (where s.starts_at >= now()) as future_total_sessions,
    count(distinct b.id) as lifetime_bookings_count,
    count(distinct att.id) as lifetime_attendance_count
  from public.class_recurring_rules r
  left join public.activities a on a.id = r.activity_id
  left join public.class_sessions s on s.recurring_rule_id = r.id
  left join public.bookings b on b.session_id = s.id
  left join public.attendance att on att.session_id = s.id
  where r.active is false
  group by
    r.id,
    r.title,
    a.name,
    r.weekday,
    r.start_time,
    r.end_time,
    r.valid_from,
    r.valid_until
)
select
  recurring_rule_id,
  title,
  activity_name,
  weekday,
  start_time,
  end_time,
  valid_from,
  valid_until,
  lifetime_bookings_count,
  lifetime_attendance_count
from rule_session_stats
where future_total_sessions = 0
  and lifetime_bookings_count = 0
  and lifetime_attendance_count = 0
order by valid_from, recurring_rule_id;

-- D. Protected DO_NOT_TOUCH sessions with explicit history and protected=true.
with protected_ids as (
  select unnest(array[
    '1d36bf20-b1df-4c31-8afb-8176e0e5a29f'::uuid,
    '8cd34e8b-4d68-4ae5-9b09-e255d920fb1e'::uuid,
    '9f6682ba-90ca-467b-bbc9-770cbfb44306'::uuid
  ]) as session_id
)
select
  s.id as session_id,
  s.starts_at,
  s.ends_at,
  s.title,
  a.name as activity_name,
  s.active,
  s.cancelled_at,
  s.cancel_reason,
  count(distinct b.id) filter (
    where b.status in ('booked', 'attended', 'no_show', 'cancelled')
  ) as bookings_count,
  count(distinct att.id) as attendance_count,
  true as protected
from public.class_sessions s
left join public.activities a on a.id = s.activity_id
left join public.bookings b on b.session_id = s.id
left join public.attendance att on att.session_id = s.id
where s.id in (select session_id from protected_ids)
group by
  s.id,
  s.starts_at,
  s.ends_at,
  s.title,
  a.name,
  s.active,
  s.cancelled_at,
  s.cancel_reason
order by starts_at, session_id;

-- E. Final summary.
with protected_ids as (
  select unnest(array[
    '1d36bf20-b1df-4c31-8afb-8176e0e5a29f'::uuid,
    '8cd34e8b-4d68-4ae5-9b09-e255d920fb1e'::uuid,
    '9f6682ba-90ca-467b-bbc9-770cbfb44306'::uuid
  ]) as session_id
),
candidate_sessions as (
  select
    s.id as session_id
  from public.class_sessions s
  left join public.bookings b on b.session_id = s.id
  left join public.attendance att on att.session_id = s.id
  where s.starts_at >= now()
    and (s.active is not true or s.cancelled_at is not null)
    and s.id not in (select session_id from protected_ids)
  group by s.id
  having count(distinct b.id) filter (
      where b.status in ('booked', 'attended', 'no_show', 'cancelled')
    ) = 0
     and count(distinct att.id) = 0
),
test_sessions as (
  select s.id
  from public.class_sessions s
  left join public.bookings b on b.session_id = s.id
  left join public.attendance att on att.session_id = s.id
  where coalesce(s.title, '') ilike '%TEST RAN-34 CALENDAR%'
  group by s.id
  having count(distinct b.id) filter (
      where b.status in ('booked', 'attended', 'no_show', 'cancelled')
    ) = 0
     and count(distinct att.id) = 0
),
test_rules as (
  select count(*) as count
  from public.class_recurring_rules r
  where coalesce(r.title, '') ilike '%TEST RAN-34 CALENDAR%'
),
inactive_only_future_cancelled as (
  select r.id
  from public.class_recurring_rules r
  left join public.class_sessions s on s.recurring_rule_id = r.id
  left join public.bookings b on b.session_id = s.id
  left join public.attendance att on att.session_id = s.id
  where r.active is false
  group by r.id
  having count(*) filter (
      where s.starts_at >= now()
        and s.active is true
        and s.cancelled_at is null
    ) = 0
     and count(*) filter (
      where s.starts_at >= now()
        and (s.active is not true or s.cancelled_at is not null)
    ) > 0
     and count(distinct b.id) = 0
     and count(distinct att.id) = 0
),
inactive_without_future_sessions as (
  select r.id
  from public.class_recurring_rules r
  left join public.class_sessions s on s.recurring_rule_id = r.id
  left join public.bookings b on b.session_id = s.id
  left join public.attendance att on att.session_id = s.id
  where r.active is false
  group by r.id
  having count(*) filter (where s.starts_at >= now()) = 0
     and count(distinct b.id) = 0
     and count(distinct att.id) = 0
)
select
  (select count(*) from candidate_sessions) as total_candidate_sessions,
  (select count(*) from test_sessions) as total_test_sessions,
  (select count from test_rules) as total_test_rules,
  (select count(*) from inactive_only_future_cancelled) as total_inactive_rules_only_future_cancelled,
  (select count(*) from inactive_without_future_sessions) as total_inactive_rules_without_future_sessions,
  (select count(*) from protected_ids) as total_protected_do_not_touch;
