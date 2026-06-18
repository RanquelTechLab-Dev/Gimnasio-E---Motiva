# Calendar Engine Audit

Fecha: 2026-06-18
Rama: `ranqueltechlab/ran-34-calendar-system-audit-contract`
Proyecto Supabase: `emotiva-gym-app-v2` (`kmfxgeqxulwaauracyzs`)

## Objetivo

Auditar el motor de calendario de E-Motiva despues de PR #103, PR #104 y PR #105. La prioridad es estabilizar recurrencia, edicion, pausa, borrado logico, materializacion futura y mensajes de error antes de seguir con parches aislados.

Este documento es read-only. No se ejecutaron `UPDATE`, `DELETE`, `INSERT`, `db push` real ni limpieza de datos.

## Preflight

- Repo: `C:/Users/walte/OneDrive/Desktop/Gimnasio-E---Motiva`
- Remote: `https://github.com/RanquelTechLab-Dev/Gimnasio-E---Motiva.git`
- `origin/main...HEAD`: `0 0`
- `npm run build`: OK
- `npm run lint`: OK
- `git diff --check`: OK
- `npx.cmd supabase@2.98.2 db push --dry-run`: `Remote database is up to date`
- `npx.cmd supabase@2.98.2 migration list`: local/remoto alineados hasta `20260616194603`

## Linear

Se intento comentar `RAN-34` con:

`Reopened / follow-up audit: calendar recurrence engine still unstable after PR #103/#104/#105.`

Resultado: bloqueado por workspace visible. El conector Linear expone `bot-ia-trading` y no encuentra `RAN-34`. La busqueda devuelve issues `RTLOPS-*`, incluyendo una issue cancelada que indica que trabajo de E-Motiva fue creado alli por error. No se creo comentario.

## Modelo Conceptual

Clase puntual: una fila en `public.class_sessions` sin `recurring_rule_id`.

Regla recurrente: una fila en `public.class_recurring_rules`. Es la intencion operativa de Carolina: actividad, dia, hora, cupo, vigencia y si sigue activa.

Ocurrencia materializada: una fila en `public.class_sessions` con `recurring_rule_id`. Debe representar una ocurrencia derivada de la regla, salvo que exista una excepcion u override explicito.

Excepcion puntual: una fila en `public.class_recurring_rule_exceptions`. Hoy tiene `recurring_rule_id`, `occurrence_starts_at`, `occurrence_ends_at`, `action`, `class_session_id`, `created_by`, `created_at`. No tiene columna booleana `cancelled`.

Cancelacion puntual: debe afectar solo una `class_session`. Si viene de regla recurrente, debe crear una excepcion `action = 'cancelled'` para evitar que la materializacion la regenere.

Pausa de serie: debe cerrar/desactivar la regla desde una fecha y reconciliar futuras sesiones materializadas.

Edicion puntual: debe tocar solo la `class_session` elegida. Si pertenece a una regla, necesita una excepcion u override claro para no ser pisada por futuras materializaciones.

Edicion de serie: debe cerrar la regla vieja desde fecha X, crear/actualizar la regla nueva desde X, reconciliar futuras sesiones viejas y materializar nuevas sesiones.

Clase con reserva: cualquier sesion con booking activo (`booked`, `attended`, `no_show`) debe ser protegida en operaciones masivas.

Clase con asistencia: cualquier sesion con `attendance` debe ser protegida. No debe borrarse ni modificarse historicamente sin regla explicita.

## Fuente De Verdad

`class_recurring_rules` debe mandar para la intencion recurrente futura.

`class_sessions` manda para clases puntuales y para el historial operativo. Cuando una sesion materializada ya tiene reservas o asistencia, deja de ser un derivado descartable y pasa a ser registro protegido.

`class_recurring_rule_exceptions` debe mandar para cancelaciones puntuales o overrides de ocurrencias recurrentes.

El frontend no debe decidir reglas de negocio de calendario. Puede ocultar canceladas en la grilla operativa, pero la lista operativa idealmente ya deberia venir filtrada por RPC.

## Estados Permitidos

- Sesion operativa visible: `class_sessions.active = true` y `cancelled_at is null`.
- Sesion cancelada/inactiva: `active = false` o `cancelled_at is not null`.
- Regla activa: `class_recurring_rules.active = true` y vigencia superpuesta al rango consultado.
- Regla cerrada/inactiva: `active = false` o `valid_until` anterior al rango operativo.
- Excepcion cancelada: `class_recurring_rule_exceptions.action = 'cancelled'`.
- Futuras skipped: sesiones futuras con reservas/asistencia que una operacion de serie no debe tocar automaticamente.

## Reglas Inviolables

- Una clase con `attendance` nunca se borra.
- Una clase con booking activo no se cancela masivamente sin decision explicita.
- Una regla inactiva no bloquea crear otra igual.
- Una regla sin vigencia superpuesta no bloquea.
- Las recurrentes son perpetuas hasta que Carolina las pause.
- El limite tecnico de materializacion no es vencimiento funcional.
- El calendario operativo no muestra canceladas/inactivas.
- El modo auditoria puede listarlas, pero no dentro de la grilla principal.

## Inventario De Tablas

- `public.activities`: catalogo de actividades principales. Incluye slug, color, estado, cupos default/max y cutoffs.
- `public.class_recurring_rules`: reglas recurrentes con `weekday`, `start_time`, `end_time`, `capacity`, `active`, `valid_from`, `valid_until`.
- `public.class_recurring_rule_exceptions`: excepciones por ocurrencia. Columna `action` modela la excepcion.
- `public.class_sessions`: ocurrencias puntuales o materializadas. Contiene `active`, `cancelled_at`, `cancelled_by`, `cancel_reason`, `recurring_rule_id`.
- `public.bookings`: usa `session_id` para vincular reservas con clases. Estados consumidores: `booked`, `attended`, `no_show`.
- `public.attendance`: usa `session_id` y `booking_id`.
- `public.audit_logs`: registro de acciones administrativas.

## Inventario De RPCs Relevantes

- `public.create_class_session(...)`
- `public.update_class_session(...)`
- `public.cancel_class_session(...)`
- `public.admin_delete_class_session(p_session_id uuid, p_scope text)`
- `public.admin_create_class_recurring_rule(...)`
- `public.admin_archive_class_recurring_rule(p_rule_id uuid)`
- `public.admin_update_class_recurring_rule_from_session(...)`
- `public.materialize_recurring_class_sessions(from_date, to_date)`
- `private.materialize_recurring_class_sessions(p_from_date, p_to_date)`
- `private.reconcile_future_recurring_sessions(p_rule_id, p_from_starts_at, p_actor, p_cancel_reason)`
- `public.list_calendar_sessions(from_date, to_date)`

Permisos verificados:

- RPCs publicas principales: `authenticated` tiene `EXECUTE`.
- `anon` no tiene `EXECUTE`.
- Helpers `private.materialize_recurring_class_sessions` y `private.reconcile_future_recurring_sessions`: no ejecutables por `authenticated` ni `anon`.

## Frontend Inventariado

- `src/admin/AdminCalendarPage.tsx`: orquesta formulario, crear/editar/cancelar/pausar y llama `loadData()` despues de operaciones.
- `src/admin/api.ts`: contiene las llamadas RPC. `createClassRecurringRule()` llama `admin_create_class_recurring_rule`.
- `src/components/calendar/WeeklyScheduleGrid.tsx`: desde PR #105 filtra en render `session.active === true && !session.cancelled_at`.
- `src/admin/types.ts`: `AdminActionResult` ya contempla campos de reconciliacion y warnings.

## Hallazgos Read-Only

### Reglas recurrentes activas

Hay reglas activas para Semipersonalizado, Neurofuncional, Personalizado 1:1 y Cognitivo. La mayoria tienen `valid_until = null`, lo cual coincide con la regla de negocio de recurrencia perpetua hasta pausa.

Ejemplos relevantes:

- Semipersonalizado lunes 07:00-08:00, capacidad 10, 11 sesiones futuras.
- Semipersonalizado lunes 14:00-15:00, capacidad 5, 11 sesiones futuras, 1 futura con booking.
- Neurofuncional lunes 17:00-18:00, capacidad 10.
- Personalizado 1:1 martes 07:00-08:00, capacidad 1.
- Cognitivo viernes 14:00-15:00, capacidad 5.

### Duplicados activos

Consulta de duplicados por `activity_id + weekday + start_time + end_time` con vigencia superpuesta y `active = true`: no devolvio filas.

Conclusion: el problema actual no parece ser reglas activas duplicadas identicas.

### Inconsistencias futuras detectadas

Se detectaron sesiones futuras materializadas que no coinciden con su regla madre:

| session_id | starts_at UTC | sesion | regla | problema |
| --- | --- | --- | --- | --- |
| `1d36bf20-b1df-4c31-8afb-8176e0e5a29f` | 2026-06-18 10:00 | `semi_personalizado` | `personalizado_1_1` | activity mismatch |
| `8cd34e8b-4d68-4ae5-9b09-e255d920fb1e` | 2026-06-18 12:00 | `semi_personalizado` | `semi_personalizado` inactive | active session from inactive rule, 1 booking |
| `9f6682ba-90ca-467b-bbc9-770cbfb44306` | 2026-06-18 20:00 | `semi_personalizado` | `personalizado_1_1` | activity mismatch |
| `88b7bbfa-4888-4e81-91ac-6b303e87b711` | 2026-06-19 11:00 | `semi_personalizado` | `neurofuncional` | activity mismatch |
| `5b0cd5ee-938b-4745-9077-e79b4a3826a7` | 2026-06-19 13:00 | `semi_personalizado` | `personalizado_1_1` | activity mismatch |
| `e762e4b1-8ddf-4039-999b-fa2b692ed102` | 2026-06-19 17:00 | `semi_personalizado` | `cognitivo` | activity mismatch |
| `97ef87b2-5699-4668-89b8-90c9a657ef31` | 2026-06-19 20:00 | `neurofuncional` | `neurofuncional` | start time mismatch |
| `e6c0d638-8d53-4f4d-a79b-81791d8fa9ef` | 2026-06-19 21:00 | `semi_personalizado` | `semi_personalizado` | start time mismatch |

Conclusion: existe drift entre reglas recurrentes y sesiones ya materializadas. Este es el hallazgo central.

### Sesiones canceladas/inactivas futuras

Hay 21 sesiones futuras canceladas o inactivas. El frontend ya las oculta en `WeeklyScheduleGrid`, pero `list_calendar_sessions` aun se las devuelve a admins porque la condicion es:

`and (v_is_admin or (s.active = true and s.cancelled_at is null))`

Conclusion: la grilla operativa ya no las muestra, pero el contrato sigue repartido: la RPC devuelve informacion operativa mezclada con auditoria para admins.

### Rango horario real

Para sesiones futuras activas y no canceladas:

- Minimo local: 07:00
- Maximo local: 19:00
- Sesiones activas a partir de 21:00: 0

Conclusion: la grilla operativa no debe mostrar fila 21:00 si no hay sesiones reales activas.

## Diagnostico NetworkError

Caso reportado: Admin -> Calendario -> crear clase recurrente muestra `TypeError: NetworkError when attempting to fetch resource.`

Endpoint esperado:

- Frontend: `src/admin/api.ts#createClassRecurringRule`
- RPC: `public.admin_create_class_recurring_rule`
- URL esperada: `/rest/v1/rpc/admin_create_class_recurring_rule`

Verificaciones realizadas:

- La funcion existe en DB remota.
- Tiene `SECURITY DEFINER`.
- Tiene `SET search_path TO 'public', 'private'`.
- `authenticated` tiene `EXECUTE`.
- `anon` no tiene `EXECUTE`.
- Logs API recientes muestran llamadas OK a `list_calendar_sessions`, `materialize_recurring_class_sessions`, `admin_delete_class_session` y `create_class_session`.
- En la ventana de logs consultada no aparece fallo claro de `admin_create_class_recurring_rule`.

Interpretacion:

No hay evidencia de RPC inexistente ni de grant faltante. Como el error visible es `NetworkError` y no un error PostgREST/SQL con status, hay dos posibilidades principales:

1. La request no esta llegando a Supabase desde el entorno donde se prueba, por CORS, red, env de preview/prod o deployment viejo.
2. El frontend esta mostrando un error generico porque `formatAdminError()` no preserva RPC, status, endpoint ni contexto de Supabase.

Pendiente para reproduccion UI:

- Confirmar en Network tab si sale `POST /rest/v1/rpc/admin_create_class_recurring_rule`.
- Confirmar status HTTP.
- Confirmar si existe preflight `OPTIONS`.
- Confirmar URL Supabase en Cloudflare preview/prod.
- Confirmar que el deploy usado contiene el codigo de `main`.

## Diagnostico Global

El calendario mezcla dos verdades:

- La regla recurrente como fuente de intencion futura.
- La sesion materializada como registro editable, historico y a veces derivado.

Cuando una sesion futura se edita o una regla se pausa/edita, el sistema no tiene un contrato completo que diga si esa `class_session` sigue siendo derivada, pasa a override, queda como skipped, o debe ser reemplazada. Por eso aparecen sesiones futuras con `recurring_rule_id` apuntando a una regla que ya no representa su actividad u horario.

PR #103/#104/#105 mejoraron flujos concretos, pero el contrato sigue incompleto:

- `list_calendar_sessions` para admin mezcla operativo y auditoria.
- La materializacion usa horizontes tecnicos y no un contrato explicito de visibilidad.
- `admin_create_class_recurring_rule` materializa solo 14 dias al crear.
- Las futuras materializadas pueden quedar activas aunque la regla cambie.
- El error handling de frontend no da suficiente contexto para diagnosticar red/RPC.

## Recomendacion

No aplicar una limpieza ni otra correccion puntual todavia. El siguiente PR debe implementar un contrato unico de calendario con migracion controlada y error handling visible. Antes de cualquier `db push` real, revisar el plan en `CALENDAR_ENGINE_FIX_PLAN.md`.
