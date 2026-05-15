# Next Steps

## Actual

RAN-28 / RANV2-12: Limpieza automatica por alumno sin pago mas antiguo.

## Siguiente

Revisar PR de limpieza controlada Drive, desplegar `cleanup-drive-files` y validar dry-run remoto.

## Pendiente

- No guardar secrets en el repo.
- No ejecutar limpieza real en PR inicial.
- Desplegar `cleanup-drive-files` despues de merge.
- Validar dry-run remoto desde `/admin/storage`.
- Verificar `drive_cleanup.dry_run` en `audit_logs`.
- Autorizar ejecucion real solo si Drive esta en umbral critico o Walter lo confirma.
- No cargar credenciales Google en Cloudflare o frontend.
- Pagos online, Mailjet, WhatsApp API y RAN-29 quedan fuera de RANV2-12.
