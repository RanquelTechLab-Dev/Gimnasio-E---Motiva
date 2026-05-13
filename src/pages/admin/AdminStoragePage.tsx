import { PlaceholderPanel } from '../../components/PlaceholderPanel'

export function AdminStoragePage() {
  return (
    <PlaceholderPanel
      bullets={[
        'Google Drive pendiente.',
        'No hay storage externo configurado.',
        'La regla de alerta al 10% queda para bloques posteriores.',
        'No se borra nada automaticamente en este setup.',
      ]}
      description="La estructura de storage queda reservada para la integracion futura con Drive y control de espacio."
      eyebrow="/admin/storage"
      title="Storage y archivos"
    />
  )
}
