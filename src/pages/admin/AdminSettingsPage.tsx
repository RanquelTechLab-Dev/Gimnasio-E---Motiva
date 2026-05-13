import { PlaceholderPanel } from '../../components/PlaceholderPanel'

export function AdminSettingsPage() {
  return (
    <PlaceholderPanel
      bullets={[
        'Sin configuraciones persistidas.',
        'No hay secrets ni integraciones.',
        'Sirve como placeholder del panel admin.',
        'La configuracion real se incorpora por bloque.',
      ]}
      description="Espacio reservado para configuraciones futuras sin mezclar este bloque de setup con backend o integraciones."
      eyebrow="/admin/settings"
      title="Configuracion"
    />
  )
}
