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

B2A incorpora localmente la base para una prueba Mailjet E2E controlada. No
esta desplegada ni habilita envios productivos.

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
- RAN-36 B2A prepara localmente el envio E2E controlado; el cron corresponde a
  RAN-36 B3.

## RAN-36 B2A - foundation local controlada

- La migracion local agrega RPC `claim`/`finalize` atomicas sobre la clave de
  idempotencia existente en `email_logs`, con ejecucion exclusiva de
  `service_role`.
- `failed` significa que Mailjet rechazo explicitamente la entrega. Este es el
  unico resultado que admite un retry controlado.
- `uncertain` significa que el resultado del provider es ambiguo, por ejemplo
  ante una excepcion de transporte o una respuesta que no confirma de forma
  confiable la aceptacion ni el rechazo. Nunca se reintenta automaticamente.
- Las entregas `pending` o `uncertain` requieren reconciliacion explicita. La
  reconciliacion solo finaliza el registro existente y nunca llama ni reenvia a
  Mailjet.
- `dryRun=true` conserva el flujo B1 de solo lectura: no reserva entregas, no
  llama a Mailjet y no escribe logs ni otros datos.
- `dryRun=false` solo admite `mode="controlled_e2e"`, un fixture sintetico
  interno y el destino del secret `PAYMENT_REMINDER_E2E_EMAIL`. El request no
  puede elegir email, alumno ni membresia.
- La fecha del fixture es interna y fija; repetir el mismo offset conserva la
  misma clave de idempotencia aun si cambia el dia de ejecucion.
- El fixture usa `student_id=NULL` y no crea ni modifica alumnos reales.
- La entrega productiva real permanece bloqueada con respuesta 409.
- B2A existe unicamente en esta implementacion local: la entrega productiva
  sigue bloqueada, no se aplico la migracion, no se desplego
  `send-payment-reminders`, no se llamo a Mailjet y no se envio ningun email.
- RAN-36 B3 y su cron productivo siguen pendientes. Las 10:00 en
  `America/Argentina/Cordoba` continúan siendo el objetivo futuro.

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

Para RAN-36 B2 controlled E2E, y solamente bajo autorizacion B2B, se
requerira:

```text
PAYMENT_REMINDER_E2E_EMAIL
```

Este secret pertenece exclusivamente al E2E controlado de RAN-36 B2. No es
necesario para `send-mass-email` y todavia no esta configurado en produccion.
No guardar su valor en Git. Cuando se autorice su configuracion, debe apuntar
exclusivamente a una cuenta controlada, nunca a un alumno real.

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
