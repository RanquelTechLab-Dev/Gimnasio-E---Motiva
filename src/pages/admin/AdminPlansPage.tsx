import { PlaceholderPanel } from '../../components/PlaceholderPanel'

export function AdminPlansPage() {
  return (
    <PlaceholderPanel
      bullets={[
        'Planes del gimnasio.',
        'Actividades permitidas por plan.',
        'Gestion operativa desde administracion.',
        'Alcance funcional documentado.',
      ]}
      description="El panel de planes va a definir membresias y reglas de acceso a clases en bloques siguientes."
      eyebrow="/admin/plans"
      title="Planes y membresias"
    />
  )
}
