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

Issue actual: RAN-19 - RANV2-03 - Supabase schema inicial + RLS versionado.

## Supabase

Proyecto activo: `emotiva-gym-app-v2`

- Project ref: `kmfxgeqxulwaauracyzs`
- Organizacion: `RanquelTechLab-Dev's Org`
- Region: `sa-east-1` (South America / Sao Paulo)

Regla: todo schema nace desde `supabase/migrations`. Ninguna tabla se crea manualmente en Dashboard. Ningun `db push` se ejecuta sin `db push --dry-run` previo.

Estado actual del preflight:

- Proyecto Supabase nuevo creado y linkeado localmente.
- No hay schema creado todavia.
- No se ejecuto `db push`.
- No se crearon tablas manualmente.

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

RAN-19 esta en ejecucion.

- Frontend base creado con React, Vite, TypeScript y Tailwind.
- Router base y layouts iniciales creados.
- Supabase nuevo limpio creado y linkeado.
- Proximo subbloque: migracion local inicial + RLS versionado.
