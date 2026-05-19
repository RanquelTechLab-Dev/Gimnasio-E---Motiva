import { PlaceholderPanel } from '../../components/PlaceholderPanel'

export function AdminSettingsPage() {
  return (
    <PlaceholderPanel
      bullets={[
        'Preferencias generales del panel.',
        'Accesos y reglas operativas se gestionan de forma segura.',
        'La configuracion avanzada se habilita cuando sea necesaria.',
        'Los cambios sensibles se incorporan con revision previa.',
      ]}
      description="Seccion preparada para futuras preferencias del gimnasio sin mezclar operaciones diarias."
      eyebrow="Configuración"
      title="Configuracion"
    />
  )
}
