import { PlaceholderPanel } from '../../components/PlaceholderPanel'

export function AdminPaymentsPage() {
  return (
    <PlaceholderPanel
      bullets={[
        'Sin pagos online.',
        'No Mercado Pago ni Stripe.',
        'Pagos manuales se incorporan en el panel operativo.',
        'Comprobante por WhatsApp o en persona.',
      ]}
      description="Vista para registrar y aprobar pagos manuales cuando se habilite la gestion operativa."
      eyebrow="/admin/payments"
      title="Pagos manuales"
    />
  )
}
