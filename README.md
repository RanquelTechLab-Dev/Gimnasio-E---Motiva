# E-Motiva App Gimnasio v2

Aplicacion web para administrar alumnos, planes, pagos manuales, clases, reservas, asistencia, comunicaciones y archivos del gimnasio E-Motiva.

## Estado actual

Reinicio tecnico limpio. El proyecto esta en RANV2-01 / RAN-17: base documental y alcance funcional.

## Stack previsto

- React + Vite + TypeScript + Tailwind CSS
- Supabase Auth, Postgres, RLS, Edge Functions y migraciones versionadas
- GitHub
- Linear
- Mailjet
- Google Drive
- Cloudflare Pages

## Flujo de trabajo

- Linear manda el alcance.
- Una PR por RAN.
- No se avanza al siguiente RAN sin cerrar el anterior.
- Supabase remoto solo se toca despues de tener migracion versionada en Git y `db push --dry-run` aprobado.
- No se guardan secrets en el repo.

## Linear

Proyecto: E-Motiva App Gimnasio v2
Issue actual: RAN-17 - RANV2-01 - Base documental y alcance funcional
