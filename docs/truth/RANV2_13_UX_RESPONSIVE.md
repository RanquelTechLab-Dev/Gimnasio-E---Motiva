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
- Pagos admin muestran mejor el plan, periodo y creditos asociados a la
  membresia.

## Auditoria funcional

El schema actual permite:

- listar actividades activas;
- editar precio, descripcion y estado de planes;
- registrar pagos contra `membership_id`;
- ver el plan asociado a una membresia/pago;
- reservar y cancelar clases con las reglas existentes.

Requieren subbloques especificos:

- CRUD completo de actividades;
- precios reales desde referencia `Precios.jpeg`;
- personalizado por clases/paquetes si requiere nuevos planes o reglas;
- editar/eliminar pagos y montos;
- reset de contrasena de alumno desde admin;
- eliminar archivos reales y/o metadata desde admin.

## Fuera de alcance de este slice

- No schema nuevo.
- No `db push`.
- No cambios en Mailjet, Google Drive, Cloudflare, WhatsApp API ni pagos online.
- No carga de precios hardcodeados sin fuente.
