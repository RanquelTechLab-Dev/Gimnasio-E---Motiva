import { LayoutShell } from '../components/LayoutShell'

const navItems = [
  { label: 'Dashboard', to: '/app' },
  { label: 'Calendario', to: '/app/calendar' },
  { label: 'Mis reservas', to: '/app/bookings' },
  { label: 'Mis pagos', to: '/app/payments' },
  { label: 'Mi asistencia', to: '/app/attendance' },
  { label: 'Perfil', to: '/app/profile' },
  { label: 'Archivos', to: '/app/files' },
]

export function StudentLayout() {
  return (
    <LayoutShell
      navItems={navItems}
      pendingLabel="Datos propios conectados a Supabase. Pagos online, Drive real y archivos avanzados quedan fuera de este bloque."
      section="Panel alumno"
      subtitle="Autogestion basica para perfil, reservas, pagos y asistencia."
      title="Espacio del alumno"
    />
  )
}
