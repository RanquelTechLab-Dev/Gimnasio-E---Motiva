import { PlaceholderPanel } from '../../components/PlaceholderPanel'

export function AdminDashboardPage() {
  return (
    <PlaceholderPanel
      bullets={[
        'Gestión de alumnos, clases, planes y pagos manuales.',
        'Seguimiento de asistencia, documentos y comunicaciones.',
        'Acceso exclusivo para administración del gimnasio.',
        'Información organizada para la operación diaria.',
      ]}
      description="Panel inicial para revisar y administrar la actividad diaria de E-Motiva."
      eyebrow="Administración"
      title="Panel administrativo"
    />
  )
}
