# RANV2-07 - Attendance tracking

RANV2-07 agrega el panel operativo de asistencia sobre reservas existentes.

## Alcance

- Panel admin `/admin/attendance`.
- Listado de clases por fecha con alumnos reservados.
- Marcado y correccion de asistencia:
  - `present`
  - `absent`
  - `justified`
- Auditoria con `attendance.marked` y `attendance.updated`.
- Actualizacion de actividad real solo para asistencia efectiva.

## Reglas

### Present

- Crea o actualiza `attendance.status = present`.
- Cambia `bookings.status = attended`.
- Actualiza `profiles.last_attendance_at`.
- Actualiza `profiles.last_real_activity_at`.
- No descuenta creditos.

### Absent

- Crea o actualiza `attendance.status = absent`.
- Cambia `bookings.status = no_show`.
- No actualiza `last_attendance_at`.
- No actualiza `last_real_activity_at`.
- No devuelve creditos.
- No descuenta creditos.
- Para personalizado 1:1 queda marcado como cobrado/asistido cuando corresponde, sin mover creditos.

### Justified

- Crea o actualiza `attendance.status = justified`.
- No cambia `bookings.status`.
- No pasa la reserva a `cancelled`.
- No libera cupo.
- No devuelve creditos.
- No toca `memberships.remaining_credits`.
- No actualiza `last_attendance_at`.
- No actualiza `last_real_activity_at`.

La cancelacion real de reservas pertenece a RANV2-06 mediante `cancel_booking`.

## RPCs

- `public.list_attendance_sessions(from_date date, to_date date)`
- `public.mark_attendance(booking_id uuid, status public.attendance_status, notes text default null)`

Ambas son admin-only, `security definer`, con `search_path = public, private`, sin permisos para `anon/public` y con `execute` para `authenticated`.

## Fuera de alcance

- No pagos online.
- No Mailjet.
- No Google Drive.
- No Cloudflare.
- No WhatsApp API.
- No emails.
- No archivos.
- No asistencia sin reserva.
- No ajustes automaticos de creditos.
- No RAN-24.

## Pendiente post-merge

- `db push` real.
- Probar `present` real.
- Probar `absent` real.
- Probar `justified` real.
- Verificar `last_attendance_at`.
- Verificar `last_real_activity_at`.
- Verificar `audit_logs`.
- Ejecutar advisors.
