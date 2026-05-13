import { PlaceholderPanel } from '../../components/PlaceholderPanel'

export function AdminDashboardPage() {
  return (
    <PlaceholderPanel
      bullets={[
        'Panel admin sin backend conectado.',
        'Alumnos, pagos y membresias reales quedan para RANV2-05.',
        'Auth real queda para RANV2-04.',
        'Supabase nuevo sigue pendiente.',
      ]}
      description="Base de administracion para que el proximo bloque agregue operaciones reales sin rehacer layout ni rutas."
      eyebrow="/admin"
      title="Dashboard administracion"
    />
  )
}
