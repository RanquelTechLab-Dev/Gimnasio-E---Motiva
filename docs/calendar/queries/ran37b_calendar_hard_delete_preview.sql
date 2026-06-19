-- RAN-37B
-- Read-only preview for future calendar hard delete semantics.
-- This script performs no writes.
--
-- Optional inputs:
--   p_session_id         -> preview one concrete class_session
--   p_recurring_rule_id  -> preview one recurring rule / series
--   p_from               -> lower bound for series/range previews
--   p_to                 -> upper bound for range previews
--
-- Usage pattern:
--   replace null values in params as needed, then run the whole script.

with params as (
  select
    null::uuid as p_session_id,
    null::uuid as p_recurring_rule_id,
    null::timestamptz as p_from,
    null::timestamptz as p_to
),
target_session as (
  select
    s.id,
    s.recurring_rule_id,
    s.activity_id,
    s.title,
    s.starts_at,
    s.ends_at,
    s.active,
    s.cancelled_at,
    s.cancel_reason
  from public.class_sessions s
  join params p on p.p_session_id is not null and s.id = p.p_session_id
),
target_rule as (
  select
    r.id,
    r.activity_id,
    r.title,
    r.weekday,
    r.start_time,
    r.end_time,
    r.active,
    r.valid_from,
    r.valid_until
  from public.class_recurring_rules r
  join params p on p.p_recurring_rule_id is not null and r.id = p.p_recurring_rule_id
),
session_scope as (
  select
    'single_session'::text as scope,
    s.id as class_session_id,
    s.recurring_rule_id,
    s.activity_id,
    s.title,
    s.starts_at,
    s.ends_at,
    s.active,
    s.cancelled_at
  from target_session s
),
occurrence_scope as (
  select
    'single_recurring_occurrence'::text as scope,
    s.id as class_session_id,
    s.recurring_rule_id,
    s.activity_id,
    s.title,
    s.starts_at,
    s.ends_at,
    s.active,
    s.cancelled_at
  from target_session s
  where s.recurring_rule_id is not null
),
series_scope as (
  select
    'future_recurring_series'::text as scope,
    s.id as class_session_id,
    s.recurring_rule_id,
    s.activity_id,
    s.title,
    s.starts_at,
    s.ends_at,
    s.active,
    s.cancelled_at
  from public.class_sessions s
  cross join params p
  where p.p_recurring_rule_id is not null
    and s.recurring_rule_id = p.p_recurring_rule_id
    and (p.p_from is null or s.starts_at >= p.p_from)
),
calendar_range_scope as (
  select
    'calendar_range'::text as scope,
    s.id as class_session_id,
    s.recurring_rule_id,
    s.activity_id,
    s.title,
    s.starts_at,
    s.ends_at,
    s.active,
    s.cancelled_at
  from public.class_sessions s
  cross join params p
  where p.p_from is not null
    and p.p_to is not null
    and s.starts_at >= p.p_from
    and s.starts_at < p.p_to
),
unioned_scopes as (
  select * from session_scope
  union all
  select * from occurrence_scope
  union all
  select * from series_scope
  union all
  select * from calendar_range_scope
),
scoped_sessions as (
  select distinct
    us.scope,
    us.class_session_id,
    us.recurring_rule_id,
    us.activity_id,
    us.title,
    us.starts_at,
    us.ends_at,
    us.active,
    us.cancelled_at
  from unioned_scopes us
),
scoped_bookings as (
  select
    ss.scope,
    b.id as booking_id,
    b.session_id,
    b.student_id,
    b.membership_id,
    b.status,
    b.booked_at,
    b.cancelled_at
  from scoped_sessions ss
  join public.bookings b on b.session_id = ss.class_session_id
),
scoped_attendance as (
  select
    ss.scope,
    a.id as attendance_id,
    a.booking_id,
    a.session_id,
    a.student_id,
    a.status,
    a.recorded_at
  from scoped_sessions ss
  join public.attendance a on a.session_id = ss.class_session_id
),
scoped_rules as (
  select distinct
    ss.scope,
    r.id as recurring_rule_id,
    r.activity_id,
    r.title,
    r.weekday,
    r.start_time,
    r.end_time,
    r.active,
    r.valid_from,
    r.valid_until
  from scoped_sessions ss
  join public.class_recurring_rules r on r.id = ss.recurring_rule_id
),
scoped_rule_exceptions as (
  select
    sr.scope,
    cre.id as exception_id,
    cre.recurring_rule_id,
    cre.occurrence_starts_at,
    cre.occurrence_ends_at,
    cre.action,
    cre.class_session_id
  from scoped_rules sr
  join public.class_recurring_rule_exceptions cre
    on cre.recurring_rule_id = sr.recurring_rule_id
),
scope_summary as (
  select
    scope,
    count(distinct class_session_id) as class_sessions_count,
    count(distinct recurring_rule_id) filter (where recurring_rule_id is not null) as recurring_rules_count,
    count(*) filter (where active = true and cancelled_at is null) as active_operational_sessions,
    count(*) filter (where active = false or cancelled_at is not null) as inactive_or_cancelled_sessions,
    count(*) filter (where starts_at >= now()) as future_sessions,
    count(*) filter (where starts_at < now()) as past_sessions
  from scoped_sessions
  group by scope
),
booking_summary as (
  select
    scope,
    count(*) as bookings_count,
    count(*) filter (where status = 'booked') as booked_count,
    count(*) filter (where status = 'cancelled') as cancelled_booking_count,
    count(*) filter (where status in ('attended', 'no_show')) as historical_booking_count
  from scoped_bookings
  group by scope
),
attendance_summary as (
  select
    scope,
    count(*) as attendance_count
  from scoped_attendance
  group by scope
),
rule_exception_summary as (
  select
    scope,
    count(distinct exception_id) as recurring_exceptions_count
  from scoped_rule_exceptions
  group by scope
),
protected_scope as (
  select
    ss.scope,
    count(distinct ss.class_session_id) filter (
      where exists (
        select 1
        from public.bookings b
        where b.session_id = ss.class_session_id
      )
      or exists (
        select 1
        from public.attendance a
        where a.session_id = ss.class_session_id
      )
    ) as sessions_with_dependencies,
    count(distinct ss.class_session_id) filter (
      where exists (
        select 1
        from public.bookings b
        where b.session_id = ss.class_session_id
          and b.status in ('attended', 'no_show')
      )
      or exists (
        select 1
        from public.attendance a
        where a.session_id = ss.class_session_id
      )
    ) as sessions_with_history
  from scoped_sessions ss
  group by ss.scope
),
final_summary as (
  select
    ss.scope,
    ss.class_sessions_count,
    ss.recurring_rules_count,
    coalesce(re.recurring_exceptions_count, 0) as recurring_exceptions_count,
    coalesce(bs.bookings_count, 0) as bookings_count,
    coalesce(bs.booked_count, 0) as booked_count,
    coalesce(bs.cancelled_booking_count, 0) as cancelled_booking_count,
    coalesce(bs.historical_booking_count, 0) as historical_booking_count,
    coalesce(asu.attendance_count, 0) as attendance_count,
    ss.active_operational_sessions,
    ss.inactive_or_cancelled_sessions,
    ss.future_sessions,
    ss.past_sessions,
    coalesce(ps.sessions_with_dependencies, 0) as sessions_with_dependencies,
    coalesce(ps.sessions_with_history, 0) as sessions_with_history
  from scope_summary ss
  left join booking_summary bs on bs.scope = ss.scope
  left join attendance_summary asu on asu.scope = ss.scope
  left join rule_exception_summary re on re.scope = ss.scope
  left join protected_scope ps on ps.scope = ss.scope
)
select * from final_summary order by scope;

with params as (
  select
    null::uuid as p_session_id,
    null::uuid as p_recurring_rule_id,
    null::timestamptz as p_from,
    null::timestamptz as p_to
)
select
  'scoped_sessions' as section,
  ss.scope,
  ss.class_session_id,
  ss.recurring_rule_id,
  ss.activity_id,
  ss.title,
  ss.starts_at,
  ss.ends_at,
  ss.active,
  ss.cancelled_at
from (
  select
    'single_session'::text as scope,
    s.id as class_session_id,
    s.recurring_rule_id,
    s.activity_id,
    s.title,
    s.starts_at,
    s.ends_at,
    s.active,
    s.cancelled_at
  from public.class_sessions s
  join params p on p.p_session_id is not null and s.id = p.p_session_id

  union all

  select
    'future_recurring_series'::text as scope,
    s.id as class_session_id,
    s.recurring_rule_id,
    s.activity_id,
    s.title,
    s.starts_at,
    s.ends_at,
    s.active,
    s.cancelled_at
  from public.class_sessions s
  cross join params p
  where p.p_recurring_rule_id is not null
    and s.recurring_rule_id = p.p_recurring_rule_id
    and (p.p_from is null or s.starts_at >= p.p_from)

  union all

  select
    'calendar_range'::text as scope,
    s.id as class_session_id,
    s.recurring_rule_id,
    s.activity_id,
    s.title,
    s.starts_at,
    s.ends_at,
    s.active,
    s.cancelled_at
  from public.class_sessions s
  cross join params p
  where p.p_from is not null
    and p.p_to is not null
    and s.starts_at >= p.p_from
    and s.starts_at < p.p_to
) ss
order by ss.scope, ss.starts_at, ss.class_session_id;
