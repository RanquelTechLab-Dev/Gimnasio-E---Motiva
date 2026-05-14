# RANV2-09 - Plan de entrenamiento, observaciones y archivos

RANV2-09 agrega gestion operativa de informacion del alumno para administracion
y lectura segura para el alumno.

## Alcance

- Ficha admin del alumno con plan de entrenamiento activo o ultimo.
- Alta/edicion/archivo de notas de entrenamiento.
- Tipos de nota:
  - `training_plan`
  - `observation`
  - `follow_up`
  - `admin_note`
- Alta/edicion/archivo de metadata de documentos.
- Visibilidad controlada para alumno.
- `/app/files` muestra documentos propios visibles y planes de entrenamiento
  visibles.

## Tablas

Se reutilizan tablas existentes:

- `public.training_notes`
- `public.files`

La migracion `20260514110000_ranv2_09_training_notes_files.sql` agrega campos
minimos:

- `training_notes.note_type`
- `training_notes.visible_to_student`
- `training_notes.updated_by`
- `training_notes.archived_at`
- `files.description`
- `files.visible_to_student`
- `files.updated_by`
- `files.archived_at`

## RPCs

Admin:

- `public.admin_list_student_training_notes(student_id)`
- `public.admin_upsert_training_note(...)`
- `public.admin_archive_training_note(note_id)`
- `public.admin_list_student_files(student_id)`
- `public.admin_create_student_file_metadata(...)`
- `public.admin_update_student_file_metadata(...)`
- `public.admin_archive_student_file_metadata(file_id)`

Alumno:

- `public.list_my_files()` se actualiza para devolver solo archivos visibles y
  planes de entrenamiento visibles del alumno autenticado.

Todas las RPCs requieren `auth.uid()`, usan `security definer`, `search_path`
controlado, revocan `public/anon` y conceden ejecucion a `authenticated`.

## Auditoria

Acciones auditadas:

- `training_note.created`
- `training_note.updated`
- `training_note.archived`
- `file_metadata.created`
- `file_metadata.updated`
- `file_metadata.archived`

## Seguridad

- Alumno solo ve sus documentos/notas visibles.
- Alumno no crea, edita ni archiva archivos o notas.
- Admin gestiona datos desde `/admin/students`.
- No se usa `service_role` en frontend.
- No se guardan secrets.

## Fuera de alcance

- No Google Drive real.
- No OAuth.
- No subida binaria de archivos.
- No historia clinica compleja.
- No pagos online.
- No Mailjet.
- No Cloudflare/deploy.
- No WhatsApp API.
- No RANV2-10 ni bloques posteriores.

## Validacion esperada

- `npm install`
- `npm run build`
- `npm run lint`
- `git diff --check`
- `npx supabase@2.98.2 migration list`
- `npx supabase@2.98.2 db push --dry-run`

No ejecutar `db push` real hasta bloque posterior.
