# RANV2-07 - Attendance tracking

RANV2-07 agrega el panel operativo de asistencia sobre reservas existentes.
La asistencia no la toma Carolina manualmente: se genera automaticamente para
reservas no canceladas cuando la clase ya finalizo.

## Alcance

- Panel admin `/admin/attendance`.
- Listado de clases por fecha con alumnos reservados.
- Finalizacion automatica de asistencia:
  - reserva `booked`
  - clase finalizada
  - clase no cancelada
  - sin asistencia previa
- Correccion administrativa de asistencia:
  - `present`
  - `absent`
  - `justified`
- Auditoria con `attendance.auto_marked`, `attendance.marked` y
  `attendance.updated`.
- Actualizacion de actividad real solo para asistencia efectiva.

## Reglas

### Present

- Crea o actualiza `attendance.status = present`.
- Cambia `bookings.status = attended`.
- Actualiza `profiles.last_attendance_at`.
- Actualiza `profiles.last_real_activity_at`.
- No descuenta creditos.
- En el flujo normal se crea automaticamente al finalizar la clase si la
  reserva no fue cancelada.

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

## Automatizacion

- `public.auto_finalize_attendance(from_date date, to_date date)` es admin-only.
- Se ejecuta desde `/admin/attendance` antes de listar el rango.
- Solo finaliza reservas `booked` de clases ya terminadas y no canceladas.
- No crea asistencia para reservas canceladas.
- No toca creditos ni `memberships.remaining_credits`.
- Guarda `attendance.recorded_at` con la hora real de finalizacion de la clase
  (`class_sessions.ends_at`), no con la hora de procesamiento.
- `attendance.updated_at` y `audit_logs.metadata.processed_at` reflejan cuando se
  proceso la automatizacion.
- `profiles.last_attendance_at` y `profiles.last_real_activity_at` quedan basados
  en la hora real de asistencia, incluso si una clase historica se procesa despues.
- Inserta auditoria `attendance.auto_marked`.

## RPCs

- `public.auto_finalize_attendance(from_date date, to_date date)`
- `public.list_attendance_sessions(from_date date, to_date date)`
- `public.mark_attendance(booking_id uuid, status public.attendance_status, notes text default null)`

Son admin-only, `security definer`, con `search_path = public, private`, sin permisos para `anon/public` y con `execute` para `authenticated`.

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

- `db push` real de la migracion de asistencia automatica.
- Probar finalizacion automatica real.
- Probar correcciones `present`, `absent` y `justified`.
- Verificar `last_attendance_at`.
- Verificar `last_real_activity_at`.
- Verificar `audit_logs`.
- Ejecutar advisors.
