import {
  executeReminderDelivery,
  ReminderReconciliationRequiredError,
  type ReminderDeliveryDependencies,
} from './reminder_delivery.ts'
import {
  getDateInTimeZone,
  PAYMENT_REMINDER_TIME_ZONE,
} from './reminder_logic.ts'
import type {
  ReminderSelectionResult,
  SelectedReminderCandidate,
} from './reminder_selector.ts'
import { renderPaymentReminder } from './reminder_template.ts'

const PRODUCTION_ENABLED_ENV = 'PAYMENT_REMINDERS_PRODUCTION_ENABLED'

export type ScheduledSelector = (
  evaluationDate: string,
) => Promise<ReminderSelectionResult>

export type ScheduledPreviewRuntime = {
  now: () => Date
  selectCandidates: ScheduledSelector
}

export type ScheduledProductionRuntime = ScheduledPreviewRuntime & {
  getEnv: (name: string) => string | undefined
  createDeliveryDependencies: () => ReminderDeliveryDependencies
}

type ScheduledSummary = {
  evaluation_date: string
  timezone: typeof PAYMENT_REMINDER_TIME_ZONE
  selected: number
  sent: number
  failed: number
  skipped: number
  skipped_already_sent: number
  skipped_in_progress: number
  skipped_uncertain: number
  skipped_no_longer_eligible: number
  skipped_duplicate: number
  uncertain: number
  reconciliation_required: number
}

function initialSummary(
  evaluationDate: string,
  selected: number,
): ScheduledSummary {
  return {
    evaluation_date: evaluationDate,
    timezone: PAYMENT_REMINDER_TIME_ZONE,
    selected,
    sent: 0,
    failed: 0,
    skipped: 0,
    skipped_already_sent: 0,
    skipped_in_progress: 0,
    skipped_uncertain: 0,
    skipped_no_longer_eligible: 0,
    skipped_duplicate: 0,
    uncertain: 0,
    reconciliation_required: 0,
  }
}

function fullStudentName(candidate: SelectedReminderCandidate) {
  return [candidate.student_first_name, candidate.student_last_name]
    .map((part) => part.trim())
    .filter(Boolean)
    .join(' ') || 'Alumno/a'
}

function incrementSkippedReason(summary: ScheduledSummary, reason: string) {
  summary.skipped += 1

  if (reason === 'already_sent') {
    summary.skipped_already_sent += 1
    return true
  }
  if (reason === 'in_progress') {
    summary.skipped_in_progress += 1
    return true
  }
  if (reason === 'uncertain_outcome') {
    summary.skipped_uncertain += 1
    return true
  }
  if (reason === 'candidate_no_longer_eligible') {
    summary.skipped_no_longer_eligible += 1
    return true
  }

  return false
}

export async function runScheduledPreview(
  runtime: ScheduledPreviewRuntime,
) {
  const evaluationDate = getDateInTimeZone(
    runtime.now(),
    PAYMENT_REMINDER_TIME_ZONE,
  )
  const candidates = await runtime.selectCandidates(evaluationDate)

  return {
    status: 200,
    body: {
      evaluation_date: evaluationDate,
      timezone: PAYMENT_REMINDER_TIME_ZONE,
      eligible_count: candidates.eligible.length,
      excluded_count: candidates.excluded.length,
    },
  }
}

export async function executeScheduledProduction(
  candidates: SelectedReminderCandidate[],
  evaluationDate: string,
  dependencies: ReminderDeliveryDependencies,
) {
  const summary = initialSummary(evaluationDate, candidates.length)
  const processedKeys = new Set<string>()

  for (const candidate of candidates) {
    if (processedKeys.has(candidate.idempotency_key)) {
      summary.skipped += 1
      summary.skipped_duplicate += 1
      continue
    }
    processedKeys.add(candidate.idempotency_key)

    const rendered = renderPaymentReminder({
      studentName: fullStudentName(candidate),
      dueDate: candidate.due_date,
      offsetDays: candidate.offset_days,
      syntheticE2E: false,
    })

    try {
      const result = await executeReminderDelivery(
        {
          claim: {
            student_id: candidate.student_id,
            recipient_email: candidate.recipient_email,
            subject: rendered.subject,
            idempotency_key: candidate.idempotency_key,
            membership_id: candidate.membership_id,
            due_date: candidate.due_date,
            offset_days: candidate.offset_days,
            synthetic_e2e: false,
          },
          message: {
            toEmail: candidate.recipient_email,
            toName: fullStudentName(candidate),
            subject: rendered.subject,
            textPart: rendered.textPart,
            htmlPart: rendered.htmlPart,
          },
          finalizeMetadata: {
            delivery_mode: 'scheduled_production',
            evaluation_date: evaluationDate,
          },
        },
        dependencies,
      )

      if (result.state === 'sent') {
        summary.sent += 1
        continue
      }

      if (result.state === 'failed') {
        summary.failed += 1
        continue
      }

      if (result.state === 'uncertain') {
        summary.uncertain += 1
        return {
          status: 503,
          body: {
            error: 'uncertain_delivery_outcome',
            ...summary,
          },
        }
      }

      if (!incrementSkippedReason(summary, result.reason)) {
        return {
          status: 503,
          body: {
            error: 'payment_reminder_batch_failed',
            ...summary,
          },
        }
      }
    } catch (error) {
      if (error instanceof ReminderReconciliationRequiredError) {
        summary.reconciliation_required += 1
        return {
          status: 503,
          body: {
            error: 'reconciliation_required',
            ...summary,
            log_id: error.log_id,
            desired_status: error.desired_status,
          },
        }
      }

      throw error
    }
  }

  return { status: 200, body: summary }
}

export async function runScheduledProduction(
  runtime: ScheduledProductionRuntime,
) {
  if (runtime.getEnv(PRODUCTION_ENABLED_ENV) !== 'true') {
    return {
      status: 503,
      body: { error: 'payment_reminders_production_disabled' },
    }
  }

  const evaluationDate = getDateInTimeZone(
    runtime.now(),
    PAYMENT_REMINDER_TIME_ZONE,
  )
  const candidates = await runtime.selectCandidates(evaluationDate)
  const dependencies = runtime.createDeliveryDependencies()

  return executeScheduledProduction(
    candidates.eligible,
    evaluationDate,
    dependencies,
  )
}
