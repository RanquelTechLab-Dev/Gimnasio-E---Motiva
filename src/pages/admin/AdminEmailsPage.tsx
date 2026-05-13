import { PlaceholderPanel } from '../../components/PlaceholderPanel'

export function AdminEmailsPage() {
  return (
    <PlaceholderPanel
      bullets={[
        'Mailjet no se toca en este bloque.',
        'Opt-in/out queda pendiente.',
        'Emails a miembros con pago reciente se resuelven mas adelante.',
        'Solo base visual.',
      ]}
      description="La futura herramienta de emails queda separada del setup inicial para no mezclar integraciones."
      eyebrow="/admin/emails"
      title="Emails"
    />
  )
}
