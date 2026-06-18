# E-Motiva - Safe Cleanup and Data Protection

## Contexto

E-Motiva ya esta en uso real por Carolina. El sistema contiene alumnos,
pagos, programas, reservas, asistencia, archivos y horarios que forman parte
del negocio operativo. Por eso, RAN-35 deja de tratar la limpieza como una
politica de hard delete general y pasa a enfocarse en saneamiento tecnico
seguro.

## Regla principal

La limpieza tecnica no debe borrar negocio real.

Esto incluye:

- alumnos reales
- pagos reales
- memberships/programas reales
- reservas reales
- asistencia real
- archivos reales

Si un dato operativo molesta o confunde, primero se revisa su naturaleza y
despues se elige la accion menos destructiva posible.

## Acciones seguras preferidas

Antes de pensar en borrar fisicamente, evaluar en este orden:

1. ocultar en UI
2. archivar
3. anular
4. cancelar
5. pausar regla recurrente
6. reparar drift tecnico
7. borrar fisicamente solo si es basura tecnica demostrada y sin historial

## Que si puede sanearse

RAN-35 puede trabajar sobre basura tecnica claramente identificada, por
ejemplo:

- sesiones canceladas o inactivas que no deberian mostrarse en calendario
- reglas recurrentes inactivas que bloquean recreaciones
- datos test identificables por email, titulo o naming controlado
- botones o textos viejos/confusos de UI
- funciones o flujos obsoletos que incentiven borrados peligrosos

## Que no debe tocarse como "limpieza"

- pagos reales para resetear estado
- alumnos reales porque "sobran"
- memberships reales para ordenar UI
- reservas o asistencia reales para destrabar calendario
- archivos reales de alumnos
- clases con historial real como atajo para corregir una inconsistencia

## Politica de clases y calendario

Si una clase tiene reservas o asistencia:

- no se borra fisicamente como limpieza tecnica comun
- se prefiere cancelar, ocultar o reparar la visualizacion
- si pertenece a una regla recurrente, se prefiere pausar la regla o cancelar
  la ocurrencia puntual

Si una sesion futura esta cancelada/inactiva y sigue apareciendo, la respuesta
correcta es corregir el filtro o reconciliar sesiones materializadas, no tocar
pagos/alumnos/memberships.

## Politica de datos test

Los datos test solo pueden limpiarse si cumplen todas estas condiciones:

- estan claramente identificados como test/demo
- no forman parte del negocio real de Carolina
- no tienen historial operativo relevante
- existe preview o evidencia suficiente antes de actuar
- la accion fue autorizada explicitamente

## Auditoria y previews

Toda limpieza tecnica debe ser:

- preview primero
- read-only por defecto
- explicita en alcance
- reversible cuando sea posible
- documentada si impacta datos operativos

Si existe duda entre "dato real" y "basura tecnica", se trata como dato real
hasta demostrar lo contrario.

## UI y seguridad

En produccion no deben quedar visibles por defecto:

- botones de hard delete general de alumnos
- hard delete de pagos reales
- hard delete de archivos reales
- hard delete de clases con reservas/asistencia
- limpieza demo masiva

La UI debe hablar claro sobre si una accion:

- cancela
- archiva
- anula
- oculta
- o elimina fisicamente solo si es seguro

## Backups y plataforma

La app debe preservar el negocio real en la base activa. Los backups de
plataforma pueden existir por politicas del proveedor, pero no se usan como
excusa para permitir borrados peligrosos desde UI.

## Objetivo operativo de RAN-35

Dejar el sistema:

- sano
- estable
- sin basura tecnica visible
- sin flujos destructivos generales expuestos
- preservando intacto el negocio real de Carolina
