# RANV2-13 - UX responsive y alineacion visual MVP

RANV2-13 inicia la mejora visual del MVP ya funcional.

## Assets fuente

Los assets reales ya quedaron versionados en ubicaciones estables:

- `public/brand/2.png`: logo real para login y branding de la app.
- `public/brand/logo-small.png`: variante liviana para iconos de UI.
- `docs/source-assets/Plan Actividades.jpeg`: referencia visual para calendario.
- `docs/source-assets/Precios.jpeg`: referencia para precios, planes y paquetes.

El branding usa `public/brand/logo-small.png` en el login y en los layouts
admin/alumno. `public/brand/2.png` queda preservado como fuente/original.

## Cambios de este slice

- Layout admin/alumno mas ancho para desktop maximizado.
- Navegacion responsive en mobile/tablet y sidebar estable en desktop.
- Login con logo real de E-Motiva desde `public/brand/logo-small.png`.
- Sidebar admin/alumno con logo real en tamano contenido.
- Calendario alumno agrupado por dia, con tarjetas por horario, cupo y regla
  12h/24h.
- Calendario admin agrupado por dia para revisar clases y cupos con menos
  ruido visual.
- Calendario alumno/admin convertido a grilla semanal interactiva inspirada en
  `Plan Actividades.jpeg`, usando sesiones reales de Supabase.
- Alumno puede reservar y cancelar desde el calendario con las RPCs existentes.
- Admin puede crear, editar y cancelar clases desde el calendario visual.
- Pagos admin muestran mejor el plan, periodo y clases asociadas a la
  membresia.
- Se prepara catalogo real de planes/precios desde `Precios.jpeg` mediante
  migracion de datos, sin cambiar schema.
- Los planes nuevos incluyen precio, descripcion fuente y clases por paquete
  para cargar membresias con clases disponibles.
- Los planes base anteriores quedan inactivos y conservados por historial.
- Se agrega modelo explicito de `plan_type`: semanal, paquete o manual.
- Los planes semanales muestran clases por semana y se controlan por semana
  desde la RPC de reserva.
- Los paquetes personalizados mantienen clases restantes del paquete.
- La UI admin/alumno evita hablar de saldo tecnico visible.
- El calendario admin agrega creacion recurrente limitada, evita duplicados
  exactos por actividad/horario y separa fecha/hora para reducir errores de
  carga.
- La cancelacion admin de clases se corrige en RPC para procesar reservas
  activas y devolver clases de paquetes sin tocar la logica semanal.
- Las clases se colorean por actividad para acercar la lectura visual al plan
  semanal fuente.
- Personalizado 1:1 fuerza cupo maximo 1 en UI y en base de datos.
- Admin puede intentar bajas seguras: alumnos sin historial operativo se
  eliminan desde Edge Function tambien en Auth, alumnos con historial se
  desactivan; planes sin uso se eliminan, planes con historial se archivan;
  clases sin reservas/asistencia se eliminan y clases con historial deben
  cancelarse.
- `/admin/storage` agrega limpieza segura de archivos: vista previa, limpieza
  confirmada e individual de archivos reales de Drive, conservando historial
  operativo en pagos, membresias, reservas y asistencia.
- `/admin/payments` agrega edicion auditada de monto, metodo, fecha y notas, y
  anulacion con motivo obligatorio sin borrado fisico.
- `/admin/plans` agrega gestion admin segura de planes y actividades:
  creacion, edicion, archivo y eliminacion fisica solo cuando no hay uso.
- Los planes se configuran desde UI como semanales, paquetes o manuales, con
  actividades incluidas y limite semanal por actividad.
- La UX se reordena para que `/admin/plans` quede enfocado en planes
  comerciales y solo muestre un resumen de actividades incluidas.
- La gestion completa de actividades/tipos de clase queda en `/admin/calendar`,
  donde se configuran estado, color, ventana de cancelacion, cupo por defecto y
  cupo maximo.
- `/app/plans` agrega un catalogo informativo para alumnos con planes activos,
  precios, periodo, tipo, actividades incluidas y clases por semana o paquete.
  No permite comprar ni editar planes.
- Se aplica pulido visual final: copy menos tecnico, logo con mayor presencia,
  paleta base alineada al logo y pequenos ajustes de legibilidad mobile sin
  modificar backend ni reglas operativas.

## Auditoria funcional

El schema actual permite:

- listar actividades activas;
- crear, editar y cancelar clases mediante RPCs admin existentes;
- editar precio, descripcion y estado de planes;
- crear y editar planes mediante RPCs admin-only;
- archivar planes usados y eliminar fisicamente solo planes sin historial;
- crear, editar y archivar actividades desde el calendario, y eliminar
  fisicamente solo actividades sin vinculos a planes/clases/reservas/asistencia;
- registrar pagos contra `membership_id`;
- ver el plan asociado a una membresia/pago;
- reservar y cancelar clases con las reglas existentes.
- representar paquetes personalizados de 1, 4, 8 y 12 clases con planes
  separados y clases finitas.
- bloquear reservas cuando el alumno ya uso el limite semanal de esa actividad.
- ver planes y precios activos desde el panel alumno como informacion de
  consulta.

Requieren subbloques especificos:

- reset de contrasena de alumno desde admin;
- validacion final de UX despues de reubicar actividades en calendario;
- politicas futuras para purga tecnica de logs si alguna vez hiciera falta.

## Fuera de alcance de este slice

- No `db push` real sin dry-run previo y autorizacion de Walter.
- No cambios en Mailjet, Google Drive, Cloudflare, WhatsApp API ni pagos online.
- No carga de precios hardcodeados sin fuente.
