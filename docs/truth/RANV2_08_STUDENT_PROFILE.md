# RANV2-08 - Perfil alumno y autogestion

RANV2-08 habilita el area real del alumno en `/app` con datos propios desde
Supabase.

## Alcance

- Dashboard alumno con resumen de perfil, membresia, creditos, proxima reserva,
  ultimo pago y ultima asistencia.
- Perfil alumno con edicion limitada:
  - telefono;
  - preferencia `receives_emails`.
- Reservas propias con `list_my_bookings` y cancelacion por `cancel_booking`.
- Pagos propios solo lectura.
- Asistencia propia solo lectura.
- Archivos propios solo lectura con estado vacio cuando no haya datos.

## RPCs

La migracion `20260514100000_ranv2_08_student_profile_self_service.sql` agrega:

- `public.get_my_profile_summary()`
- `public.update_my_profile_preferences(phone, receives_emails)`
- `public.list_my_payments()`
- `public.list_my_attendance()`
- `public.list_my_files()`

Todas requieren `auth.uid()`, operan sobre el alumno autenticado, usan
`security definer`, `search_path` controlado, revocan `public/anon` y conceden
ejecucion a `authenticated`.

## Seguridad

- El alumno no puede cambiar email, rol, estado, marcadores de pago/asistencia
  ni datos administrativos.
- La actualizacion de perfil audita `profile.updated_by_student`.
- El frontend no usa `service_role` ni secrets.
- `/admin` sigue protegido por guard admin.

## Fuera de alcance

- No pagos online.
- No Mailjet.
- No Google Drive real.
- No Cloudflare/deploy.
- No WhatsApp API.
- No RANV2-09/RANV2-11 archivos reales.
- No RAN-25 ni bloques posteriores.

## Validacion esperada

- `npm run build`
- `npm run lint`
- `git diff --check`
- `npx supabase@2.98.2 migration list`
- `npx supabase@2.98.2 db push --dry-run`

No ejecutar `db push` real hasta bloque posterior.
