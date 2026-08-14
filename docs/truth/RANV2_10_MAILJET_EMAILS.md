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

## Seleccion segura de destinatarios (RAN-39)

La audiencia manual no cambia: solo incluye perfiles con rol `student`,
activos, con email valido, `receives_emails = true` y al menos un pago
`approved` durante los ultimos 6 meses.

El Bloque A incorpora localmente soporte backend compatible para una seleccion
opcional mediante `recipient_ids`:

- el backend vuelve a calcular la audiencia elegible e intersecta los IDs;
- los IDs desconocidos o no elegibles quedan excluidos;
- la ausencia de `recipient_ids` conserva el comportamiento anterior de todos
  los elegibles;
- el frontend nunca puede aportar emails arbitrarios como destinatarios;
- este bloque no cambia la UI, no despliega la funcion y no envia emails
  reales.

La remediacion P2 pagina localmente todos los pagos aprobados en paginas de
hasta 1000 filas mediante cursor/keyset `(paid_at, id)`, ordenado por
`paid_at ASC` e `id ASC`, sin offsets, y consulta los perfiles en lotes
acotados. Eliminar o cambiar filas previas no desplaza la pagina siguiente:
keyset evita el salto causado por ese desplazamiento, pero no crea aislamiento
snapshot frente a toda mutacion concurrente. Si falla cualquier pagina o lote,
se aborta el calculo completo antes de Mailjet y de los registros de envio:
nunca se usa una audiencia parcial. Esta correccion sigue pendiente de
auditoria, merge y deploy; no esta activa en la funcion productiva.

El Bloque B agregara despues buscador, checkbox individual, seleccion multiple,
seleccionar todos y contador. Los recordatorios automaticos 5/3/1/0 siguen
separados de este envio manual.

## Separacion entre emails manuales y recordatorios automaticos

### Emails manuales

Carolina redacta el asunto y el mensaje y puede enviarlo manualmente a uno,
varios o todos los alumnos elegibles.

La audiencia manual conserva estas condiciones:

- `role = student`;
- alumno activo;
- `receives_emails = true`;
- email valido;
- al menos un pago `approved` durante los ultimos 6 meses.

RAN-39 agrega soporte backend para seleccionar destinatarios mediante
`recipient_ids`. El backend revalida siempre la elegibilidad y no acepta emails
arbitrarios enviados por el frontend.

La UI con buscador, lupa y checkboxes todavia no esta desplegada.

### Recordatorios automaticos de cuota

Los recordatorios automaticos son un flujo independiente del envio manual.

La fecha fuente es el valor actual de:

`memberships.end_date`

Solo son elegibles alumnos con:

`receives_payment_reminders = true`

Los offsets son 5/3/1/0 dias:

- 5 dias antes;
- 3 dias antes;
- 1 dia antes;
- dia del vencimiento (offset 0).

B2 sigue pendiente y habilitara una prueba Mailjet E2E controlada.

B3 sigue pendiente y agregara el cron productivo de las 10:00 en:

`America/Argentina/Cordoba`

RAN-39 no modifica ni despliega este flujo automatico.

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
