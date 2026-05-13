import { PlaceholderPanel } from '../../components/PlaceholderPanel'

export function AdminPlansPage() {
  return (
    <PlaceholderPanel
      bullets={[
        'Sin planes reales cargados en frontend.',
        'No existe schema Supabase todavia.',
        'La gestion real queda para RANV2-05.',
        'El alcance funcional ya esta documentado.',
      ]}
      description="El panel de planes va a definir membresias y reglas de acceso a clases en bloques siguientes."
      eyebrow="/admin/plans"
      title="Planes y membresias"
    />
  )
}
