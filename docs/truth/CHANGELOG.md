# Changelog

## 2026-05-18 - RANV2-13 bajas seguras admin

- Se agregan RPCs admin-only para desactivar alumnos, archivar/eliminar planes
  y eliminar clases sin historial.
- El borrado fisico definitivo de alumnos queda en Edge Function admin-only
  `delete-student`, con service role solo backend para eliminar tambien Auth.
- El delete fisico queda bloqueado cuando hay historial operativo; en esos
  casos se conserva historial y se usa desactivacion, archivo o cancelacion.
- Se agregan acciones visibles en `/admin/students`, `/admin/plans` y
  `/admin/calendar`.
- No se ejecuta `db push` real.

## 2026-05-18 - RANV2-13 fixes calendario admin

- Se agrega migracion local para corregir la cancelacion admin de clases y
  procesar reservas activas sin tocar la logica de limites semanales.
- Admin puede preparar clases recurrentes con fecha fin, dia de semana y limite
  de 52 clases por tanda.
- El formulario de clase separa fecha y hora de inicio/fin para evitar cargas
  confusas.
- La grilla colorea clases por actividad con tonos estables.
- Personalizado 1:1 queda limitado a cupo 1 en el formulario y protegido por
  trigger en base de datos.
- No se ejecuta `db push` real.

## 2026-05-18 - RANV2-13 limites semanales y paquetes

- Se agrega migracion local para diferenciar planes semanales, paquetes
  personalizados y planes manuales.
- Los planes semanales se controlan por clases por semana y ya no consumen
  saldo visible de membresia.
- Los paquetes personalizados mantienen clases restantes del paquete.
- El calendario de alumno muestra clases restantes de la semana o del paquete
  segun corresponda.
- Se ajusta copy de admin/alumno para hablar de clases y no de saldo tecnico.
- No se ejecuta `db push` real.

## 2026-05-18 - RANV2-13 precios y paquetes

- Se agrega migracion local de catalogo para precios reales desde
  `docs/source-assets/Precios.jpeg`.
- Se agregan planes vigentes para neurofuncional, semipersonalizado,
  combo funcional/semipersonalizado, programa kids, plan de entrenamiento y
  personalizado por paquetes de 1, 4, 8 y 12 clases.
- Se conservan los planes base anteriores como inactivos para historial.
- Admin asigna membresias solo desde planes activos y precarga clases segun
  el paquete elegido.
- No se ejecuta `db push` real.

## 2026-05-13 - RANV2-01 iniciado

- Se inicia reboot limpio de E-Motiva App Gimnasio v2.
- Se usa repo nuevo: `RanquelTechLab-Dev/Gimnasio-E---Motiva`.
- Se usa proyecto Linear nuevo: E-Motiva App Gimnasio v2.
- Supabase nuevo queda pendiente.
- Se crea base documental inicial.
- Se elimina el archivo accidental `1` si corresponde.

## 2026-05-13 - RANV2-02 iniciado

- Se inicializa frontend base con React, Vite y TypeScript.
- Se agrega Tailwind con plugin de Vite.
- Se agrega router base.
- Se crean layouts admin/alumno/publico.
- Se crean pantallas placeholder.
- Se agrega boton flotante WhatsApp.
- Se agrega CI frontend para build y lint.

## 2026-05-13 - RANV2-03 preflight Supabase

- Se verifica y linkea el proyecto `emotiva-gym-app-v2`.
- Se registra el project ref `kmfxgeqxulwaauracyzs`.
- Se confirma region `sa-east-1`.
- Se inicializa estructura local de Supabase sin schema ni migraciones.
- No se ejecuta `db push`.
- No se crean tablas ni policies todavia.
- Se alinea Supabase Auth local redirect con Vite dev server en puerto 5173.

## 2026-05-14 - RANV2-03 schema inicial + RLS

- Se crea migracion inicial versionada de Supabase.
- Se agregan tablas base para perfiles, actividades, planes, membresias, pagos, clases, reservas, asistencia, notas, archivos, emails, Drive y auditoria.
- Se habilita RLS en tablas publicas.
- Se agregan policies minimas para admin/alumno.
- Se agregan seeds base de actividades y planes con precios pendientes.
- No se ejecuta `db push` real.

## 2026-05-14 - RANV2-04 auth + roles

- Se agrega cliente Supabase Auth en frontend sin secrets.
- Se agrega flujo de sesion, login email/password y logout.
- Se agregan guards para alumno/admin.
- Se carga profile desde `public.profiles`.
- Se crea migracion RANV2-04 para hardening minimo de advisors.
- Se documenta bootstrap manual del admin inicial.
- No se ejecuta `db push` real en este bloque.

## 2026-05-14 - RANV2-04 login UX/env fix

- Se valida `.env.local` local con URL, publishable key y WhatsApp sin commitear secrets.
- Se simplifica la UX publica para mostrar solo el acceso E-Motiva.
- `/` redirige segun sesion y rol.
- Se eliminan accesos publicos a panel alumno/admin.
- Se remueven textos tecnicos visibles de RAN/placeholder en la app.

## 2026-05-14 - RANV2-05 panel admin operativo

- Se agrega panel admin operativo para alumnos, planes, membresias y pagos manuales.
- Se crean RPCs transaccionales y auditadas para asignar membresias, registrar pagos, aprobar pagos y rechazar pagos.
- Se versiona Edge Function local `create-student` para alta segura de alumnos con Auth.
- Se documenta que la migracion RANV2-05 queda pendiente de `db push` real.
- Se documenta que la Edge Function queda pendiente de deploy.
- No se agregan pagos online, reservas reales, Mailjet, Google Drive, Cloudflare ni secrets.

## 2026-05-14 - RANV2-05 UX alumnos y fecha de pago

- Se mejora el panel de alumnos con buscador por nombre, apellido, email y telefono.
- Se refuerza la tabla de alumnos y la ficha personal con datos, membresias, pagos y acciones.
- Se agrega fecha/calendario al registro de pago manual.
- Se versiona migracion para persistir la fecha elegida en `payments.paid_at`.
- Google Drive real queda fuera de RANV2-05 y pendiente para RANV2-09/RANV2-11.
- Se corrige la seleccion de alumno para que la ficha y formularios no queden activos sobre un alumno oculto por el buscador.

## 2026-05-14 - RANV2-06 calendario, clases y reservas

- Se agrega migracion local para calendario, clases y reservas.
- Se agregan RPCs transaccionales para crear, editar y cancelar clases.
- Se agregan RPCs para reservar y cancelar reservas con reglas por plan, membresia, cupo y creditos.
- Se implementa regla 24h para actividades personalizadas con `requires_24h_cancel`.
- Se reemplazan placeholders de `/admin/calendar`, `/app/calendar` y `/app/my-bookings` por UI operativa.
- No se ejecuta `db push` real en este bloque.

## 2026-05-14 - RANV2-07 asistencia

- Se agrega migracion local para asistencia operativa.
- Se agrega `profiles.last_attendance_at`.
- Se agregan RPCs admin-only para listar clases/reservas/asistencia y marcar/corregir asistencia.
- Se reemplaza el placeholder `/admin/attendance` por UI operativa.
- `present` actualiza asistencia real; `absent` y `justified` no devuelven ni descuentan creditos.
- No se ejecuta `db push` real en este bloque.

## 2026-05-14 - RANV2-07 asistencia automatica

- Se ajusta el criterio funcional: Carolina no toma asistencia manual.
- Se agrega migracion local para finalizar automaticamente reservas `booked` de clases ya terminadas y no canceladas como `present`.
- `/admin/attendance` pasa a revisar asistencia automatica y corregir casos puntuales.
- La asistencia automatica usa `class_sessions.ends_at` como fecha real de asistencia; el procesamiento posterior queda en metadata de auditoria.
- La automatizacion no toca creditos, pagos, Mailjet, Drive, Cloudflare ni RAN-24.
- No se ejecuta `db push` real en este bloque.

## 2026-05-14 - RANV2-06B ventanas de cancelacion

- Se agrega migracion local para ajustar `cancel_booking`.
- Clases comunes: cancelacion permitida hasta 12 horas antes del inicio.
- Personalizado 1:1: cancelacion permitida hasta 24 horas antes del inicio.
- Cancelar a tiempo devuelve credito una sola vez.
- Si el alumno intenta cancelar fuera de ventana, la reserva queda activa y no se devuelve credito.
- Se actualiza `list_my_bookings` para mostrar bloqueo 12h/24h.
- No se ejecuta `db push` real en este bloque.

## 2026-05-14 - RANV2-08 perfil alumno

- Se agrega migracion local con RPCs de autogestion de alumno.
- `/app` muestra dashboard real con perfil, membresia, creditos, proxima reserva, ultimo pago y ultima asistencia.
- `/app/profile` permite editar solo telefono y preferencia de emails.
- `/app/bookings`, `/app/payments`, `/app/attendance` y `/app/files` muestran datos propios del alumno.
- Archivos/Google Drive real quedan fuera de RANV2-08.
- No se ejecuta `db push` real en este bloque.

## 2026-05-14 - RANV2-09 plan, observaciones y archivos

- Se agrega migracion local para extender `training_notes` y `files`.
- Admin puede crear/editar/archivar plan de entrenamiento, observaciones y seguimiento operativo.
- Admin puede registrar metadata de documentos sin subir archivo real.
- Se agrega visibilidad controlada para alumno en notas y archivos.
- `/app/files` muestra documentos propios visibles y planes de entrenamiento visibles.
- Google Drive real, subida binaria, pagos online, Mailjet, Cloudflare y RANV2-10 quedan fuera.
- No se ejecuta `db push` real en este bloque.

## 2026-05-14 - RANV2-14 preparacion Cloudflare Pages

- Se agrega fallback SPA para Cloudflare Pages mediante `public/_redirects`.
- Se documenta configuracion de deploy Vite: `npm run build` y salida `dist`.
- Se documentan variables publicas necesarias para el frontend.
- No se agregan secrets, migraciones ni cambios funcionales.

## 2026-05-14 - RANV2-10 Mailjet emails masivos

- Se agrega Edge Function `send-mass-email` para enviar emails informativos con Mailjet desde backend seguro.
- `/admin/emails` permite previsualizar audiencia y enviar a alumnos elegibles.
- La audiencia inicial incluye alumnos activos con opt-in y pagos aprobados en los ultimos 6 meses.
- Los envios se registran en `email_logs` y el envio masivo se audita.
- No se agrega migracion porque se reutilizan `email_logs` y `profiles.receives_emails`.
- Secrets Mailjet quedan pendientes de configurar en Supabase; no se guardan en Git.

## 2026-05-15 - RANV2-11 Google Drive storage

- Se agregan Edge Functions `upload-student-file` y `check-drive-status`.
- Admin puede subir archivos reales para alumnos desde `/admin/students`.
- La metadata queda en `public.files` y el archivo real queda en Google Drive.
- Las funciones usan OAuth refresh token de la cuenta real `e.motiva.gym@gmail.com` para medir la cuota real de Drive.
- Si el archivo es visible, se intenta dar permiso de lectura al email del alumno.
- Se actualiza `drive_status` y se alerta si queda 10% o menos de espacio.
- No se agrega migracion porque se reutilizan tablas existentes.
- Secrets Google quedan pendientes de configurar en Supabase; no se guardan en Git.

## 2026-05-15 - RANV2-12 limpieza controlada Drive

- Se agrega Edge Function `cleanup-drive-files` con modo `dryRun` por defecto.
- `/admin/storage` permite previsualizar candidato y archivos seleccionados.
- La seleccion prioriza el alumno con mayor tiempo sin pago, membresia o actividad real.
- La limpieza real exige `dryRun=false` y `force=true`.
- No se agrega migracion porque se reutilizan `files`, `drive_status` y `audit_logs`.
- No se ejecuta limpieza real ni se borran archivos en la PR inicial.

## 2026-05-15 - RANV2-13 UX responsive baseline

- Se auditan assets fuente para logo, calendario y precios; no estan versionados en el repo activo.
- Se mejora el layout admin/alumno para desktop maximizado, tablet y mobile.
- Se agrega marca visual provisoria en login sin inventar assets.
- Calendario alumno y admin pasan de lista simple a tarjetas agrupadas por dia.
- Pagos admin muestran plan, periodo y clases asociadas a la membresia.
- No se agrega migracion ni se cargan precios hardcodeados.

## 2026-05-15 - RANV2-13 branding real

- Se usa el logo real `public/brand/2.png` en el login.
- Se agrega el logo real al sidebar admin/alumno en tamano contenido.
- Se agrega `public/brand/logo-small.png` como variante liviana para UI chica.
- No se cambia auth, guards, backend, schema ni datos productivos.

## 2026-05-17 - RANV2-13 calendario interactivo

- Se agrega grilla semanal interactiva inspirada en `Plan Actividades.jpeg`.
- `/app/calendar` permite reservar y cancelar reservas desde el calendario usando RPCs existentes.
- `/admin/calendar` permite crear, editar y cancelar clases desde la grilla visual.
- No se agrega migracion: se reutilizan las RPCs de calendario/reservas existentes.
- No se implementa delete fisico de clases con historial.
