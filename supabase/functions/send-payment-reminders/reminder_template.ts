import type { ReminderOffset } from './reminder_logic.ts'

export const PAYMENT_REMINDER_SUBJECT =
  'E-Motiva — Recordatorio de cuota'
export const PAYMENT_REMINDER_E2E_SUBJECT =
  '[E-Motiva TEST] Recordatorio de cuota'

const REMINDER_PHRASES: Record<ReminderOffset, string> = {
  5: 'Tu cuota vence en 5 días',
  3: 'Tu cuota vence en 3 días',
  1: 'Tu cuota vence mañana',
  0: 'Tu cuota vence hoy',
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

export function renderPaymentReminder(input: {
  studentName: string
  dueDate: string
  offsetDays: ReminderOffset
  syntheticE2E: boolean
}) {
  const studentName = input.studentName.trim() || 'Alumno/a'
  const phrase = REMINDER_PHRASES[input.offsetDays]
  const subject = input.syntheticE2E
    ? PAYMENT_REMINDER_E2E_SUBJECT
    : PAYMENT_REMINDER_SUBJECT
  const textPart = [
    `Hola ${studentName},`,
    '',
    `${phrase}.`,
    `Fecha de vencimiento: ${input.dueDate}.`,
    '',
    'E-Motiva',
  ].join('\n')
  const htmlPart = [
    `<p>Hola ${escapeHtml(studentName)},</p>`,
    `<p>${escapeHtml(phrase)}.</p>`,
    `<p>Fecha de vencimiento: ${escapeHtml(input.dueDate)}.</p>`,
    '<p>E-Motiva</p>',
  ].join('')

  return { subject, textPart, htmlPart }
}
