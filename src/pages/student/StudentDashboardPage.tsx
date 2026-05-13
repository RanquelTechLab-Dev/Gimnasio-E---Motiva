import { PlaceholderPanel } from '../../components/PlaceholderPanel'

export function StudentDashboardPage() {
  return (
    <PlaceholderPanel
      bullets={[
        'Vista de resumen del alumno pendiente de datos reales.',
        'Supabase y auth real se conectan en RANV2-04.',
        'Reservas y clases reales empiezan en RANV2-06.',
        'Se mantiene navegacion lista para celular, tablet y escritorio.',
      ]}
      description="Punto de entrada del alumno para futuras reservas, membresia, perfil y actividad. En este bloque solo validamos la estructura base del frontend."
      eyebrow="/app"
      title="Dashboard del alumno"
    />
  )
}
