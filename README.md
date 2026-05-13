# E-Motiva App Gimnasio v2

Aplicacion web para administrar alumnos, planes, pagos manuales, clases, reservas, asistencia, comunicaciones y archivos del gimnasio E-Motiva.

## Estado actual

Frontend base inicial creado en RANV2-02.

- React + Vite + TypeScript inicializados
- Tailwind configurado con plugin de Vite
- Router base con rutas publicas, alumno y administracion
- Pantallas placeholder sin backend
- Supabase y auth real pendientes

## Stack previsto

- React + Vite + TypeScript + Tailwind CSS
- Supabase Auth, Postgres, RLS, Edge Functions y migraciones versionadas
- GitHub
- Linear
- Mailjet
- Google Drive
- Cloudflare Pages

## Comandos

```bash
npm install
npm run dev
npm run build
npm run lint
```

## Rutas disponibles

- `/`
- `/login`
- `/app`
- `/app/calendar`
- `/app/my-bookings`
- `/app/my-plan`
- `/app/profile`
- `/admin`
- `/admin/students`
- `/admin/payments`
- `/admin/calendar`
- `/admin/attendance`
- `/admin/plans`
- `/admin/emails`
- `/admin/storage`
- `/admin/settings`

## Flujo de trabajo

- Linear manda el alcance.
- Una PR por RAN.
- No se avanza al siguiente RAN sin cerrar el anterior.
- Supabase remoto solo se toca despues de tener migracion versionada en Git y `db push --dry-run` aprobado.
- No se guardan secrets en el repo.

## Linear

Proyecto: E-Motiva App Gimnasio v2
Issue actual: RAN-18 - RANV2-02 - Setup repo React/Vite/TypeScript/Tailwind

## Notas

- Auth real pendiente para RANV2-04.
- Supabase nuevo pendiente antes de RANV2-03.
