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
      pendingLabel="Acceso admin protegido. La gestion operativa se incorpora en los proximos bloques."
      section="Panel administracion"
      subtitle="Area reservada para perfiles con rol admin activo en Supabase."
      title="Panel administracion"
    />
  )
}
