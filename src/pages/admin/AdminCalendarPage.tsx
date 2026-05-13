import { PlaceholderPanel } from '../../components/PlaceholderPanel'

export function AdminCalendarPage() {
  return (
    <PlaceholderPanel
      bullets={[
        'Clases y sesiones no creadas todavia.',
        'Calendario funcional queda para RANV2-06.',
        'Sin reglas de cupo ni validacion real por ahora.',
        'Solo estructura visual y navegacion.',
      ]}
      description="Base para calendario administrativo, edicion de clases y vista operativa del gimnasio."
      eyebrow="/admin/calendar"
      title="Calendario admin"
    />
  )
}
