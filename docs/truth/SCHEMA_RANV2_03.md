# RANV2-03 Schema inicial + RLS

## Estado

Este documento resume la migracion inicial versionada de Supabase para E-Motiva App Gimnasio v2.

Migracion:

```text
supabase/migrations/20260514010000_ranv2_03_initial_schema_rls.sql
```

## Tablas

- `profiles`: perfil asociado a `auth.users`, rol `admin` o `student`, estado activo y preferencias.
- `activities`: actividades del gimnasio.
- `plans`: planes disponibles, con precios reales pendientes de carga por admin.
- `plan_activities`: relacion entre planes y actividades permitidas.
- `memberships`: membresias de alumnos.
- `payments`: pagos manuales por efectivo o transferencia.
- `class_sessions`: clases/sesiones programadas.
- `bookings`: reservas de alumno para clases.
- `attendance`: asistencia registrada por admin.
- `training_notes`: plan de entrenamiento y observaciones, sin llamarlo historia medica.
- `files`: metadata de archivos, preparado para Google Drive futuro sin integracion real todavia.
- `email_logs`: registro futuro de emails, preparado para Mailjet sin envio real todavia.
- `drive_status`: monitoreo futuro de espacio Drive.
- `audit_logs`: auditoria operativa.

## Tipos

- `user_role`: `admin`, `student`
- `membership_status`: `active`, `suspended`, `expired`, `cancelled`
- `payment_method`: `cash`, `transfer`
- `payment_status`: `pending`, `approved`, `rejected`
- `booking_status`: `booked`, `cancelled`, `attended`, `no_show`
- `attendance_status`: `present`, `absent`, `justified`
- `file_kind`: `training_plan`, `observation`, `attachment`

`audit_logs.action` queda como `text` para permitir crecimiento sin migraciones de enum por cada accion nueva.

## RLS

RLS queda habilitado en todas las tablas publicas creadas.

Regla general:

- Admin activo: gestiona tablas operativas.
- Alumno autenticado: lee su propia informacion y catalogos activos.
- Alumno no escribe pagos, membresias, planes, actividades, emails, Drive ni auditoria.

## Policies por rol

- `profiles`: admin gestiona; alumno lee su propio perfil.
- `activities`, `plans`, `plan_activities`: alumnos autenticados leen catalogos activos; admin gestiona.
- `memberships`, `payments`: admin gestiona; alumno lee sus propios registros.
- `class_sessions`: alumnos autenticados leen clases activas; admin gestiona.
- `bookings`: admin gestiona; alumno lee sus reservas.
- `attendance`: admin gestiona; alumno lee su asistencia.
- `training_notes`, `files`: admin gestiona; alumno lee sus propios registros.
- `email_logs`, `drive_status`, `audit_logs`: acceso admin.

## Seeds

Actividades base:

- Funcional
- Semi personalizado
- Ninos
- Cognitivo
- Personalizado 1:1

Planes base:

- Plan funcional
- Plan semi personalizado
- Plan ninos
- Plan cognitivo
- Plan personalizado 1:1

Los precios quedan en `0` porque no hay precios reales confirmados. Deben cargarse por admin en un bloque posterior.

## Limites honestos

- No se crean usuarios Auth.
- No se crea profile admin.
- No se ejecuta `db push` real en este bloque.
- No hay integracion real con Mailjet, Google Drive ni Cloudflare.
- No hay pagos online.
- No hay UI real de reservas en este bloque.
- La escritura de reservas por alumno queda para RPC/backend posterior, porque validar plan, membresia activa, cupo y regla de cancelacion 24h de forma segura excede una policy simple.
- La actualizacion del perfil por alumno queda para RANV2-04/RPC posterior, para evitar abrir updates amplios sobre `profiles`.
