import { PlaceholderPanel } from '../../components/PlaceholderPanel'

export function AdminCalendarPage() {
  return (
    <PlaceholderPanel
      bullets={[
        'Clases y sesiones se incorporan en el modulo de calendario.',
        'Calendario funcional para administracion.',
        'Reglas de cupo y validacion por plan se agregan con reservas.',
        'Acceso protegido para administracion.',
      ]}
      description="Base para calendario administrativo, edicion de clases y vista operativa del gimnasio."
      eyebrow="/admin/calendar"
      title="Calendario admin"
    />
  )
}
