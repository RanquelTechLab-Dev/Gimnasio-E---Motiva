import { PlaceholderPanel } from '../../components/PlaceholderPanel'

export function StudentDashboardPage() {
  return (
    <PlaceholderPanel
      bullets={[
        'Vista de resumen del alumno.',
        'Sesion activa validada con Supabase Auth.',
        'Reservas y clases se incorporan en los proximos bloques.',
        'Se mantiene navegacion lista para celular, tablet y escritorio.',
      ]}
      description="Punto de entrada del alumno para consultar reservas, membresia, perfil y actividad a medida que se habilitan las funciones."
      eyebrow="/app"
      title="Dashboard del alumno"
    />
  )
}
