# E-Motiva Stable Baseline v1

Fecha: 2026-06-02

## Identificacion

- Version: E-Motiva Stable Baseline v1
- Branch base: `main`
- Commit de codigo estable: `d8610074a7e728fe9e34eb0908a331dfbfef013d`
- Ultimo merge relevante incluido: `d861007 Merge pull request #89 from RanquelTechLab-Dev/ranqueltechlab/ran-34-admin-booking-layout-polish`
- Repo: `RanquelTechLab-Dev/Gimnasio-E---Motiva`
- Proposito: punto seguro de recuperacion, base comercial reutilizable y version estable antes de seguir agregando features.

## Validaciones del baseline

- `git status --short --branch`: main limpio antes de documentar.
- `git rev-list --left-right --count origin/main...HEAD`: `0 0`
- `npm run build`: OK
- `npm run lint`: OK
- `git diff --check`: OK
- `npx.cmd supabase@2.98.2 db push --dry-run`: `Remote database is up to date.`

## Supabase

- Estado: local y remoto alineados.
- No se ejecuto `db push` real para crear este baseline.
- No se modificaron datos reales.
- No se incluyeron secrets ni credenciales.

## Migraciones aplicadas y alineadas

Todas estas migraciones figuran aplicadas local/remoto al momento del baseline:

- `20260514010000_ranv2_03_initial_schema_rls.sql`
- `20260514020000_ranv2_04_auth_policy_hardening.sql`
- `20260514030000_ranv2_05_admin_operations.sql`
- `20260514040000_ranv2_05_payment_date.sql`
- `20260514050000_ranv2_06_calendar_bookings.sql`
- `20260514060000_ranv2_07_attendance.sql`
- `20260514070000_ranv2_07_auto_attendance.sql`
- `20260514080000_ranv2_07_fix_mark_attendance_booking_id.sql`
- `20260514090000_ranv2_06b_cancel_windows.sql`
- `20260514100000_ranv2_08_student_profile_self_service.sql`
- `20260514110000_ranv2_09_training_notes_files.sql`
- `20260518130000_ranv2_13_prices_plans_packages.sql`
- `20260518140000_ranv2_13_plan_types_weekly_limits.sql`
- `20260518150000_ranv2_13_calendar_admin_fixes.sql`
- `20260518160000_ranv2_13_safe_admin_archive_delete.sql`
- `20260518170000_ranv2_13_editable_voidable_payments.sql`
- `20260518180000_ranv2_13_plans_activities_crud.sql`
- `20260520120000_ranv2_13_real_initial_catalog_calendar.sql`
- `20260520130000_ranv2_13_perpetual_recurring_schedule.sql`
- `20260520140000_ranv2_13_virgin_reset_real_schedule.sql`
- `20260521100000_ranv2_13_demo_clean_only_admin.sql`
- `20260522100000_ran31_plan_visibility_and_limits.sql`
- `20260527100000_ran31_calendar_edit_no_duplicate.sql`
- `20260528150000_ran31_final_schedule_and_capacity_rules.sql`
- `20260529100000_ran31_delete_recurring_occurrence_exception.sql`
- `20260529110000_ran31_restore_cancelled_recurring_occurrence.sql`
- `20260530011414_ran34_calendar_recurrence_delete_visual.sql`
- `20260530032350_ran34_cleanup_inactive_21_future_sessions.sql`
- `20260530035224_ran34_delete_recurring_series_default.sql`
- `20260530222054_ran34_plan_actividades_2_programa_integral.sql`
- `20260530232453_ran34_hard_delete_class_types_cleanup.sql`
- `20260601191553_ran34_edit_plan_activities_with_history.sql`
- `20260601201200_ran34_auto_approve_manual_payments.sql`
- `20260601211633_ran34_fix_plan_reservation_entitlements.sql`
- `20260601215344_ran34_calendar_month_entitlement_periods.sql`
- `20260601230634_ran34_period_based_plan_limits.sql`
- `20260602001032_ran34_booking_cancel_cutoffs_attendance_manual_cancel.sql`
- `20260602010848_ran34_admin_student_programs_management.sql`
- `20260602070220_ran34_activity_delete_requires_confirm.sql`
- `20260602153416_ran34_weekly_limits_and_justified_release.sql`
- `20260602180127_ran34_activity_booking_cancel_cutoffs.sql`
- `20260602202923_ran34_lock_membership_required_amount.sql`
- `20260602224355_ran34_admin_bookings_by_student.sql`

## Edge Functions activas

Funciones activas al momento del baseline:

- `create-student`
- `send-mass-email`
- `check-drive-status`
- `upload-student-file`
- `cleanup-drive-files`
- `delete-student`
- `update-student-password`

## Features confirmadas en esta base

- Alumnos.
- Programas asignados.
- Pagos manuales.
- Edicion y anulacion de pagos.
- Precio congelado por programa asignado.
- Calendario alumno.
- Calendario admin.
- Asistencia.
- Reservar/cancelar por alumno desde admin.
- Cambio de contrasena de alumno.
- Actividades principales.
- Planes.
- Reglas de limite semanal para Semipersonalizado/Neurofuncional.
- Paquetes Personalizado por creditos.
- Cutoffs de reserva/cancelacion por actividad.
- Layout compacto/ordenado en calendario, alumnos y reservar por alumno.

## Pendientes conocidos

- Drive/RAN-33 queda fuera de este baseline salvo validacion especifica posterior.
- No hay detalle visual menor bloqueante registrado al crear este baseline.

## Seguridad y privacidad

- No incluir secrets.
- No incluir contrasenas.
- No incluir datos sensibles de alumnos.
- No commitear dumps con filas reales.
- No commitear archivos locales de backup con informacion privada.
- Este documento solo registra estado tecnico y funcional de alto nivel.

