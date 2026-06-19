# RAN-37B - Calendar hard delete preview

## Purpose

This document defines a safe, read-only preview for future calendar hard delete work.

RAN-37B does not implement hard delete.

RAN-37B does not add an operational button.

RAN-37B does not modify database rows.

Its only goal is to answer, with exact counts, what would be affected by a future hard delete flow before any destructive implementation is considered.

## Why this exists

RAN-37A established the semantic contract:

- `Cancelar` / `Pausar` preserve history.
- `Borrar` must mean real hard delete.

Today the operational calendar still uses lifecycle actions that preserve history:

- `cancel_class_session`
- `admin_delete_class_session`
- `admin_archive_class_recurring_rule`

Those flows are valid for cancellation and pause semantics, but they are not true hard delete semantics.

Before building any destructive operation, we need a preview that tells us:

- how many `class_sessions` are in scope,
- how many `bookings` are attached,
- how many `attendance` rows are attached,
- whether the target belongs to a recurring rule,
- whether recurring exceptions would also be in scope,
- whether the target must be blocked because it touches non-calendar business data,
- whether the target contains historical records that require a stronger confirmation path.

## Scope covered by the read-only preview

The preview is designed to answer four future scenarios:

1. Single class session preview
2. Single recurring occurrence preview
3. Future recurring series preview from a boundary date
4. Calendar range preview

For each scenario, the preview should separate:

- calendar rows in scope,
- dependencies in scope,
- protected historical dependencies,
- explicit exclusions.

## Explicit exclusions

Any future calendar hard delete must continue to exclude:

- students / `profiles`
- `payments`
- `memberships`
- `files`
- Auth users
- Drive files

RAN-37B only previews calendar-domain rows:

- `class_sessions`
- `bookings`
- `attendance`
- `class_recurring_rules`
- `class_recurring_rule_exceptions`

## Current API/RPC semantics audited in this phase

Current frontend naming and backend behavior still prove that the existing operational action is not a hard delete:

- `src/admin/api.ts` exposes `deleteClassSession(...)`
- it calls `public.admin_delete_class_session(...)`
- `src/admin/AdminCalendarPage.tsx` still uses `handleDeleteSession(...)`
- success messages confirm pause/cancel semantics such as:
  - `Horario recurrente pausado desde esta fecha`
  - `Clase cancelada de forma segura. El historial se conservo.`

That is acceptable for current operations, but it must stay separate from any future `Borrar` action.

## Deliverables in RAN-37B

This phase only creates:

- this document,
- a read-only SQL preview script:
  - `docs/calendar/queries/ran37b_calendar_hard_delete_preview.sql`

No migration is created.

No RPC is created.

No Edge Function is created.

No UI action is exposed.

## Expected output of the preview SQL

The preview script should return exact counts for:

- sessions in scope,
- recurring rules in scope,
- recurring exceptions in scope,
- bookings in scope,
- attendance rows in scope,
- future-only rows,
- rows with historical usage,
- rows protected from blind cleanup.

It should also expose the target identifiers so that Walter can review candidate rows safely before any future implementation.

## Non-goals

RAN-37B does not:

- implement real hard delete,
- execute cleanup,
- create a confirmation modal,
- change operational calendar behavior,
- introduce migration or Supabase drift,
- perform any write in database or external systems.

## Explicitly not implemented in RAN-37B

The following scopes are intentionally not implemented as executable previews in this phase:

- `recurring_series_all`
- `calendar_all`

They are high-risk operations and must remain future-only until Walter explicitly approves a separate design.

RAN-37B focuses on safe preview foundations for:

- single sessions,
- recurring occurrences,
- future recurring series,
- calendar ranges.

## Next step after this phase

If this preview is accepted, the next step should be a separate RAN-37C implementation PR that adds:

- preview-backed backend endpoints,
- strong confirmation strings,
- admin-only execution,
- exact safety checks,
- minimal audit trail,
- and only then a true hard delete flow whose UI is explicitly labeled `Borrar`.
