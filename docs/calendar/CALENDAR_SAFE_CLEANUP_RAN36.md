# RAN-36A - Calendar Safe Cleanup Preview

## Purpose

Prepare a safe, read-only preview of technical calendar cleanup candidates without touching real business data.

This stage does not apply cleanup. It only documents what may be cleaned later under explicit approval.

## Diagnosis

- The operational calendar is currently healthy.
- Active duplicate recurring rules were not found.
- Strong operational orphans were not found.
- There is no future active `21:00` row showing as live schedule noise.
- Residual technical noise remains mostly hidden in the database, especially cancelled or inactive future sessions created by recurring-rule edits, pauses, replacements, and drift repair.
- Technical cleanup must not touch real business entities or historical evidence.

## Current Read-Only Audit Summary

- `230` future sessions are cancelled or inactive and have no bookings or attendance.
- `2` recurring rules still use the title `TEST RAN-34 CALENDAR`.
- `18` `TEST RAN-34 CALENDAR` sessions remain inactive/cancelled.
- `16` inactive recurring rules only keep future cancelled sessions.
- `13` inactive recurring rules have no future sessions at all.
- `3` protected `DO_NOT_TOUCH` sessions still exist because they carry real booking and/or attendance history.

Protected session IDs:

- `1d36bf20-b1df-4c31-8afb-8176e0e5a29f`
- `8cd34e8b-4d68-4ae5-9b09-e255d920fb1e`
- `9f6682ba-90ca-467b-bbc9-770cbfb44306`

## Cleanup Candidates

Potential candidates for a later cleanup PR:

1. Future cancelled or inactive sessions with no bookings and no attendance.
2. `TEST RAN-34 CALENDAR` sessions that are already inactive/cancelled and have no history.
3. `TEST RAN-34 CALENDAR` recurring rules.
4. Inactive recurring rules that are purely residual and have no real historical linkage.

These are technical candidates only. They are not auto-approved for deletion.

## Absolute Exclusions

Never touch as part of calendar cleanup:

- `bookings`
- `attendance`
- `payments`
- `profiles` / students
- `memberships`
- `files`
- `Auth`
- `Drive`
- any session with booking history
- any session with attendance history
- the three `DO_NOT_TOUCH` session IDs listed above

## Safe Procedure

1. Run preview queries only.
2. Review the output manually.
3. Separate protected business-linked rows from technical residue.
4. Open a separate PR for real cleanup only after Walter approves the exact scope.
5. Never delete real business data just to make the calendar look cleaner.

## Scope Boundary for a Future RAN-36B

If a cleanup PR is later authorized, it should:

- target only technical residue,
- exclude protected rows explicitly,
- exclude business tables entirely,
- include a human-readable preview before any action,
- remain reversible where possible.

This RAN-36A PR intentionally stops before any real cleanup step.
