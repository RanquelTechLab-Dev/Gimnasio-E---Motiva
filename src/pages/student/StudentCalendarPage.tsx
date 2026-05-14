import { PlaceholderPanel } from '../../components/PlaceholderPanel'

export function StudentCalendarPage() {
  return (
    <PlaceholderPanel
      bullets={[
        'Calendario del alumno.',
        'Clases y cupos se incorporan en el modulo de reservas.',
        'La logica de reservas queda protegida por reglas de negocio.',
        'Acceso disponible solo con sesion activa.',
      ]}
      description="Este espacio muestra el lugar donde el alumno consultara clases disponibles segun plan y cupo."
      eyebrow="/app/calendar"
      title="Calendario del alumno"
    />
  )
}
