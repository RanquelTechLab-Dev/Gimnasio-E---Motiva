# Calendar Engine Fix Plan

Fecha: 2026-06-18
Rama: `ranqueltechlab/ran-34-calendar-system-audit-contract`

## Causa Raiz

El calendario no tiene un contrato unico entre reglas recurrentes, sesiones materializadas, excepciones y sesiones protegidas por reservas/asistencia.

Hoy una `class_session` con `recurring_rule_id` puede ser:

- derivada pura de una regla;
- ocurrencia editada puntualmente;
- ocurrencia cancelada;
- registro historico protegido;
- sesion futura que quedo activa aunque la regla madre cambio o se inactivo.

Esa ambiguedad explica los sintomas:

- clases futuras viejas que siguen apareciendo;
- reglas inactivas que todavia tienen sesiones activas;
- sesiones cuyo activity/hora no coincide con su regla;
- necesidad de ocultar canceladas desde frontend;
- errores genericos tipo `NetworkError` sin contexto.

## Decision Recomendada

Hacer un PR de estabilizacion con migracion pequena pero contractual. No conviene otro parche solo frontend.

La migracion debe redefinir las RPCs del calendario para que cada operacion tenga una sola puerta y devuelva resultado estructurado. El frontend debe dejar de inferir estados de negocio y solo renderizar el contrato.

## Contrato Final Propuesto

### Crear clase puntual

- Crea `class_sessions` sin `recurring_rule_id`.
- Bloquea duplicada activa real en mismo rango si corresponde.
- No toca reglas recurrentes.
- Devuelve `{ ok, action, message }`.

### Crear horario recurrente

- Crea `class_recurring_rules active=true valid_until=null` por defecto.
- Bloquea solo regla activa con vigencia superpuesta real.
- No bloquea por reglas inactivas/cerradas.
- No bloquea por sesiones canceladas/inactivas.
- Materializa el rango operativo definido por el motor.
- Si restaura una excepcion puntual cancelada, debe retornar `action = restored_occurrence`.

### Editar solo esta clase

- Modifica solo `class_sessions.id`.
- Si pertenece a una regla recurrente, crea una excepcion/override explicita o marca la sesion como override de forma consistente.
- No cambia la regla madre.
- Si tiene reservas/asistencia, valida cupo y restricciones historicas.

### Editar horario recurrente

- Cierra regla vieja hasta fecha X - 1 o la inactiva desde X.
- Crea regla nueva desde X.
- Reconcila futuras sesiones viejas:
  - sin reservas/asistencia: `active=false`, `cancelled_at` no null, razon clara;
  - con reservas/asistencia: skipped, no tocadas.
- Materializa futuras de la nueva regla.
- Devuelve `affected_sessions`, `skipped_sessions`, `warnings`.

### Cancelar solo esta fecha

- Cancela solo la sesion elegida.
- Si viene de recurrente, crea `class_recurring_rule_exceptions.action = 'cancelled'`.
- No desactiva la regla.
- No borra bookings ni attendance.

### Pausar horario recurrente

- Desactiva o cierra la regla desde fecha X.
- Reconcila futuras sesiones sin reservas/asistencia.
- Deja skipped las futuras con reservas/asistencia.
- No borra historial.
- Permite crear otro horario igual despues.

### Render calendario operativo

- La RPC operativa debe devolver solo `class_sessions.active = true and cancelled_at is null`.
- Las canceladas/inactivas deben ir a una futura RPC/panel de auditoria.
- La grilla no debe inflar filas horarias sin clases reales activas.

### Modo auditoria

- Puede listar canceladas, inactivas, skipped e inconsistentes.
- No debe mezclarse con la grilla principal de Carolina.

## Archivos A Tocar

Backend/migracion:

- Nueva migracion Supabase: requerida.
- `public.admin_create_class_recurring_rule`
- `public.admin_delete_class_session`
- `public.admin_archive_class_recurring_rule`
- `public.admin_update_class_recurring_rule_from_session`
- `public.materialize_recurring_class_sessions`
- `private.materialize_recurring_class_sessions`
- `private.reconcile_future_recurring_sessions`
- Posible nueva RPC: `public.admin_list_calendar_audit_sessions` si se decide exponer modo auditoria.

Frontend:

- `src/admin/api.ts`
- `src/admin/AdminCalendarPage.tsx`
- `src/components/calendar/WeeklyScheduleGrid.tsx`
- `src/admin/types.ts`

Docs/tests:

- `docs/calendar/CALENDAR_ENGINE_AUDIT.md`
- `docs/calendar/CALENDAR_ENGINE_FIX_PLAN.md`
- Checklist manual en este archivo si no existe infraestructura de tests automatizados.

## Migracion Necesaria

Si. La correccion real vive en RPCs y contrato de datos. No alcanza con frontend porque:

- `list_calendar_sessions` sigue devolviendo canceladas/inactivas a admins.
- Hay drift real entre sesiones materializadas y reglas.
- Las operaciones de recurrente deben ser transaccionales y auditables.
- El bloqueo/restore de duplicados debe depender de reglas activas y vigencias, no de sesiones viejas.

No debe incluir:

- `DELETE FROM public.payments`
- `DELETE FROM public.profiles`
- `DELETE FROM public.memberships`
- `DELETE FROM public.bookings`
- `DELETE FROM public.attendance`
- `DELETE FROM public.files`
- `TRUNCATE`
- `DROP TABLE`

Hard delete de calendario tampoco se recomienda en esta fase. Usar soft delete/cancelacion controlada.

## Seguridad/RLS/RPC

Cada RPC de escritura debe:

- validar `auth.uid()`;
- validar admin activo con `private.is_admin()`;
- usar `SECURITY DEFINER`;
- fijar `search_path = public, private`;
- hacer grants explicitos a `authenticated`;
- no conceder execute a `anon`;
- devolver errores SQL claros;
- retornar JSON estructurado.

Formato recomendado:

```json
{
  "ok": true,
  "action": "updated_series",
  "affected_sessions": 8,
  "skipped_sessions": 1,
  "warnings": [],
  "message": "Horario recurrente actualizado."
}
```

## Error Handling Frontend

Agregar un wrapper para llamadas RPC de calendario que preserve:

- nombre de RPC;
- parametros no sensibles relevantes;
- status HTTP si existe;
- code/details/hint/message de Supabase;
- si fue error de red real.

UI esperada:

- No mostrar solo `TypeError: NetworkError when attempting to fetch resource.`
- Mostrar algo como: `No se pudo crear el horario recurrente. RPC: admin_create_class_recurring_rule. Revisa conexion o deployment.`
- Si Supabase devuelve SQL error, mostrar mensaje de negocio.

## Riesgos

- Si se reconcilian futuras sesiones sin revisar reservas/asistencia, se puede ocultar una clase con alumnos.
- Si se filtra demasiado en `list_calendar_sessions`, admin podria perder visibilidad de auditoria. Por eso conviene separar RPC operativa y RPC auditoria.
- Si se materializa demasiado lejos, se generan muchas filas futuras y mas superficie para drift.
- Si se materializa demasiado corto, Carolina cree que la recurrente "termina". La UI debe aclarar que el horizonte tecnico no es vencimiento.
- Si se crea una regla nueva sin cerrar bien la vieja, vuelven duplicados.

## Rollback

Antes de aplicar migracion:

- `db push --dry-run` debe mostrar solo la nueva migracion.
- Revisar definiciones anteriores en migraciones recientes: `20260615215742` y `20260616194603`.
- Si falla post-deploy, revertir por nueva migracion que restaure las funciones anteriores, no editar migraciones ya aplicadas.

Despues de aplicar:

- Validar `list_calendar_sessions` en rango actual.
- Validar que admin puede crear, pausar y recrear recurrente.
- Validar que no se borraron bookings/attendance.

## Checklist Manual Obligatorio

1. Crear recurrente viernes 07:00.
2. Crear duplicada activa igual: debe bloquear.
3. Pausar recurrente.
4. Crear nuevamente igual: debe permitir.
5. Crear clase puntual, eliminarla y volver a crearla: debe permitir.
6. Cancelar solo una ocurrencia recurrente: no aparece en esa fecha y la serie sigue.
7. Avanzar semanas futuras: la serie sigue.
8. Editar serie: semanas futuras muestran horario nuevo.
9. Futuras con reservas/asistencia quedan skipped.
10. Canceladas/inactivas no aparecen en grilla operativa.
11. No aparece fila 21:00 si no hay clases reales activas.
12. Cognitivo solo viernes 14:00.
13. Lunes 14:00 y miercoles 14:00 respetan mapping real existente.
14. Error de red/RPC muestra mensaje util.

## Pruebas Automatizables Recomendadas

Si se agrega infraestructura, empezar por tests SQL en entorno local:

- `admin_create_class_recurring_rule` bloquea duplicada activa.
- `admin_create_class_recurring_rule` permite crear cuando regla previa esta inactiva.
- `admin_delete_class_session(..., 'series')` no toca sesiones con booking/attendance.
- `admin_update_class_recurring_rule_from_session` reporta skipped.
- `list_calendar_sessions` no devuelve canceladas/inactivas para grilla operativa.

Frontend:

- Test unitario de `formatAdminError` o wrapper nuevo para preservar RPC/status.
- Test de `WeeklyScheduleGrid` sin fila 21:00 cuando no hay sesiones activas.
- Test de mensajes de warning cuando `skipped_sessions > 0`.

## Criterios De Aceptacion

- Crear recurrente no da `NetworkError` generico; si falla, muestra RPC/status/mensaje accionable.
- No hay sesiones futuras activas cuyo `recurring_rule_id` contradiga activity/hora/weekday sin excepcion registrada.
- Pausar serie no deja sesiones futuras viejas visibles si no tienen reservas/asistencia.
- Editar serie muestra futuras nuevas y reporta skipped.
- La grilla principal muestra solo sesiones operativas.
- No se borran pagos, alumnos, memberships, files, bookings ni attendance.
- `npm run build`, `npm run lint`, `git diff --check` OK.
- `db push --dry-run` controlado antes de cualquier migracion real.

## Recomendacion De Release

No aplicar migracion todavia desde este PR de auditoria. Usar este PR para alinear contrato y evidencia, y abrir un PR siguiente de implementacion con una migracion unica, revisada y probada contra preview.
