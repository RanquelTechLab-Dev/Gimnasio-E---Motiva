# RANV2-06 Calendar Bookings

## Estado

RANV2-06 agrega calendario, clases y reservas con cupos desde una migracion versionada y UI admin/alumno.

La migracion queda pendiente de `db push` real hasta revision y merge de PR.

## Reglas

- El cupo vive en `class_sessions.capacity`.
- El admin no sobrepasa cupo en MVP.
- El alumno reserva solo si tiene profile activo, membresia activa/vigente, plan que permite la actividad, cupo disponible y creditos suficientes.
- `remaining_credits = null` significa creditos ilimitados.
- Si `remaining_credits` tiene valor, se descuenta 1 credito al reservar.
- RANV2-06B ajusta las ventanas de cancelacion:
  - clases comunes: hasta 12 horas antes del inicio;
  - personalizado 1:1 (`requires_24h_cancel = true`): hasta 24 horas antes del inicio.
- Si la cancelacion es a tiempo, se devuelve el credito una sola vez.
- Si el alumno intenta cancelar fuera de ventana, la RPC bloquea la cancelacion con un error claro; la reserva queda `booked` para que la asistencia automatica la consuma al finalizar la clase.
- Si un admin cancela fuera de ventana por correccion operativa, no se devuelve credito y la reserva queda marcada como `charged_as_attended`.
- La asistencia final queda fuera de RANV2-06.

## RPCs

La migracion `20260514050000_ranv2_06_calendar_bookings.sql` crea:

- `public.create_class_session(...)`
- `public.update_class_session(...)`
- `public.cancel_class_session(...)`
- `public.book_class_session(...)`
- `public.cancel_booking(...)`
- `public.list_calendar_sessions(...)`
- `public.list_my_bookings()`

La migracion `20260514090000_ranv2_06b_cancel_windows.sql` recrea:

- `public.cancel_booking(...)`
- `public.list_my_bookings()`

El objetivo es preservar la firma de las RPCs y aplicar las ventanas 12h/24h sin tocar migraciones ya aplicadas.

Todas las escrituras operativas validan sesion, rol o propiedad del recurso desde Supabase. Las funciones usan `security definer`, `search_path` controlado, revocan `public/anon` y conceden ejecucion a `authenticated`.

## Frontend

- `/admin/calendar`: vista de clases, filtros por rango, crear/editar/cancelar clase, cupos y estado.
- `/app/calendar`: clases disponibles, cupos, elegibilidad y reserva.
- `/app/my-bookings`: reservas propias, cancelacion y estado de creditos.

## Fuera de alcance

- No pagos online.
- No asistencia final.
- No Mailjet.
- No Google Drive.
- No Cloudflare.
- No WhatsApp API.
- No RANV2-07.

## Validacion esperada

- `npm run build`
- `npm run lint`
- `git diff --check`
- `npx supabase@2.98.2 migration list`
- `npx supabase@2.98.2 db push --dry-run`

No ejecutar `db push` real hasta bloque posterior.
