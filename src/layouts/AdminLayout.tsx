import { LayoutShell } from '../components/LayoutShell'

const navItems = [
  { label: 'Dashboard', to: '/admin' },
  { label: 'Alumnos', to: '/admin/students' },
  { label: 'Pagos', to: '/admin/payments' },
  { label: 'Calendario', to: '/admin/calendar' },
  { label: 'Asistencia', to: '/admin/attendance' },
  { label: 'Planes', to: '/admin/plans' },
  { label: 'Emails', to: '/admin/emails' },
  { label: 'Storage', to: '/admin/storage' },
  { label: 'Settings', to: '/admin/settings' },
]

export function AdminLayout() {
  return (
    <LayoutShell
      navItems={navItems}
      pendingLabel="Auth real, Supabase y operaciones administrables quedan pendientes para RANV2-03, RANV2-04 y RANV2-05."
      section="Panel administracion"
      subtitle="Base visual y de navegacion para que el siguiente bloque conecte negocio real sin rehacer estructura."
      title="Panel administracion"
    />
  )
}
