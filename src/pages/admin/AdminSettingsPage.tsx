import { PlaceholderPanel } from '../../components/PlaceholderPanel'

export function AdminSettingsPage() {
  return (
    <PlaceholderPanel
      bullets={[
        'Sin configuraciones persistidas.',
        'No hay secrets ni integraciones.',
        'Espacio reservado para configuracion del panel admin.',
        'La configuracion real se incorpora por bloque.',
      ]}
      description="Espacio reservado para configuraciones futuras sin mezclar este bloque con integraciones externas."
      eyebrow="/admin/settings"
      title="Configuracion"
    />
  )
}
