import { PlaceholderPanel } from '../../components/PlaceholderPanel'

export function AdminPaymentsPage() {
  return (
    <PlaceholderPanel
      bullets={[
        'Sin pagos online.',
        'No Mercado Pago ni Stripe.',
        'Pagos manuales quedan para RANV2-05.',
        'Comprobante por WhatsApp o en persona en bloques futuros.',
      ]}
      description="Vista base para registrar y aprobar pagos manuales cuando exista backend real."
      eyebrow="/admin/payments"
      title="Pagos manuales"
    />
  )
}
