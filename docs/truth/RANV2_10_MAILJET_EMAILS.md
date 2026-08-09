# RANV2-10 - Mailjet emails masivos

RANV2-10 agrega envio de emails informativos desde el panel admin usando una
Supabase Edge Function segura. El frontend no conoce secrets de Mailjet.

## Alcance

- `/admin/emails` permite preparar asunto y mensaje.
- La vista previa usa `dryRun` para listar destinatarios elegibles sin enviar.
- El envio real usa Mailjet desde `supabase/functions/send-mass-email`.
- La audiencia inicial es `recent_payers_6_months`.
- Solo se incluyen alumnos activos con `receives_emails = true`.
- Solo se incluyen alumnos con pagos `approved` en los ultimos 6 meses.
- Cada destinatario queda registrado en `email_logs`.
- El envio masivo queda auditado como `email.mass_sent`.

## Separacion de RAN-36

- `send-mass-email` sigue siendo el envio manual de comunicaciones
  informativas desde admin y respeta `receives_emails`.
- `send-payment-reminders` es una funcion separada para recordatorios de cuota
  y respeta la preferencia independiente `receives_payment_reminders`.
- RAN-36 B1 es estrictamente dry-run: no llama a Mailjet, no envia emails y no
  realiza mutaciones de datos.
- El envio E2E controlado corresponde a RAN-36 B2 y el cron a RAN-36 B3.

## Seguridad

- La Edge Function exige token de sesion y valida admin activo.
- La funcion usa `SUPABASE_SERVICE_ROLE_KEY` solo en runtime backend.
- Los secrets de Mailjet deben cargarse como Supabase secrets.
- No se guardan secrets en Git ni en variables publicas de frontend.
- Alumno no puede invocar envios masivos desde el frontend.

## Secrets requeridos

Configurar en Supabase, sin imprimir valores:

```text
MAILJET_API_KEY
MAILJET_API_SECRET
MAILJET_FROM_EMAIL
MAILJET_FROM_NAME
```

Tambien deben existir los secrets runtime usuales de Edge Functions:

```text
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
```

## Deploy de RANV2-10

Los secrets y cualquier redeploy de `send-mass-email` se gestionan por
separado de RAN-36 B1:

```text
npx supabase@2.98.2 secrets set MAILJET_API_KEY=... MAILJET_API_SECRET=... MAILJET_FROM_EMAIL=... MAILJET_FROM_NAME=...
npx supabase@2.98.2 functions deploy send-mass-email
```

RANV2-10 no requirio una migracion propia porque reutiliza `email_logs` y
`profiles.receives_emails`. La migracion aditiva de recordatorios pertenece a
RAN-36.

## Fuera de alcance

- No pagos online.
- No adjuntos.
- No plantillas complejas.
- `send-mass-email` no incluye cron automatico; el cron futuro de recordatorios
  pertenece a RAN-36 B3.
- No Mailjet desde frontend.
- No Google Drive real.
- No WhatsApp API.
