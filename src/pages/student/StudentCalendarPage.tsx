import { PlaceholderPanel } from '../../components/PlaceholderPanel'

export function StudentCalendarPage() {
  return (
    <PlaceholderPanel
      bullets={[
        'Calendario placeholder.',
        'Sin clases reales ni cupos por ahora.',
        'La logica de reservas queda para RANV2-06.',
        'No hay backend conectado.',
      ]}
      description="Este espacio va a mostrar las clases disponibles segun plan y cupo, pero hoy queda como base visual."
      eyebrow="/app/calendar"
      title="Calendario del alumno"
    />
  )
}
