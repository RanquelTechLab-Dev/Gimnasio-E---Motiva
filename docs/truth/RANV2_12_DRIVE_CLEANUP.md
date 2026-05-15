# RANV2-12 - Limpieza controlada de Google Drive

RANV2-12 agrega una limpieza segura de archivos reales en Google Drive cuando
el espacio queda en umbral critico.

## Alcance

- Edge Function `cleanup-drive-files`.
- `/admin/storage` permite generar una vista previa de limpieza.
- La funcion consulta cuota real con OAuth de `e.motiva.gym@gmail.com`.
- La seleccion prioriza el alumno con mayor tiempo sin pago, membresia o
  actividad real.
- La limpieza real requiere `dryRun = false` y `force = true`.
- La PR inicial no ejecuta limpieza real ni borra archivos.

## Regla de candidato

La funcion evalua alumnos con archivos Drive elegibles en `public.files`:

- `profiles.last_real_activity_at`
- `profiles.last_attendance_at`
- `profiles.last_payment_at`
- pagos `approved`
- fecha de fin/actualizacion de membresias

El candidato es el alumno con menor `derived_last_activity_at`. Si no hay
actividad registrada, queda primero para revision.

## Archivos elegibles

Solo se consideran filas de `public.files` con:

- `archived_at is null`
- `drive_file_id is not null`

No se borran:

- pagos
- membresias
- reservas
- asistencia
- `audit_logs`
- `email_logs`
- perfil minimo del alumno
- `training_notes`

## Ejecucion real

Cuando se habilite operativamente:

```json
{
  "dryRun": false,
  "force": true,
  "maxFiles": 50,
  "studentId": null
}
```

La funcion borra el archivo real en Drive y luego marca la metadata de
`public.files` con `archived_at` y `updated_by`.

## Auditoria

La funcion registra:

- `drive_cleanup.dry_run`
- `drive_cleanup.executed`

La metadata incluye cuota, umbral, candidatos, alumno seleccionado, archivos
seleccionados, archivos borrados y metadata archivada.

## Fuera de alcance

- No cron automatico.
- No envio Mailjet.
- No limpieza de pagos, membresias, reservas, asistencia ni auditoria.
- No limpieza de notas operativas.
- No RANV2-13/RAN-29.

## Deploy pendiente

Despues del merge:

```text
npx supabase@2.98.2 functions deploy cleanup-drive-files
```

No hay migracion nueva porque se reutilizan `files`, `drive_status` y
`audit_logs`.
