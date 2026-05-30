-- RAN-34 follow-up:
-- Remove future 21:00 sessions left active after their recurring rules were
-- archived by 20260530011414_ran34_calendar_recurrence_delete_visual.sql.
--
-- Safety constraints:
-- - future sessions only, using the project-safe date for this release;
-- - local time must be 21:00-22:00 in America/Argentina/Buenos_Aires;
-- - linked recurring rule must already be inactive;
-- - no bookings;
-- - no attendance;
-- - no edited recurrence exception.

delete from public.class_sessions s
using public.class_recurring_rules r
where r.id = s.recurring_rule_id
  and r.active = false
  and s.starts_at >= timestamptz '2026-05-30 00:00:00-03'
  and s.active = true
  and s.cancelled_at is null
  and s.recurring_rule_id is not null
  and to_char(s.starts_at at time zone 'America/Argentina/Buenos_Aires', 'HH24:MI:SS')::time = time '21:00'
  and to_char(s.ends_at at time zone 'America/Argentina/Buenos_Aires', 'HH24:MI:SS')::time = time '22:00'
  and not exists (
    select 1
    from public.bookings b
    where b.session_id = s.id
  )
  and not exists (
    select 1
    from public.attendance att
    where att.session_id = s.id
  )
  and not exists (
    select 1
    from public.class_recurring_rule_exceptions cre
    where cre.class_session_id = s.id
      and cre.action = 'edited'
  );
