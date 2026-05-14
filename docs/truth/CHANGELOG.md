# Changelog

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
