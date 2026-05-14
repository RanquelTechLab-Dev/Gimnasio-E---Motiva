export function formatDate(value: string | null | undefined) {
  if (!value) {
    return 'Sin datos'
  }

  return new Intl.DateTimeFormat('es-AR', {
    dateStyle: 'medium',
  }).format(new Date(value))
}

export function formatDateTime(value: string | null | undefined) {
  if (!value) {
    return 'Sin datos'
  }

  return new Intl.DateTimeFormat('es-AR', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(value))
}

export function formatCurrency(value: number) {
  return new Intl.NumberFormat('es-AR', {
    currency: 'ARS',
    style: 'currency',
  }).format(value)
}
