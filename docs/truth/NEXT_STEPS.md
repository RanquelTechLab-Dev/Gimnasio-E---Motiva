# Next Steps

## Actual

RAN-25 / RANV2-09: plan de entrenamiento, observaciones y archivos.

## Siguiente

RAN-25 / RANV2-09: revisar PR, aplicar migracion con `db push` real en bloque posterior y probar admin/alumno reales.

## Pendiente

- No guardar secrets en el repo.
- Revisar PR RANV2-09.
- Ejecutar `db push --dry-run` y luego `db push` real solo en bloque posterior aprobado.
- Probar admin `/admin/students` con ficha de alumno.
- Crear/editar plan de entrenamiento y observaciones.
- Crear/editar metadata de documento.
- Probar `/app/files` con alumno real y visibilidad propia.
- Verificar audit logs `training_note.*` y `file_metadata.*`.
- Google Drive real y subida binaria quedan fuera.
- Pagos online, Mailjet, Cloudflare y deploy quedan fuera de RANV2-09.
