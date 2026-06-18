# Calendar Engine Acceptance Checklist

Fecha: 2026-06-18

Este checklist valida el contrato operativo del calendario RAN-34. No requiere tocar pagos, alumnos, membresias, archivos, reservas historicas ni asistencia.

## Precondiciones

- Supabase dry-run debe mostrar solo la migracion del PR antes de aplicarla.
- No ejecutar `db push` real desde este PR sin aprobacion.
- Usar preview o entorno autorizado por Walter.
- Si se prueba con datos reales, documentar alumno, fecha, clase y resultado.

## Crear horario recurrente

1. Crear un horario recurrente viernes 07:00 para una actividad de prueba.
2. Confirmar que aparece en la semana actual.
3. Avanzar a semanas futuras y confirmar que sigue apareciendo.
4. Intentar crear otro horario activo igual.
5. Debe bloquear con mensaje claro de duplicado activo.

## Pausar y recrear

1. Pausar el horario recurrente desde una clase visible.
2. Confirmar mensaje de exito.
3. Confirmar que la clase pausada y futuras sin reservas/asistencia desaparecen del calendario operativo.
4. Crear nuevamente el mismo horario.
5. Debe permitir crearlo porque la regla anterior quedo inactiva/cerrada.

## Cancelar solo una fecha

1. Crear o elegir una ocurrencia recurrente.
2. Usar "Cancelar solo esta fecha".
3. Confirmar que esa fecha no aparece en la grilla.
4. Confirmar que las semanas siguientes siguen apareciendo.
5. Confirmar que no se borraron reservas/asistencia.

## Editar solo una clase

1. Editar una ocurrencia recurrente con "Editar solo esta clase".
2. Cambiar cupo u horario permitido.
3. Confirmar que solo cambia esa clase.
4. Confirmar que la regla madre no se modifica.

## Editar horario recurrente

1. Editar un horario recurrente desde una fecha futura.
2. Confirmar que las semanas futuras muestran la regla nueva.
3. Confirmar que futuras sesiones viejas sin reservas/asistencia desaparecen.
4. Si hay reservas/asistencia futuras, confirmar que quedan skipped y aparece advertencia visible.

## Render operativo

1. Confirmar que `active=false` no aparece en Admin -> Calendario.
2. Confirmar que `cancelled_at is not null` no aparece en Admin -> Calendario.
3. Confirmar que no aparece una fila 21:00 si no hay clases reales activas a esa hora.
4. Confirmar que Cognitivo aparece solo en el horario real configurado.

## Errores

1. Forzar una duplicacion valida.
2. El mensaje debe incluir la causa de negocio.
3. Si falla una RPC o deployment, el mensaje debe incluir el nombre de RPC.

## Datos Protegidos

- No borrar pagos.
- No borrar alumnos.
- No borrar membresias.
- No borrar archivos/Drive.
- No borrar bookings.
- No borrar attendance.
