# E-Motiva - Politica de eliminacion definitiva

## Contexto

RAN-35 define la politica de borrado definitivo y limpieza pre-entrega para
E-Motiva. La regla general es simple: los borrados irreversibles existen, pero
siempre pasan por preview, confirmacion fuerte, auditoria y alcance explicito.

## Decision funcional confirmada

1. Alumno con historial:
   se permite borrado fisico completo si Carolina confirma de forma fuerte.

2. Clase con reservas o asistencia:
   no se borra silenciosamente; debe mostrar el impacto y pedir una
   confirmacion mas fuerte.

3. Pago:
   si se elimina, sale realmente de la base activa y el sistema debe recalcular
   programa, vigencia y reservas futuras si corresponde.

4. Archivo:
   debe borrarse de Google Drive y de la base. Si falla uno de los dos pasos,
   la UI debe decirlo con claridad para permitir reintento.

## Confirmaciones fuertes

- Alumno: `ELIMINAR ALUMNO DEFINITIVAMENTE`
- Clase sin reservas/asistencia: `ELIMINAR CLASE`
- Clase con reservas/asistencia: `ELIMINAR CLASE Y RESERVAS`
- Pago: `ELIMINAR PAGO`
- Archivo: `ELIMINAR ARCHIVO`
- Demo: `ELIMINAR DEMO`

## Alcance por entidad

### Alumno

Preview obligatorio:

- perfil
- programas
- pagos
- reservas
- asistencia
- archivos
- notas / planes
- horarios habituales
- ids de Drive para limpieza previa

Borrado definitivo:

1. borrar asistencia del alumno
2. borrar reservas del alumno
3. borrar horarios habituales del alumno
4. borrar notas / planes
5. borrar metadata de archivos
6. borrar pagos
7. borrar programas
8. borrar profile
9. borrar usuario Auth desde Edge Function

Bloqueos:

- no self-delete
- no borrar admins

### Pago

Preview obligatorio:

- alumno
- programa vinculado
- estado del pago
- monto y fecha
- required_amount congelado
- total aprobado actual y total sin ese pago
- si el programa quedaria suspendido
- reservas futuras que podrian cancelarse por perdida de vigencia/pago completo

Borrado definitivo:

- borrar fisicamente el pago
- reconciliar el programa vinculado
- auditar el impacto

### Clase

Preview obligatorio:

- actividad
- horario
- si pertenece a regla recurrente
- cantidad de reservas
- cantidad de asistencia
- confirmacion requerida

Borrado definitivo:

- si no tiene historial: borrar clase
- si tiene reservas/asistencia:
  - borrar asistencia relacionada
  - borrar reservas relacionadas
  - borrar clase
- si era ocurrencia de regla recurrente:
  registrar excepcion para que no reaparezca

### Archivo

Preview UX:

- nombre
- alumno
- visibilidad
- advertencia irreversible
- confirmacion fuerte
- si el archivo sigue activo en Drive, el borrado definitivo debe pasar por
  Edge Function y no por RPC directa al metadata

Borrado definitivo:

1. borrar archivo en Google Drive
2. borrar metadata en `public.files`
3. si falla cualquiera de los pasos, informar el estado real

## Demo cleanup

Uso reservado para limpieza pre-entrega.

Protegido siempre:

- `e.motiva.gym@gmail.com`

Allowlist inicial:

- `ranqueltechlab@gmail.com`

Reglas:

- si aparece cualquier otro perfil no admin y no allowlisted, la limpieza demo
  debe bloquearse
- no borrar admins
- no ejecutar automaticamente
- la ejecucion completa debe orquestarse desde Edge Function para borrar Drive,
  DB y Auth en conjunto

## Riesgos y mitigaciones

1. Drive y DB pueden desalinearse:
   por eso el borrado de archivos y de alumnos con archivos pasa por preview,
   pasos separados y mensaje claro de error.

2. Un pago eliminado puede dejar un programa sin cobertura:
   el borrado definitivo debe reconciliar la membresia y cancelar reservas
   futuras fuera de vigencia si corresponde.

3. Una clase recurrente puede reaparecer:
   el borrado definitivo de ocurrencias recurrentes debe registrar excepcion.

4. Un borrado masivo demo puede llevarse perfiles equivocados:
   se usa allowlist explicita y bloqueo si aparece cualquier perfil fuera de lo
   esperado.

## Backups y resguardo

Antes de ejecutar borrados reales en produccion:

- confirmar baseline estable y release
- confirmar Git main alineado con Supabase
- ejecutar preview y revisar impacto
- conservar auditoria minima sin datos sensibles innecesarios

La auditoria definitiva debe conservar solo prueba minima de la accion
(por ejemplo, que hubo borrado definitivo y si habia dependencias), pero no
contenido eliminado, montos, metodos de pago, ids de Drive ni otros datos que
permitan reconstruir informacion sensible desde `audit_logs`.

El borrado definitivo elimina de la base activa y del almacenamiento externo
cuando aplique. Los backups de plataforma pueden retener informacion de forma
temporal por sus propias politicas, pero la app ya no conserva ni expone ese
dato operativo una vez ejecutado el borrado definitivo.

## Politica de UI

- ningun borrado definitivo se ejecuta desde un click unico
- toda accion irreversible muestra preview e impacto
- toda accion irreversible exige texto exacto
- la UI debe refrescar desde DB despues de confirmar
- si el backend devuelve warnings, deben quedar visibles
