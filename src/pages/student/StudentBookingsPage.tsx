import { PlaceholderPanel } from '../../components/PlaceholderPanel'

export function StudentBookingsPage() {
  return (
    <PlaceholderPanel
      bullets={[
        'Sin reservas reales en este bloque.',
        'No existe validacion por plan todavia.',
        'Cancelaciones y reglas 24h quedan para RANV2-06.',
        'La estructura ya esta lista para conectarse luego.',
      ]}
      description="La futura vista de reservas del alumno ya tiene su ruta definida para no rehacer navegacion mas adelante."
      eyebrow="/app/my-bookings"
      title="Mis reservas"
    />
  )
}
