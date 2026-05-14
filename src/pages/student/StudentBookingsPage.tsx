import { PlaceholderPanel } from '../../components/PlaceholderPanel'

export function StudentBookingsPage() {
  return (
    <PlaceholderPanel
      bullets={[
        'Reservas del alumno.',
        'Validacion por plan se aplica desde reglas de negocio.',
        'Cancelaciones y reglas 24h se incorporan con el calendario.',
        'Acceso disponible solo con sesion activa.',
      ]}
      description="Vista donde el alumno consultara y gestionara sus reservas cuando el calendario este habilitado."
      eyebrow="/app/my-bookings"
      title="Mis reservas"
    />
  )
}
