import { PlaceholderPanel } from '../../components/PlaceholderPanel'

export function AdminStudentsPage() {
  return (
    <PlaceholderPanel
      bullets={[
        'Alta y edicion de alumnos pendientes.',
        'No se crean cuentas reales todavia.',
        'Supabase/Auth quedan para RANV2-04 y RANV2-05.',
        'La vista ya reserva el espacio operativo.',
      ]}
      description="Este panel va a concentrar el alta de alumnos, ficha y navegacion administrativa principal."
      eyebrow="/admin/students"
      title="Gestion de alumnos"
    />
  )
}
