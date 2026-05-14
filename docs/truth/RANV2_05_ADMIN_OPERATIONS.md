# RANV2-05 Admin Operations

## Estado

RANV2-05 agrega el panel admin minimo para alumnos, planes, membresias y pagos manuales.

La migracion y la Edge Function quedan versionadas en Git, pero no aplicadas/desplegadas en este bloque.

## RPCs

La migracion `20260514030000_ranv2_05_admin_operations.sql` crea:

- `public.assign_membership(...)`: asigna una membresia activa y audita `membership.assigned`.
- `public.register_manual_payment(...)`: registra un pago manual pendiente y audita `payment.registered`.
- `public.approve_manual_payment(...)`: aprueba un pago pendiente, renueva la membresia, actualiza `profiles.last_payment_at` y `profiles.last_real_activity_at`, y audita `payment.approved`.
- `public.reject_manual_payment(...)`: rechaza un pago pendiente, conserva notas previas, agrega motivo si existe y audita `payment.rejected`.

Todas las RPCs son admin-only, usan `private.is_admin()`, son `security definer`, tienen `search_path` controlado y no conceden permisos a `anon`.

## Edge Function

`supabase/functions/create-student/index.ts` queda preparada para crear alumnos desde admin:

- Recibe nombre, apellido, email, telefono, contrasena provisoria y preferencia de emails.
- Requiere JWT de admin activo.
- Usa `SUPABASE_SERVICE_ROLE_KEY` solo desde variables de entorno de la funcion.
- Crea usuario Auth, profile `student` y audit log `student.created`.
- No devuelve ni guarda la contrasena.
- Si falla luego de crear el usuario Auth, devuelve una inconsistencia explicita para revision manual.

Pendiente: deploy de la Edge Function en bloque posterior.

## Frontend

Rutas operativas:

- `/admin/students`: listado de alumnos, ficha, edicion basica, alta por Edge Function, asignacion de membresia y registro de pago manual.
- El listado de alumnos incluye busqueda por nombre, apellido, email y telefono.
- La ficha y los formularios del alumno se limpian si el buscador oculta al alumno seleccionado, evitando operar sobre un alumno que ya no esta visible.
- `/admin/plans`: listado de planes, actividades vinculadas de solo lectura y edicion de precio, descripcion y estado.
- `/admin/payments`: listado de pagos con filtros, registro manual, aprobacion y rechazo.

Los precios reales se editan desde el panel. Si un precio sigue en `0`, la UI muestra `Pendiente de definir precio real`.

El registro de pago manual permite elegir fecha con calendario. Esa fecha se persiste en `payments.paid_at` desde la RPC `register_manual_payment`.

## Limites

- Pagos son manuales: efectivo o transferencia.
- WhatsApp solo se usa como nota/comprobante, sin API.
- No hay Mercado Pago ni Stripe.
- No hay reservas reales en este bloque.
- No hay Mailjet, Google Drive, Cloudflare ni Edge Functions desplegadas.
- No hay `db push` real en este bloque.
- La carga de archivos y Google Drive real quedan pendientes para RANV2-09/RANV2-11.
