# Next Steps

## Actual

RAN-30 / RANV2-14: Cloudflare deploy preview para demo.

## Siguiente

Crear proyecto Cloudflare Pages conectado al repo, cargar variables publicas y validar URL de demo.

## Pendiente

- No guardar secrets en el repo.
- Configurar Cloudflare Pages con build `npm run build` y output `dist`.
- Cargar `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` y `VITE_WHATSAPP_NUMBER`.
- Validar URL base, `/login`, `/admin` y `/app`.
- No cargar `service_role`, DB password, Supabase JWT secret ni secrets de integraciones.
- Google Drive real, pagos online, Mailjet y WhatsApp API quedan fuera de RANV2-14.
