import { PlaceholderPanel } from '../../components/PlaceholderPanel'

export function StudentPlanPage() {
  return (
    <PlaceholderPanel
      bullets={[
        'Plan y membresia sin datos reales por ahora.',
        'Pagos manuales quedan para RANV2-05.',
        'No se conecta Supabase en este bloque.',
        'La pantalla existe para validar UX base.',
      ]}
      description="Mas adelante esta pantalla mostrara vencimientos, plan activo y limites de uso segun la membresia del alumno."
      eyebrow="/app/my-plan"
      title="Mi plan"
    />
  )
}
