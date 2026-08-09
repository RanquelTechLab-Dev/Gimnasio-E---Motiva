# FULL PRODUCTION RULES — E-Motiva App Gimnasio Carolina

Estado: producción real
Dueña operativa: Carolina / E-Motiva
Responsable técnico: Ranquel Tech Lab
Regla principal: este sistema no es MVP, no es demo y no es piloto. Es un sistema productivo real con alumnos, pagos, reservas, archivos y operación diaria.

---

# 1. Principios generales del sistema

## 1.1. Producción real

E-Motiva App Gimnasio es el sistema productivo real del gimnasio de Carolina.

No se debe tratar como:

* MVP;
* demo;
* experimento;
* entorno descartable;
* sistema sin datos reales.

Tiene:

* alumnos reales;
* pagos reales;
* membresías/programas reales;
* reservas reales;
* asistencia real;
* archivos reales;
* operación diaria real.

## 1.2. Regla de no desviación

Todo cambio debe respetar estas fuentes:

1. Linear como ruta funcional/productiva.
2. GitHub como fuente técnica.
3. Supabase como base real controlada.
4. E2E como validación antes de decir “cerrado”.
5. Este documento como contrato de reglas productivas.

Si Codex o cualquier agente quiere cambiar una regla, debe:

* encontrar el issue Linear relacionado;
* explicar el cambio;
* abrir PR;
* validar E2E;
* no tocar módulos ajenos.

## 1.3. Regla de módulos

No mezclar módulos innecesariamente.

Si se trabaja en Drive, no tocar calendario.
Si se trabaja en reservas, no tocar hard delete.
Si se trabaja en pagos, no tocar Drive.
Si se trabaja en recurrentes, no tocar alumnos salvo lectura.
Si se trabaja en asistencia, no tocar pagos salvo lectura.

## 1.4. Regla de seguridad operativa

Nunca hacer en producción:

* SQL manual destructivo;
* DELETE/UPDATE/INSERT manual para “arreglar rápido”;
* db push sin dry-run;
* deploy de funciones no relacionadas;
* cambios masivos sin PR;
* refactor global en microbloques;
* hard delete sobre alumno real para probar.

---

# 2. Roles y permisos

## 2.1. Roles existentes

El sistema tiene dos roles principales:

* `admin`
* `student`

## 2.2. Admin

Un admin puede:

* crear alumnos;
* editar alumnos;
* desactivar alumnos;
* eliminar definitivamente alumnos usando flujo seguro;
* crear/editar programas;
* asignar programas/membresías;
* registrar pagos;
* crear/editar/cancelar clases;
* gestionar clases recurrentes;
* ver reservas;
* ver asistencia;
* marcar asistencia;
* subir archivos;
* ver archivos de todos los alumnos;
* ver auditoría operativa según permisos del sistema.

## 2.3. Alumno

Un alumno puede:

* iniciar sesión;
* ver su panel;
* ver sus programas/membresías;
* ver sus pagos si la UI lo expone;
* ver calendario disponible;
* reservar clases permitidas;
* cancelar reservas dentro de reglas;
* ver sus archivos visibles;
* no ver archivos de otros alumnos;
* no ver datos de otros alumnos;
* no administrar pagos, planes ni clases.

## 2.4. Perfil activo

Un usuario inactivo no debe operar normalmente.

Si un alumno está inactivo:

* no debería poder reservar;
* no debería ser tomado como alumno válido para operaciones normales;
* upload visible puede fallar si se exige alumno activo;
* hard delete puede operar desde admin si el flujo lo permite y corresponde.

---

# 3. Alumnos

## 3.1. Crear alumno

Crear alumno implica:

* crear usuario/Auth si aplica;
* crear profile con rol `student`;
* email en minúsculas;
* nombre y apellido obligatorios;
* alumno activo por defecto si corresponde;
* sin acceso admin.

## 3.2. Editar alumno

Editar alumno debe permitir:

* nombre;
* apellido;
* email si el flujo lo permite;
* teléfono;
* notas;
* estado activo/inactivo;
* datos administrativos necesarios.

No debe romper:

* pagos;
* membresías;
* reservas;
* asistencia;
* archivos;
* historial.

## 3.3. Desactivar alumno

Desactivar alumno significa:

* conservar historial;
* conservar pagos;
* conservar membresías;
* conservar reservas históricas;
* conservar asistencia;
* conservar archivos;
* impedir o limitar operación futura según reglas.

Desactivar NO significa borrar.

## 3.4. Eliminar alumno definitivamente

Eliminar alumno definitivamente significa hard delete real.

Debe borrar físicamente:

* profile del alumno;
* Auth user si corresponde;
* membresías/programas;
* pagos;
* reservas;
* asistencia;
* horarios fijos del alumno;
* archivos metadata;
* archivos Drive del alumno creados por la app;
* notas de entrenamiento;
* logs/email relacionados cuando corresponda;
* audit logs relacionados según diseño implementado.

No debe borrar:

* clases globales;
* actividades;
* planes globales;
* otros alumnos;
* pagos de otros alumnos;
* reservas de otros alumnos;
* archivos de otros alumnos;
* Drive ajeno;
* admin;
* Carolina/admin.

## 3.5. Seguridad del hard delete

El hard delete debe:

* requerir admin activo;
* requerir JWT válido;
* mostrar en el modal el nombre y el email del alumno seleccionado;
* tomar internamente el email del alumno seleccionado, sin pedir que la administradora lo vuelva a escribir;
* validar en el backend que ese email corresponda al alumno seleccionado;
* requerir un preview/dry-run válido y mostrar los conteos antes de borrar;
* mantener deshabilitado el botón de eliminación sin preview válido;
* exigir que la administradora escriba exactamente `ELIMINAR`;
* borrar solo el alumno elegido;
* probarse únicamente con un alumno E2E cuando se autorice una prueba real;
* dejar resultado claro;
* devolver warning si falla limpieza Auth;
* no ejecutarse desde SQL manual.

---

# 4. Planes, programas y membresías

## 4.1. Terminología

En UI se puede hablar de “programa”.
En base de datos se usa `memberships`.

Un programa/membresía vincula:

* alumno;
* plan;
* estado;
* fecha de inicio;
* fecha de fin;
* créditos restantes si es paquete;
* monto requerido congelado;
* pagos asociados.

## 4.2. Estados de membresía

Estados:

* `active`
* `suspended`
* `expired`
* `cancelled`

## 4.3. Planes

Un plan define:

* nombre;
* precio;
* período;
* tipo;
* actividades incluidas;
* límites por actividad;
* créditos si corresponde;
* estado activo/inactivo.

## 4.4. Actividades incluidas

Un plan solo permite reservar actividades asociadas en `plan_activities`.

Ejemplo:

* Combo semipersonalizado y funcional:

  * Semipersonalizado: 2 por semana.
  * Neurofuncional: 1 por semana.

Si una actividad no está en el plan, el alumno no debe poder reservarla.

## 4.5. Límite por actividad

Los límites semanales son por actividad.

Ejemplo:

* Semipersonalizado 2/semana significa dos reservas semanales de Semipersonalizado.
* Neurofuncional 1/semana significa una reserva semanal de Neurofuncional.

No se debe mezclar el cupo de una actividad con otra salvo que el plan lo defina expresamente.

## 4.6. Programas por paquete

Si el plan es paquete:

* usa `remaining_credits`;
* cada reserva consume crédito;
* si se cancela con devolución, debe devolver crédito;
* si no quedan créditos, no se puede reservar.

## 4.7. Programas semanales/mensuales

Si el plan no es paquete:

* usa límite semanal por actividad;
* no descuenta `remaining_credits`;
* cuenta reservas de la semana;
* respeta actividad, membresía y estado de pago.

---

# 5. Pagos

## 5.1. Métodos

Métodos contemplados:

* efectivo;
* transferencia.

## 5.2. Estados

Estados:

* `pending`
* `approved`
* `rejected`

## 5.3. Pago manual admin

Un admin puede registrar pago manual.

El pago manual:

* crea un registro en `payments`;
* queda aprobado;
* vincula alumno y membresía;
* registra monto, método, fecha, notas;
* actualiza estado de membresía según pago completo o incompleto;
* registra auditoría.

## 5.4. Monto requerido congelado

Cuando se asigna un programa, se congela el monto requerido.

La membresía usa `required_amount`, no el precio mutable futuro del plan.

Esto evita que si cambia el precio del plan, una membresía ya asignada quede mal calculada.

## 5.5. Pago completo

Una membresía está completamente pagada si:

`approved_paid_total >= required_amount`

Solo cuentan pagos aprobados.

## 5.6. Pago parcial

Si el total aprobado es menor al monto requerido:

* la membresía no está fully paid;
* puede quedar suspendida;
* no debe habilitar reservas;
* debe mostrar pendiente.

## 5.7. Activación por pago

Si el pago completa el monto requerido:

* la membresía pasa a `active`;
* se define/actualiza rango de vigencia;
* se actualizan créditos si es paquete;
* se registra auditoría.

## 5.8. Suspensión por pago incompleto

Si una membresía activa deja de estar totalmente pagada:

* puede pasar a `suspended`;
* se cancelan reservas futuras activas de esa membresía;
* se devuelven créditos si corresponde;
* se registra auditoría.

## 5.9. Recordatorios de vencimiento de cuota (RAN-36)

Los recordatorios de cuota se evalúan exactamente 5, 3, 1 y 0 días antes
del vencimiento.

La única fecha fuente es el `memberships.end_date` actual. No se reconstruye
el vencimiento desde `payments`, `last_payment_at` ni otra fecha derivada. Si
una renovación extiende la misma membresía antes de la evaluación, el
`end_date` nuevo reemplaza al anterior y el recordatorio de la fecha vieja deja
de ser elegible.

La evaluación usa fechas `YYYY-MM-DD` en la zona
`America/Argentina/Cordoba`. Un candidato solo es elegible cuando:

* el alumno está activo y tiene un email válido;
* `receives_payment_reminders = true`;
* la membresía tiene estado `active`;
* `start_date` no es posterior a la fecha de evaluación;
* la diferencia entre la fecha de evaluación y `end_date` es exactamente 5,
  3, 1 o 0 días.

`receives_payment_reminders` es una preferencia independiente de
`receives_emails`, con `NOT NULL DEFAULT true`.

En B1B, el alta no expone esta preferencia: las altas nuevas reciben
`receives_payment_reminders = true` por default de base de datos y la
administración puede cambiarla luego desde la ficha del alumno.

La clave de idempotencia es:

`payment_due_reminder:<membership_id>:<end_date>:<offset_days>`

`email_logs` admite esa clave de forma nullable y aplica unicidad solo cuando
la clave no es `NULL`, sin afectar logs históricos.

Las fases están separadas:

* B1A/B1 es únicamente foundation, harness y dry-run: autentica un admin
  activo, hace solo lecturas y no envía emails ni llama a Mailjet;
* B1B permite a la administración activarla o desactivarla desde la
  ficha/edición del alumno y al alumno hacerlo desde su perfil, siempre de
  forma independiente de `receives_emails`; esta UI solo persiste la
  preferencia, no invoca `send-payment-reminders` ni envía emails;
* B2 habilitará Mailjet mediante una prueba E2E controlada;
* B3 incorporará la ejecución programada por cron.

---

# 6. Reservas

## 6.1. Regla central

Un alumno solo puede reservar si tiene:

* sesión activa;
* actividad activa;
* clase futura;
* cupo disponible;
* membresía activa;
* membresía dentro de fecha;
* actividad incluida en el plan;
* pago completo;
* límite semanal o créditos disponibles;
* no tiene reserva activa duplicada en esa clase;
* está dentro del plazo permitido de reserva.

## 6.2. No reservar clase iniciada

No se puede reservar una clase que ya comenzó.

## 6.3. No reservar clase inactiva/cancelada

No se puede reservar si:

* la clase está inactiva;
* la clase tiene `cancelled_at`;
* la actividad está inactiva.

## 6.4. No duplicar reserva

El alumno no puede tener dos reservas activas en la misma clase.

## 6.5. Cupo de clase

La clase tiene capacidad.

Para calcular cupo ocupado cuentan:

* reservas `booked`;
* reservas `attended`;
* reservas `no_show`;

No deben contar:

* reservas canceladas;
* reservas justificadas que liberan uso/cupo según regla vigente.

## 6.6. Pago completo obligatorio

Aunque exista membresía activa, si no está fully paid:

* no se puede reservar;
* el motivo debe indicar que la membresía no tiene pago completo.

## 6.7. Límite semanal

Para planes no paquete:

* se cuentan reservas de la semana de esa actividad;
* la semana se calcula por la fecha de la clase;
* si el uso semanal llegó al límite, no se puede reservar.

## 6.8. Justificados

Una asistencia/reserva justificada no debe consumir límite semanal.

Las correcciones a justificado deben liberar uso cuando corresponda.

## 6.9. Paquetes

Para planes paquete:

* se requiere crédito disponible;
* reservar descuenta crédito;
* cancelar en condiciones válidas debe devolver crédito si corresponde;
* no se puede reservar sin créditos.

## 6.10. Motivos de bloqueo

La UI debe mostrar motivos claros:

* clase ya comenzó;
* actividad inactiva;
* ya tiene reserva activa;
* fuera de plazo de reserva;
* sin cupos;
* membresía sin pago completo;
* límite semanal agotado;
* membresía no permite esta clase;
* sin clases/créditos disponibles.

---

# 7. Cancelación de reservas

## 7.1. Cancelación por alumno

El alumno puede cancelar reservas según reglas de corte.

La cancelación debe:

* cambiar estado a `cancelled`;
* registrar `cancelled_at`;
* registrar motivo/actor si corresponde;
* liberar cupo;
* liberar límite semanal si corresponde;
* devolver crédito si corresponde.

## 7.2. Cortes de cancelación

Cada actividad puede tener regla de cancelación.

Si aplica 24 horas:

* la cancelación tardía puede no liberar cupo/crédito;
* debe marcarse como corresponde según diseño operativo.

## 7.3. Cancelación por admin

Admin puede cancelar/reubicar según operación.

Debe conservar auditoría.

## 7.4. Cancelación por programa sin pago

Si un programa activo deja de estar fully paid:

* las reservas futuras activas vinculadas pueden cancelarse automáticamente;
* debe registrarse motivo;
* si consumió créditos, se deben devolver cuando corresponda.

---

# 8. Calendario y clases

## 8.1. Clase común

Una clase común es una sesión individual en `class_sessions`.

Puede tener:

* actividad;
* título;
* inicio;
* fin;
* cupo;
* entrenador;
* notas;
* estado activo;
* cancelación.

## 8.2. Clase recurrente

Una clase recurrente se basa en una regla recurrente.

Tiene:

* actividad;
* día de semana;
* hora inicio;
* hora fin;
* cupo;
* vigencia desde;
* vigencia hasta;
* estado activo;
* excepciones;
* sesiones materializadas.

## 8.3. Crear recurrente

Al crear horario recurrente:

* no debe duplicar regla activa equivalente;
* debe detectar conflictos;
* si hay ocurrencia cancelada/inactiva en esa fecha, puede restaurarla;
* si una regla futura bloquea slot anterior, puede crear regla acotada hasta antes de la futura;
* debe materializar sesiones futuras;
* debe devolver mensaje claro.

## 8.4. Editar clase común

Editar solo una clase puede modificar esa sesión puntual sin cambiar la serie.

Debe usarse cuando:

* se quiere cambiar una clase puntual;
* no se quiere afectar la recurrencia;
* hay historial que no debe moverse.

## 8.5. Editar recurrente

Editar horario recurrente puede:

* actualizar cupo/notas/entrenador/título si no cambia estructura;
* hacer split de serie si cambia horario/actividad desde clase futura sin reservas/asistencia;
* bloquear si la clase futura tiene reservas/asistencia;
* bloquear si se intenta cambiar una clase pasada con historial.

## 8.6. Cambio estructural

Cambio estructural incluye:

* actividad;
* día;
* hora de inicio;
* hora de fin.

Si hay reservas/asistencia, no mover automáticamente.

Mensaje correcto:
“Esta clase futura ya tiene reservas/asistencia. No se mueve automáticamente para no romper historial. Cancelá o reubicá esas reservas primero, o elegí una fecha futura sin reservas para cambiar el horario recurrente.”

## 8.7. Clase pasada

No cambiar estructuralmente una clase pasada con historial.

Mensaje correcto:
“Esta clase ya pasó. Para cambiar el horario hacia adelante, elegí una clase futura de la serie o usá ‘Dejar de repetir este horario’ y creá uno nuevo.”

## 8.8. Dejar de repetir

“Dejar de repetir este horario”:

* no borra historial;
* no borra reservas pasadas;
* no borra asistencia;
* corta la recurrencia hacia adelante;
* evita nuevas sesiones futuras.

## 8.9. No tocar calendario sin issue

El calendario recurrente ya fue corregido en bloques P0.

No modificar:

* creación recurrente;
* edición recurrente;
* materialización;
* reglas de conflicto;

salvo issue explícito y reproducible.

---

# 9. Asistencia

## 9.1. Estados de asistencia

Estados:

* `present`
* `absent`
* `justified`

## 9.2. Marcar asistencia

Admin puede marcar asistencia.

Debe vincular:

* booking;
* alumno;
* clase;
* estado;
* notas;
* quién registró;
* fecha de registro.

## 9.3. Presente

`present` indica que el alumno asistió.

Puede contar como clase utilizada.

## 9.4. Ausente

`absent` indica ausencia.

Puede contar o no según reglas de cobro/operación.

## 9.5. Justificado

`justified` indica ausencia justificada.

Debe liberar uso semanal cuando corresponde.

## 9.6. Corrección a justificado

Admin puede corregir una asistencia a justificado.

Debe:

* conservar auditoría;
* actualizar efecto sobre cupo/límite;
* no borrar historial.

---

# 10. Google Drive y archivos

## 10.1. Regla base

Los archivos reales van a Google Drive de E-Motiva.

No usar:

* Drive personal de Carolina;
* Supabase Storage para archivos del alumno, salvo decisión futura explícita.

Cuenta Drive:
`e.motiva.gym@gmail.com`

## 10.2. Metadata

Supabase guarda metadata.

Debe guardar:

* alumno;
* tipo;
* título;
* descripción si existe;
* Drive file id;
* Drive URL;
* MIME;
* tamaño;
* visible para alumno;
* quién subió;
* fechas;
* estado/archivado si aplica.

## 10.3. Visibilidad

Admin:

* puede ver archivos de todos.

Alumno:

* solo puede ver archivos propios;
* solo puede ver archivos marcados como visibles para alumno;
* no ve archivos de otros alumnos;
* no ve archivos solo-admin.

## 10.4. Upload admin

Admin sube archivo desde ficha del alumno.

Reglas:

* debe estar autenticado;
* debe ser admin activo;
* debe seleccionar alumno válido y activo;
* debe subir archivo permitido;
* debe guardarse en Drive;
* debe guardarse metadata;
* si falla metadata, limpiar Drive;
* si falla Drive, no guardar metadata.

## 10.5. Compartir con alumno

Para archivo visible al alumno:

* primero intentar compartir por email del alumno;
* si se comparte por email, modo `student_email`.

## 10.6. Fallback por enlace

`anyone_with_link` no debe ser default.

Solo se permite si:

* existe decisión explícita;
* env `ALLOW_DRIVE_LINK_FALLBACK=true`;
* queda auditado;
* se informa warning.

Si fallback está apagado y falla compartir por email:

* no guardar metadata;
* borrar el archivo recién subido;
* devolver error claro.

## 10.7. Archivo solo admin

Si `visible_to_student=false`:

* no hace falta compartir con alumno;
* admin lo ve;
* alumno no lo ve.

## 10.8. Limpieza Drive

Al eliminar definitivamente un alumno:

* se deben borrar los archivos Drive del alumno creados por la app;
* si falla Drive, no borrar DB;
* si Drive se borra y luego DB falla, reportar retry requerido.

---

# 11. Eliminaciones y borrados

## 11.1. Diferencia entre desactivar, cancelar y borrar

Desactivar:

* conserva datos;
* impide uso futuro.

Cancelar:

* conserva historial;
* cambia estado de una reserva/clase/programa.

Dejar de repetir:

* corta recurrencia futura;
* conserva historial.

Borrar definitivamente:

* elimina físicamente datos.

## 11.2. Alumno

Eliminar alumno definitivamente:

* sí borra físicamente todo lo asociado al alumno;
* requiere preview/dry-run válido;
* toma internamente el email del alumno seleccionado y valida en el backend que corresponda a ese alumno, sin pedir que la administradora lo vuelva a escribir;
* requiere que la administradora escriba exactamente `ELIMINAR`;
* debe ejecutarse por Edge Function;
* no por SQL manual.

## 11.3. Clase

Eliminar clase común definitivamente solo debe hacerse si el producto lo exige explícitamente.

Si hay reservas/asistencia/historial:

* preferir cancelar/desactivar;
* no borrar físico sin regla clara.

## 11.4. Clase recurrente

No borrar serie recurrente con historial como primera opción.

Usar:

* dejar de repetir;
* cancelar ocurrencia;
* editar solo una clase;
* split desde fecha futura.

## 11.5. Pagos

No borrar pagos reales salvo hard delete del alumno o flujo explícito de anulación definido.

Un pago aprobado es dato sensible de negocio.

## 11.6. Archivos

Eliminar archivo debe:

* borrar Drive si corresponde;
* borrar/archivar metadata según regla;
* no dejar Drive sin metadata ni metadata sin Drive.

---

# 12. Auditoría

## 12.1. Qué auditar

Auditar:

* creación de reserva;
* cancelación de reserva;
* registro de pago;
* asignación de programa;
* reconciliación de pago/membresía;
* cambios de asistencia;
* upload de archivo;
* hard delete;
* cambios de recurrentes.

## 12.2. Auditoría no debe bloquear operación central

Si falla audit log secundario, evaluar si debe bloquear o solo reportar.

Pero para hard delete y datos sensibles debe quedar rastro suficiente de acción ejecutada.

---

# 13. UI Admin

## 13.1. Admin Alumnos

Debe permitir:

* crear alumno;
* editar alumno;
* desactivar alumno;
* asignar programa;
* registrar pago;
* ver historial;
* ver reservas;
* ver asistencia;
* subir archivos;
* eliminar definitivamente con flujo seguro.

## 13.2. Admin Pagos

Debe mostrar:

* programa;
* monto requerido;
* monto pagado aprobado;
* pendiente;
* estado paid/partial/unpaid;
* estado de membresía.

## 13.3. Admin Calendario

Debe permitir:

* crear clase común;
* editar clase común;
* crear recurrente;
* editar recurrente con reglas de seguridad;
* cancelar clase;
* dejar de repetir horario;
* ver reservas/cupos.

## 13.4. Admin Archivos

Debe permitir:

* subir archivo;
* marcar visible/no visible para alumno;
* ver metadata;
* abrir archivo Drive;
* manejar errores claros.

---

# 14. UI Alumno

## 14.1. Panel alumno

Debe mostrar:

* estado de programa/membresía;
* clases disponibles;
* reservas propias;
* límites disponibles;
* archivos visibles;
* errores claros.

## 14.2. Calendario alumno

Debe mostrar:

* clases activas;
* cupos;
* si puede reservar;
* motivo si no puede;
* reserva propia;
* cancelación si corresponde.

## 14.3. Archivos alumno

Debe mostrar:

* solo archivos propios;
* solo visibles para alumno;
* link/abrir archivo si tiene permiso;
* no mostrar archivos de otros alumnos.

---

# 15. Reglas de Codex / desarrollo

## 15.1. Antes de tocar

Siempre:

1. leer este documento;
2. buscar issue Linear;
3. revisar PRs relacionados;
4. snapshot git;
5. build/lint/diff;
6. dry-run Supabase;
7. definir alcance exacto.

## 15.2. Durante el cambio

No tocar módulos fuera de alcance.

Cada cambio debe tener:

* rama dedicada;
* PR;
* descripción;
* validación;
* riesgo;
* deploy requerido;
* db push requerido;
* E2E.

## 15.3. Después del cambio

Nunca decir cerrado sin:

* build OK;
* lint OK;
* diff-check OK;
* dry-run OK;
* E2E mínimo;
* reporte final.

## 15.4. Producción real

Antes de tocar producción:

* confirmar qué se va a tocar;
* no hacer db push si no hay migración esperada;
* deploy solo de función específica;
* no deploy global innecesario;
* no tocar datos reales manualmente.

---

# 16. Estados de cierre

## 16.1. CERRAR

Solo si:

* funciona en UI;
* funciona en DB/RPC;
* E2E pasó;
* no hay residuos;
* no hay restricción que afecte operación diaria.

## 16.2. CERRAR CON RESTRICCIÓN

Solo si:

* la restricción está escrita;
* no afecta operación principal;
* Carolina puede operar igual;
* hay issue de seguimiento.

## 16.3. NO CERRAR

Si:

* rompe operación real;
* no pasó E2E;
* toca datos reales sin control;
* deja Drive sin metadata o metadata sin Drive;
* borra algo incorrecto;
* calendario/reservas/pagos quedan inconsistentes.

---

# 17. Reglas de no regresión

No volver a romper:

1. Prueba 1 con pago completo debe poder reservar según plan.
2. Combo semipersonalizado y funcional:

   * Semipersonalizado: 2/semana.
   * Neurofuncional: 1/semana.
3. Reserva exige membresía activa y fully paid.
4. Reservas justificadas no consumen límite semanal.
5. Drive debe subir archivo real y guardar metadata.
6. Alumno solo ve sus archivos visibles.
7. Hard delete debe borrar todo lo asociado al alumno E2E sin residuos.
8. Editar recurrente con reservas debe bloquear con mensaje claro.
9. Editar recurrente futura sin historial puede hacer split.
10. No mover reservas automáticamente.
11. No borrar historial de clases pasadas.
12. No usar fallback Drive por enlace salvo env explícito.
13. No llamar al sistema MVP.
14. No trabajar sin Linear/GitHub.
15. No tocar módulos ajenos al microbloque.

---

# 18. Glosario

## Alumno

Usuario con rol `student`.

## Admin

Usuario con rol `admin`.

## Programa

Nombre de UI para una membresía asignada.

## Membership

Entidad DB que vincula alumno + plan + vigencia + pago.

## Plan

Producto comercial: define precio, tipo y actividades permitidas.

## Actividad

Tipo de clase: Semipersonalizado, Neurofuncional, Personalizado, etc.

## Clase común

Sesión individual.

## Clase recurrente

Serie generada por regla recurrente.

## Reserva

Booking del alumno en una clase.

## Asistencia

Registro posterior a la reserva/clase.

## Fully paid

Membresía cuyo total aprobado es mayor o igual al monto requerido congelado.

## Hard delete

Eliminación física real.

## Desactivar

Baja lógica que conserva historial.

## Drive metadata

Registro Supabase que apunta al archivo real en Google Drive.

---

# 19. Regla final

Si una instrucción futura contradice este documento, Codex debe detenerse y preguntar.

No resolver por intuición.

No “mejorar” reglas de negocio sin autorización.

No cambiar comportamiento productivo por seguridad abstracta sin revisar Linear.

Este documento manda hasta que Walter/Carolina lo modifiquen explícitamente.
