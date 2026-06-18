# Calendar Drift Repair - 2026-06-18

## Resumen

Post-merge de `RAN-34` el motor nuevo de calendario ya materializa y filtra mejor, pero en produccion quedaron dos problemas reales:

1. Reglas recurrentes activas que bloquean recreaciones aunque la ocurrencia no sea visible en la fecha actual.
2. `class_sessions` futuras materializadas con drift contra su regla madre.

Esto explica los casos reportados por Walter:

- editar Neurofuncional viernes 17:00 hacia Semipersonalizado bloquea por una regla activa ya existente;
- jueves 07:00 aparece como "ocupado" aunque la regla que bloquea empieza recien el `2026-07-02`;
- algunos cambios "vuelven atras" porque la regla cambia, pero sobreviven sesiones futuras viejas;
- aparecen huecos/filas infladas cuando el frontend recibe sesiones no operativas o inconsistentes.

## Hallazgos read-only confirmados

### Reglas activas conflictivas

- `Semipersonalizado` viernes `17:00-18:00`
  - `rule_id = 7cab75a9-db61-4c0a-a733-d5cf364903ea`
  - `valid_from = 2026-05-18`
- `Neurofuncional` viernes `17:00-18:00`
  - `rule_id = d2397951-1c52-4592-8afe-4da282d0ab58`
  - `valid_from = 2026-06-19`
- `Semipersonalizado` jueves `07:00-08:00`
  - `rule_id = b02a502d-e5fe-4dce-9fb6-ebaaaea134cc`
  - `valid_from = 2026-07-02`

### Drift de sesiones futuras

Lectura ya confirmada sobre datos reales:

- `558` sesiones recurrentes futuras visibles.
- `3` visibles colgadas de regla inactiva.
- `4` visibles con `activity mismatch` contra regla madre.
- `1` visible con mismatch de `weekday/start/end`.
- `11` futuras con `active = true` pero `cancelled_at` no nulo.
- `4` drift visibles reparables sin reservas/asistencia.
- `1` drift visible protegido con reservas/asistencia.

## Causa raiz

El conflicto no es una sola cosa:

1. La regla recurrente puede estar bien guardada y seguir activa.
2. Las sesiones futuras ya materializadas antes del cambio pueden quedar desfasadas.
3. Si la UI o la capa RPC no refrescan desde DB tras un conflicto, parece que el cambio "entro" cuando en realidad fue bloqueado.

En otras palabras: habia desalineacion entre `class_recurring_rules`, `class_sessions` y lo que el usuario estaba viendo en la grilla.

## Regla operativa para reparar

### Se puede reparar automaticamente

`SAFE_REPAIR_NO_HISTORY`

- sesion futura;
- sin reservas activas/consumidoras;
- sin asistencia;
- drift claro contra su regla madre o inconsistencia `active=true` + `cancelled_at not null`.

Accion:

- no se borra;
- se desactiva/cancela de forma consistente;
- luego se permite rematerializar correctamente desde la regla madre.

### Se protege y no se toca automaticamente

`PROTECTED_WITH_BOOKING_OR_ATTENDANCE`

- futura con reservas activas o asistencia.

Accion:

- queda `skipped`;
- no se borra;
- no se cancela automaticamente;
- requiere revision operativa manual.

### No tocar

`DO_NOT_TOUCH`

- sesiones pasadas;
- casos fuera de rango;
- sesiones que no entran como drift reparable.

## RPCs nuevas propuestas

### `public.admin_preview_calendar_drift(from_date, to_date)`

Read-only. Devuelve:

- reglas activas por actividad/dia/hora;
- drift detectado en sesiones futuras;
- bloqueos por reglas activas aunque la ocurrencia no sea visible en la fecha consultada;
- conteos `SAFE_REPAIR_NO_HISTORY`, `PROTECTED_WITH_BOOKING_OR_ATTENDANCE`, `DO_NOT_TOUCH`.

### `public.admin_repair_calendar_drift(from_date, to_date, dry_run default true)`

Modo seguro:

- `dry_run=true`: no toca nada, solo devuelve plan.
- `dry_run=false`: repara solo sesiones futuras seguras, audita, y rematerializa.

Nunca:

- borra `bookings`;
- borra `attendance`;
- toca pagos/alumnos/memberships/files;
- hace hard delete.

## Endurecimiento adicional

`public.admin_update_class_recurring_rule_from_session` debe bloquear antes de tocar nada cuando exista otra regla activa para la combinacion nueva:

- misma actividad;
- mismo dia;
- mismo horario;
- regla distinta a la editada;
- solapamiento vigente real.

El error tiene que mostrar:

- `conflicting_rule_id`
- actividad
- dia/horario
- `valid_from`
- `valid_until`
- aclaracion de que aunque no aparezca en la fecha actual, la regla sigue activa y bloquea.

## Querys read-only de referencia

### A. Reglas activas por actividad / dia / hora

```sql
select
  a.slug as activity_slug,
  r.weekday,
  r.start_time,
  r.end_time,
  r.valid_from,
  r.valid_until,
  r.active
from public.class_recurring_rules r
join public.activities a on a.id = r.activity_id
where r.active = true
order by a.slug, r.weekday, r.start_time, r.valid_from;
```

### B. Drift de sesiones futuras

Se materializa via helper privado de la migracion nueva para no duplicar logica de diagnostico entre preview y repair.

### C. Reglas que bloquean aunque no se vean en la fecha actual

La preview nueva calcula la proxima ocurrencia visible de cada regla activa desde la fecha consultada y reporta las que arrancan mas adelante.

## Alcance del fix

- migracion controlada nueva;
- ajuste chico de frontend para refrescar desde DB despues de conflicto critico;
- sin rollback de `#107`;
- sin saneamiento historico agresivo;
- sin cambios sobre pagos, alumnos, memberships o archivos.
