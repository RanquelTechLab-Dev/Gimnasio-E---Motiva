# Source of Truth

## Proyecto

E-Motiva App Gimnasio v2.

## Motivo del reboot

El intento tecnico anterior quedo contaminado por perdida de trazabilidad de migraciones Supabase. RAN-7 fue aplicado en Supabase remoto, pero los SQL reales no quedaron versionados en Git/GitHub. Eso bloqueo `db push --dry-run` y rompio el flujo profesional de migraciones.

Este repo v2 arranca desde cero tecnico para que GitHub, Linear y Supabase queden alineados desde el primer bloque.

## Repositorio activo

`RanquelTechLab-Dev/Gimnasio-E---Motiva`

Clone URL:

```text
https://github.com/RanquelTechLab-Dev/Gimnasio-E---Motiva.git
```

## Repositorio historico

`RanquelTechLab-Dev/Gimnasio-E--Motiva`

No es fuente activa. No se copian migraciones, ramas ni codigo viejo sin auditoria y autorizacion explicita de Walter.

## Linear activo

Proyecto: E-Motiva App Gimnasio v2

Issue actual: RAN-21 - RANV2-05 - Panel admin: alumnos, planes y pagos manuales.

## Supabase

Proyecto activo: `emotiva-gym-app-v2`

- Project ref: `kmfxgeqxulwaauracyzs`
- Organizacion: `RanquelTechLab-Dev's Org`
- Region: `sa-east-1` (South America / Sao Paulo)

Regla: todo schema nace desde `supabase/migrations`. Ninguna tabla se crea manualmente en Dashboard. Ningun `db push` se ejecuta sin `db push --dry-run` previo.

Estado actual:

- Proyecto Supabase nuevo creado y linkeado localmente.
- Schema inicial aplicado desde migracion versionada.
- RLS activo sobre tablas publicas.
- Seeds base de actividades y planes aplicados.
- Auth frontend real validado.
- Panel admin operativo en ejecucion para RANV2-05.

## Stack previsto

- GitHub
- VS Code
- Codex
- Linear
- React + Vite + TypeScript + Tailwind CSS
- Supabase
- Mailjet
- Google Drive
- Cloudflare

## Datos confirmados

- Nombre visible: E-Motiva
- Admin: `e.motiva.gym@gmail.com`
- WhatsApp: `+5493582430953`

## Estado actual

RAN-21 esta en ejecucion.

- Frontend base creado con React, Vite, TypeScript y Tailwind.
- Router base y layouts iniciales creados.
- Supabase nuevo limpio creado y linkeado.
- Migracion inicial + RLS aplicada en Supabase remoto.
- Migracion RANV2-04 de hardening de policies aplicada en Supabase remoto.
- Login email/password y guards admin/alumno agregados.
- UX publica simplificada: sin accesos publicos a paneles internos.
- Usuario Auth admin y profile admin creados/verificados.
- Login admin, `/admin`, `/app`, logout y guards sin sesion validados.
- RANV2-05 agrega panel operativo para alumnos, planes, membresias y pagos manuales.
- La migracion RANV2-05 queda local hasta revision/merge y `db push` real posterior.
- Edge Function `create-student` queda versionada localmente y pendiente de deploy.
