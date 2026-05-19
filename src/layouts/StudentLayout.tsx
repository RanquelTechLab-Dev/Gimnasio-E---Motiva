import { LayoutShell } from '../components/LayoutShell'

const navItems = [
  { label: 'Dashboard', to: '/app' },
  { label: 'Calendario', to: '/app/calendar' },
  { label: 'Mis reservas', to: '/app/bookings' },
  { label: 'Planes y precios', to: '/app/plans' },
  { label: 'Mis pagos', to: '/app/payments' },
  { label: 'Mi asistencia', to: '/app/attendance' },
  { label: 'Perfil', to: '/app/profile' },
  { label: 'Archivos', to: '/app/files' },
]

export function StudentLayout() {
  return (
    <LayoutShell
      navItems={navItems}
      pendingLabel="Tus datos se actualizan desde administración. Si algo no coincide, contactanos para revisarlo."
      section="Panel alumno"
      subtitle="Clases, reservas, pagos y documentos en un solo lugar."
      title="Espacio del alumno"
    />
  )
}
