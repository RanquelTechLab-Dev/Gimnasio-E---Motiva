import { PlaceholderPanel } from '../../components/PlaceholderPanel'

export function AdminDashboardPage() {
  return (
    <PlaceholderPanel
      bullets={[
        'Acceso protegido para administracion.',
        'Alumnos, pagos y membresias se incorporan en el panel operativo.',
        'Sesion activa validada con Supabase Auth.',
        'Perfil admin cargado desde Supabase.',
      ]}
      description="Panel inicial de administracion para gestionar E-Motiva a medida que se incorporan las operaciones del gimnasio."
      eyebrow="/admin"
      title="Dashboard administracion"
    />
  )
}
