import { PlaceholderPanel } from '../../components/PlaceholderPanel'

export function AdminAttendancePage() {
  return (
    <PlaceholderPanel
      bullets={[
        'Asistencia de clases.',
        'Registro protegido para administracion.',
        'Conexion con clases y alumnos se incorpora con el calendario.',
        'Preparado para seguimiento diario.',
      ]}
      description="Esta ruta prepara el espacio para la asistencia diaria y sus reglas de negocio."
      eyebrow="/admin/attendance"
      title="Asistencia"
    />
  )
}
