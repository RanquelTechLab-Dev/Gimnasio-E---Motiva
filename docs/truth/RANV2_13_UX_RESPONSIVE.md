# RANV2-13 - UX responsive y alineacion visual MVP

RANV2-13 inicia la mejora visual del MVP ya funcional.

## Auditoria de assets

No se encontraron dentro del repo activo:

- `2.png`
- `Plan Actividades.jpeg`
- `Precios.jpeg`

Tampoco se encontraron `jpg`, `jpeg` o `png` utiles fuera de `node_modules`
dentro del repo. El login usa una marca textual provisoria `EM` hasta que se
agregue el logo real.

## Cambios de este slice

- Layout admin/alumno mas ancho para desktop maximizado.
- Navegacion responsive en mobile/tablet y sidebar estable en desktop.
- Login con bloque de marca visual sin depender de assets faltantes.
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
