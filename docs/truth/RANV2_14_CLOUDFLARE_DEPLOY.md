# RANV2-14 - Cloudflare Pages deploy

## Objetivo

Publicar la app Vite/React en Cloudflare Pages para contar con un link de demo para Carolina.

## Configuracion Cloudflare Pages

- Framework preset: `Vite`
- Build command: `npm run build`
- Build output directory: `dist`
- Root directory: raiz del repo
- SPA fallback: `public/_redirects` con `/* /index.html 200`

## Variables publicas requeridas

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`
- `VITE_WHATSAPP_NUMBER`

No cargar secrets en Cloudflare Pages para el frontend:

- No `service_role`
- No password de base de datos
- No JWT secret de Supabase
- No secrets de Mailjet
- No secrets de Google

## Validacion esperada

- URL base carga la app.
- `/login` carga directo.
- `/admin` no devuelve 404 y exige sesion admin.
- `/app` no devuelve 404 y exige sesion alumno/admin segun guard.
- Login y logout se validan manualmente sin compartir contrasenas.

## Fuera de alcance

- No cambia schema Supabase.
- No ejecuta `db push`.
- No integra pagos online.
- No integra Mailjet.
- No integra Google Drive real.
- No integra WhatsApp API.
