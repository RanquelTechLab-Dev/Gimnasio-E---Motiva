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
      pendingLabel="Autenticacion real, reglas de plan y datos reales quedan pendientes para RANV2-04 y RANV2-06."
      section="Panel alumno"
      subtitle="Rutas placeholder para validar navegacion, estructura y experiencia base en celular, tablet y escritorio."
      title="Espacio del alumno"
    />
  )
}
