import { PlaceholderPanel } from '../../components/PlaceholderPanel'

export function StudentPlanPage() {
  return (
    <PlaceholderPanel
      bullets={[
        'Plan y membresia del alumno.',
        'Pagos manuales se incorporan en el modulo administrativo.',
        'Datos cargados desde Supabase cuando se habilite la gestion.',
        'Acceso disponible solo con sesion activa.',
      ]}
      description="Mas adelante esta pantalla mostrara vencimientos, plan activo y limites de uso segun la membresia del alumno."
      eyebrow="/app/my-plan"
      title="Mi plan"
    />
  )
}
