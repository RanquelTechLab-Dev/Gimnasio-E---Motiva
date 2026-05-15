# Next Steps

## Actual

RAN-26 / RANV2-10: Mailjet emails masivos y opt-in/out.

## Siguiente

Configurar secrets Mailjet en Supabase, desplegar la Edge Function `send-mass-email` y probar dry-run/envio real controlado.

## Pendiente

- No guardar secrets en el repo.
- Cargar `MAILJET_API_KEY`, `MAILJET_API_SECRET`, `MAILJET_FROM_EMAIL` y `MAILJET_FROM_NAME` como Supabase secrets.
- Desplegar `supabase/functions/send-mass-email`.
- Validar vista previa en `/admin/emails`.
- Enviar prueba controlada y verificar `email_logs`.
- No cargar Mailjet, `service_role`, DB password ni Supabase JWT secret en Cloudflare o frontend.
- Google Drive real, pagos online y WhatsApp API quedan fuera de RANV2-10.
