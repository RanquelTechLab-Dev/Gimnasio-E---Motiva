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

Issue actual: RAN-29 - RANV2-13 - PWA + responsive + UX final.

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
- Panel admin operativo para alumnos, planes, membresias y pagos manuales cerrado en RANV2-05.
- Calendario, clases y reservas cerrado en RANV2-06.
- Asistencia y control de cupos cerrado funcionalmente en RANV2-07.
- Ventanas de cancelacion 12h/24h cerrado en RANV2-06B.
- Perfil alumno y autogestion cerrado en RANV2-08.
- Plan de entrenamiento, observaciones y metadata de archivos cerrado funcionalmente en RANV2-09.
- Cloudflare Pages deploy preview cerrado en RANV2-14.
- Mailjet emails masivos cerrado en RANV2-10.
- Google Drive storage externo cerrado en RANV2-11.
- Limpieza controlada de Drive cerrada en RANV2-12.
- UX responsive final en ejecucion para RANV2-13.

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

RAN-29 esta en ejecucion.

- Frontend base creado con React, Vite, TypeScript y Tailwind.
- Router base y layouts iniciales creados.
- Supabase nuevo limpio creado y linkeado.
- Migracion inicial + RLS aplicada en Supabase remoto.
- Migracion RANV2-04 de hardening de policies aplicada en Supabase remoto.
- Login email/password y guards admin/alumno agregados.
- UX publica simplificada: sin accesos publicos a paneles internos.
- Usuario Auth admin y profile admin creados/verificados.
- Login admin, `/admin`, `/app`, logout y guards sin sesion validados.
- RANV2-05 agrego panel operativo para alumnos, planes, membresias y pagos manuales.
- Edge Function `create-student` fue desplegada.
- RANV2-06 agrego calendario, clases y reservas con cupos, reglas por plan/membresia/creditos y cancelacion 24h para personalizado 1:1.
- RANV2-07 agrega panel admin de asistencia sobre reservas existentes. La asistencia normal se genera automaticamente para reservas no canceladas de clases finalizadas; el panel queda para revisar y corregir casos puntuales.
- RANV2-06B ajusta cancelaciones: clases comunes hasta 12 horas antes y personalizado 1:1 hasta 24 horas antes.
- RANV2-08 habilita dashboard y autogestion basica para alumno sin acceso admin.
- RANV2-09 agrega gestion admin de plan de entrenamiento, observaciones y metadata de archivos, con lectura segura para alumno.
- RANV2-14 prepara deploy Cloudflare Pages con fallback SPA para rutas directas.
- RANV2-10 agrega envio masivo informativo por Mailjet desde Edge Function segura, respetando `receives_emails`.
- RANV2-11 agrega storage externo Google Drive desde Edge Functions seguras, usando OAuth de la cuenta dedicada `e.motiva.gym@gmail.com` y manteniendo metadata en Supabase.
- RANV2-12 agrega limpieza controlada de Drive con dry-run obligatorio y auditoria.
- RANV2-13 inicia ajuste visual/responsive: layout ancho, marca real,
  calendario visual interactivo mergeado, catalogo real de precios/planes
  aplicado, limites semanales/paquetes aplicados, fixes de calendario admin
  aplicados, bajas seguras admin aplicadas y limpieza segura de archivos en
  produccion. Pagos editables/anulables aplicados y UX de anulacion ajustada.
  CRUD admin de planes/actividades aplicado; la UX queda en ajuste para que
  planes administre la oferta comercial y calendario administre actividades,
  cupos, colores y reglas de tipos de clase.
