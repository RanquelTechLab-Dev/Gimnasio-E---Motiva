import { PlaceholderPanel } from '../../components/PlaceholderPanel'

export function AdminAttendancePage() {
  return (
    <PlaceholderPanel
      bullets={[
        'Asistencia pendiente.',
        'No afecta actividad real todavia.',
        'No hay conexion a clases ni alumnos.',
        'Bloque futuro: RANV2-07.',
      ]}
      description="Esta ruta prepara el espacio para la asistencia diaria y sus reglas de negocio."
      eyebrow="/admin/attendance"
      title="Asistencia"
    />
  )
}
