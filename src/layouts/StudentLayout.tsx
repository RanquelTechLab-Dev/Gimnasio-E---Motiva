import { LayoutShell } from '../components/LayoutShell'

const navItems = [
  { label: 'Dashboard', to: '/app' },
  { label: 'Calendario', to: '/app/calendar' },
  { label: 'Mis reservas', to: '/app/my-bookings' },
  { label: 'Mi plan', to: '/app/my-plan' },
  { label: 'Perfil', to: '/app/profile' },
]

export function StudentLayout() {
  return (
    <LayoutShell
      navItems={navItems}
      pendingLabel="Sesion real conectada. Las reglas de plan, cupos y datos operativos se incorporan en los proximos bloques."
      section="Panel alumno"
      subtitle="Acceso protegido para alumnos con sesion activa y perfil cargado desde Supabase."
      title="Espacio del alumno"
    />
  )
}
