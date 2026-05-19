import { LayoutShell } from '../components/LayoutShell'

const navItems = [
  { label: 'Dashboard', to: '/admin' },
  { label: 'Alumnos', to: '/admin/students' },
  { label: 'Pagos', to: '/admin/payments' },
  { label: 'Calendario', to: '/admin/calendar' },
  { label: 'Asistencia', to: '/admin/attendance' },
  { label: 'Planes', to: '/admin/plans' },
  { label: 'Emails', to: '/admin/emails' },
  { label: 'Archivos', to: '/admin/storage' },
  { label: 'Configuración', to: '/admin/settings' },
]

export function AdminLayout() {
  return (
    <LayoutShell
      navItems={navItems}
      pendingLabel="Gestión interna para alumnos, clases, planes, pagos y documentos."
      section="Panel administrativo"
      subtitle="Gestión del gimnasio y operación diaria de E-Motiva."
      title="Panel administrativo"
    />
  )
}
