# RANV2-11 - Google Drive storage externo

RANV2-11 integra Google Drive como storage externo para archivos de alumnos.
La metadata sigue viviendo en Supabase y el archivo real se sube desde backend
seguro.

## Alcance

- Edge Function `upload-student-file` para subir archivos a Google Drive.
- Edge Function `check-drive-status` para consultar cuota y actualizar
  `drive_status`.
- `/admin/students` permite subir archivo real para el alumno seleccionado.
- Admin mantiene alta/edicion manual de metadata cuando haga falta.
- `/app/files` sigue mostrando archivos propios visibles desde `list_my_files`.
- Si el archivo es visible, la funcion intenta dar permiso de lectura al email
  del alumno.
- La subida registra metadata en `public.files`.
- La subida audita `file.uploaded`.
- La consulta de cuota audita `drive_status.checked`.

## Modelo Google

MVP recomendado:

- Cuenta Drive dedicada: `e.motiva.gym@gmail.com`.
- Proyecto Google Cloud con Drive API habilitada.
- OAuth offline autorizado con la cuenta real `e.motiva.gym@gmail.com`.
- Carpeta raiz en Drive de esa cuenta.
- Edge Functions usan refresh token guardado como Supabase secret.
- Las consultas `about.storageQuota` se ejecutan como la cuenta real, por lo que
  miden la cuota gratuita de 15 GB de `e.motiva.gym@gmail.com`.

## Secrets requeridos

No guardar valores en Git.

```text
GOOGLE_CLIENT_ID
GOOGLE_CLIENT_SECRET
GOOGLE_REFRESH_TOKEN
GOOGLE_DRIVE_ROOT_FOLDER_ID
```

El refresh token debe pertenecer a la cuenta dedicada `e.motiva.gym@gmail.com`
para que la cuota consultada sea la de esa cuenta.

## Validaciones de upload

- Admin activo requerido.
- Alumno activo requerido.
- Tamano maximo: 10 MB.
- MIME permitido:
  - `application/pdf`
  - `image/jpeg`
  - `image/png`
  - `image/webp`
  - `application/msword`
  - `application/vnd.openxmlformats-officedocument.wordprocessingml.document`

## Estado de espacio

`check-drive-status` y `upload-student-file` consultan Drive quota. Si el
espacio restante es 10% o menos, devuelven `warning = true` para alerta visual.

`drive_status.warning_threshold` queda con `0.9`, que representa 90% usado.

## Fuera de alcance

- No limpieza automatica.
- No borrado de archivos reales.
- No pagos online.
- No Mailjet.
- No Cloudflare config.
- No WhatsApp API.
- No RANV2-12/RAN-28.

## Deploy pendiente

Despues del merge:

```text
npx supabase@2.98.2 secrets set GOOGLE_CLIENT_ID=... GOOGLE_CLIENT_SECRET=... GOOGLE_REFRESH_TOKEN=... GOOGLE_DRIVE_ROOT_FOLDER_ID=...
npx supabase@2.98.2 functions deploy upload-student-file
npx supabase@2.98.2 functions deploy check-drive-status
```

No hay migracion nueva para este bloque porque se reutilizan `files`,
`drive_status` y `audit_logs`.
