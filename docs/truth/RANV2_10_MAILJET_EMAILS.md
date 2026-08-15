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

B2B completo la prueba Mailjet E2E controlada: se envio exactamente un email
sintetico, la segunda ejecucion de la misma clave devolvio `already_sent` y los
recordatorios para alumnos reales continuaron en cero.

B3A agrega una foundation code-only para `scheduled_preview` y
`scheduled_production`, desactivada por defecto y todavia sin cron. La futura
programacion productiva de las 10:00 usara:

`America/Argentina/Cordoba`

RAN-39 no modifica ni despliega este flujo automatico.

## Separacion de RAN-36

- `send-mass-email` sigue siendo el envio manual de comunicaciones
  informativas desde admin y respeta `receives_emails`.
- `send-payment-reminders` es una funcion separada para recordatorios de cuota
  y respeta la preferencia independiente `receives_payment_reminders`.
- RAN-36 B1 es estrictamente dry-run: no llama a Mailjet, no envia emails y no
  realiza mutaciones de datos.
- RAN-36 B2B valido el envio E2E controlado con una sola entrega sintetica.
- RAN-36 B3A prepara localmente el worker productivo; cron y activacion remota
  corresponden a bloques posteriores.

## RAN-36 B2B - controlled E2E validado

- La migracion B2 aplicada agrega RPC `claim`/`finalize` atomicas sobre la
  clave de idempotencia existente en `email_logs`, con ejecucion exclusiva de
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
- En la ruta admin B2, `dryRun=false` solo admite `mode="controlled_e2e"`, un
  fixture sintetico interno y el destino del secret
  `PAYMENT_REMINDER_E2E_EMAIL`. El request no puede elegir email, alumno ni
  membresia.
- La fecha del fixture es interna y fija; repetir el mismo offset conserva la
  misma clave de idempotencia aun si cambia el dia de ejecucion.
- El fixture usa `student_id=NULL` y no crea ni modifica alumnos reales.
- Cualquier intento productivo desde la ruta admin permanece bloqueado con
  respuesta 409. El modo scheduled productivo de B3A es una ruta de servicio
  separada y responde 503 mientras su kill-switch este desactivado.
- B2B aplico la base atomica y desplego `send-payment-reminders` con la ruta
  controlada. La validacion envio exactamente un email sintetico y comprobo
  `already_sent` al repetir la misma clave.
- No se enviaron recordatorios a alumnos reales.
- RAN-36 B3A no repite la prueba B2B ni autoriza nuevos envios.

## RAN-36 B3A - production worker foundation code-only

- `dryRun` y `controlled_e2e` conservan autenticacion manual con JWT real de
  Supabase Auth y perfil admin activo.
- `scheduled_preview` y `scheduled_production` usan autenticacion de servicio
  mediante el header `x-e-motiva-cron-secret` y el secret
  `PAYMENT_REMINDER_CRON_SECRET`.
- La configuracion local futura fija `verify_jwt=false` solo para
  `send-payment-reminders`; la funcion sigue autenticando cada ruta dentro de
  su propio codigo. Este cambio no se despliega en B3A.
- `scheduled_preview` calcula la fecha real de
  `America/Argentina/Cordoba`, ejecuta el selector y devuelve solo conteos. No
  hace claim, no llama a Mailjet y no escribe datos.
- `scheduled_production` reutiliza selector, template, claim atomico,
  idempotencia y Mailjet, pero queda bloqueado por defecto. Solo puede avanzar
  cuando `PAYMENT_REMINDERS_PRODUCTION_ENABLED` es exactamente `true`.
- La nueva migracion local revalida membership y profile actuales dentro del
  claim real. Una renovacion o cambio previo al claim produce
  `candidate_no_longer_eligible`, sin `email_logs` nuevo ni Mailjet.
- El worker es secuencial. Un rechazo explicito se registra como `failed` y no
  se reintenta dentro del mismo run. Un outcome `uncertain` o una
  reconciliacion requerida detiene el batch y nunca reenvia automaticamente.
- Los requests scheduled no pueden aportar fecha, destinatario, alumno,
  membership, vencimiento, offset ni fixture. Las respuestas normales contienen
  solo fecha, timezone y contadores, sin PII; un error de reconciliacion puede
  agregar exclusivamente `log_id` y `desired_status`.
- Cron NO esta activo. `pg_cron` y `pg_net` NO estan instalados y B3A no crea
  extensiones, jobs, llamadas HTTP desde Postgres ni secretos en Vault.
- `PRODUCTION_MAILJET_SENDER_VERIFICATION_PENDING` permanece como gate
  separado. No se cambia `MAILJET_FROM_EMAIL` ni se verifica mediante envio
  real en B3A.
- No hay deploy, secrets remotos, migration remota, Mailjet ni emails reales
  autorizados en B3A.

## Seguridad

- Las rutas admin exigen token de sesion y validan admin activo.
- Las rutas scheduled exigen el secret de servicio dedicado y nunca aceptan el
  JWT admin como sustituto.
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

Para RAN-36 B2 controlled E2E se requiere:

```text
PAYMENT_REMINDER_E2E_EMAIL
```

Este secret pertenece exclusivamente al E2E controlado de RAN-36 B2. No es
necesario para `send-mass-email`. No guardar su valor en Git y usar siempre una
cuenta controlada, nunca un alumno real.

La foundation B3A declara, solo por nombre y sin configurar valores remotos:

```text
PAYMENT_REMINDER_CRON_SECRET
PAYMENT_REMINDERS_PRODUCTION_ENABLED
```

El primero autentica futuras llamadas scheduler/service. El segundo es el
kill-switch y mantiene `scheduled_production` bloqueado cuando falta o cuando
su valor no es exactamente `true`.

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
