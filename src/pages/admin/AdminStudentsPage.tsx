import { PlaceholderPanel } from '../../components/PlaceholderPanel'

export function AdminStudentsPage() {
  return (
    <PlaceholderPanel
      bullets={[
        'Alta y edicion de alumnos.',
        'Cuentas creadas por administracion.',
        'Perfiles vinculados a Supabase Auth.',
        'Espacio operativo protegido.',
      ]}
      description="Este panel va a concentrar el alta de alumnos, ficha y navegacion administrativa principal."
      eyebrow="/admin/students"
      title="Gestion de alumnos"
    />
  )
}
