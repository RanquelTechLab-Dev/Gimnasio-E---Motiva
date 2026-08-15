import { describe, expect, it, vi } from 'vitest'
import { createMailjetAdapter } from './mailjet_adapter'
import type { ReminderDeliveryDependencies } from './reminder_delivery'
import type {
  ReminderSelectionResult,
  SelectedReminderCandidate,
} from './reminder_selector'
import {
  executeScheduledProduction,
  runScheduledPreview,
  runScheduledProduction,
  type ScheduledProductionRuntime,
} from './scheduled_worker'

const LOG_ID = '00000000-0000-4000-8000-000000000501'
const EVALUATION_DATE = '2026-03-01'

function selectedCandidate(
  index = 1,
  overrides: Partial<SelectedReminderCandidate> = {},
): SelectedReminderCandidate {
  const membershipId = `10000000-0000-4000-8000-${String(index).padStart(12, '0')}`
  return {
    student_id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    membership_id: membershipId,
    student_first_name: 'Ada',
    student_last_name: `Fixture ${index}`,
    recipient_email: `student-${index}@example.invalid`,
    due_date: '2026-03-06',
    offset_days: 5,
    idempotency_key: `payment_due_reminder:${membershipId}:2026-03-06:5`,
    ...overrides,
  }
}

function selection(
  eligible: SelectedReminderCandidate[] = [selectedCandidate()],
): ReminderSelectionResult {
  return {
    eligible,
    excluded: [
      {
        student_id: 'excluded-student',
        membership_id: 'excluded-membership',
        recipient_email: null,
        due_date: '2026-03-03',
        reason: 'offset_not_scheduled',
      },
    ],
  }
}

function deliveryDependencies(
  overrides: Partial<ReminderDeliveryDependencies> = {},
): ReminderDeliveryDependencies {
  return {
    claim: vi.fn().mockResolvedValue({
      claimed: true,
      log_id: LOG_ID,
      reason: 'claimed',
      attempt: 1,
    }),
    sendMail: vi.fn().mockResolvedValue({
      outcome: 'accepted',
      provider_message_id: 'provider-message-01',
    }),
    finalize: vi.fn().mockImplementation(async (input) => ({
      finalized: true,
      log_id: input.log_id,
      reason: 'finalized',
      final_status: input.status,
    })),
    ...overrides,
  }
}

function productionRuntime(
  overrides: Partial<ScheduledProductionRuntime> = {},
): ScheduledProductionRuntime {
  return {
    now: () => new Date('2026-03-01T15:00:00.000Z'),
    getEnv: (name) =>
      name === 'PAYMENT_REMINDERS_PRODUCTION_ENABLED' ? 'true' : undefined,
    selectCandidates: vi.fn().mockResolvedValue(selection()),
    createDeliveryDependencies: vi.fn().mockReturnValue(
      deliveryDependencies(),
    ),
    ...overrides,
  }
}

function expectNoPii(body: unknown) {
  const serialized = JSON.stringify(body)
  for (const forbidden of [
    '@',
    'recipient_email',
    'email',
    'first_name',
    'last_name',
    'student_id',
    'membership_id',
  ]) {
    expect(serialized).not.toContain(forbidden)
  }
}

describe('RAN-36 B3A scheduled preview', () => {
  it('1. calculates the Cordoba date and returns counts without PII', async () => {
    const selectCandidates = vi.fn().mockResolvedValue(selection())

    const response = await runScheduledPreview({
      now: () => new Date('2026-03-02T02:30:00.000Z'),
      selectCandidates,
    })

    expect(selectCandidates).toHaveBeenCalledWith('2026-03-01')
    expect(response).toEqual({
      status: 200,
      body: {
        evaluation_date: '2026-03-01',
        timezone: 'America/Argentina/Cordoba',
        eligible_count: 1,
        excluded_count: 1,
      },
    })
    expectNoPii(response.body)
  })
})

describe('RAN-36 B3A scheduled production worker', () => {
  it.each([undefined, 'false'])(
    '2. kill-switch %s returns 503 before selection or delivery setup',
    async (productionEnabled) => {
      const selectCandidates = vi.fn()
      const createDeliveryDependencies = vi.fn()
      const runtime = productionRuntime({
        getEnv: () => productionEnabled,
        selectCandidates,
        createDeliveryDependencies,
      })

      await expect(runScheduledProduction(runtime)).resolves.toEqual({
        status: 503,
        body: { error: 'payment_reminders_production_disabled' },
      })
      expect(selectCandidates).not.toHaveBeenCalled()
      expect(createDeliveryDependencies).not.toHaveBeenCalled()
    },
  )

  it('3. accepted delivery finalizes sent with real metadata and subject', async () => {
    const dependencies = deliveryDependencies()

    const response = await executeScheduledProduction(
      [selectedCandidate()],
      EVALUATION_DATE,
      dependencies,
    )

    expect(response.status).toBe(200)
    expect(response.body).toMatchObject({
      selected: 1,
      sent: 1,
      failed: 0,
      skipped: 0,
      uncertain: 0,
      reconciliation_required: 0,
    })
    expect(dependencies.claim).toHaveBeenCalledWith(
      expect.objectContaining({
        student_id: selectedCandidate().student_id,
        recipient_email: selectedCandidate().recipient_email,
        membership_id: selectedCandidate().membership_id,
        due_date: '2026-03-06',
        offset_days: 5,
        synthetic_e2e: false,
      }),
    )
    expect(dependencies.sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: 'E-Motiva — Recordatorio de cuota',
      }),
    )
    expect(dependencies.finalize).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'sent',
        metadata: expect.objectContaining({
          delivery_mode: 'scheduled_production',
          evaluation_date: EVALUATION_DATE,
        }),
      }),
    )
    expect(JSON.stringify(vi.mocked(dependencies.sendMail).mock.calls)).not.toContain(
      '[E-Motiva TEST]',
    )
    expectNoPii(response.body)
  })

  it('4. explicit rejection is failed and the next candidate continues', async () => {
    const dependencies = deliveryDependencies({
      sendMail: vi
        .fn()
        .mockResolvedValueOnce({ outcome: 'rejected', error: 'rejected' })
        .mockResolvedValueOnce({
          outcome: 'accepted',
          provider_message_id: 'provider-message-02',
        }),
    })

    const response = await executeScheduledProduction(
      [selectedCandidate(1), selectedCandidate(2)],
      EVALUATION_DATE,
      dependencies,
    )

    expect(response.status).toBe(200)
    expect(response.body).toMatchObject({ selected: 2, failed: 1, sent: 1 })
    expect(dependencies.sendMail).toHaveBeenCalledTimes(2)
  })

  it('5. a network uncertainty stops before later candidates', async () => {
    const dependencies = deliveryDependencies({
      sendMail: vi.fn().mockRejectedValue(new Error('network timeout')),
    })

    const response = await executeScheduledProduction(
      [selectedCandidate(1), selectedCandidate(2)],
      EVALUATION_DATE,
      dependencies,
    )

    expect(response.status).toBe(503)
    expect(response.body).toMatchObject({
      selected: 2,
      uncertain: 1,
      reconciliation_required: 0,
    })
    expect(dependencies.claim).toHaveBeenCalledTimes(1)
    expect(dependencies.sendMail).toHaveBeenCalledTimes(1)
    expectNoPii(response.body)
  })

  it('6. a bodyless HTTP 500 is uncertain and stops the batch', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 500 }))
    const dependencies = deliveryDependencies({
      sendMail: createMailjetAdapter(
        {
          apiKey: 'api-key-value',
          apiSecret: 'api-secret-value',
          fromEmail: 'from@example.invalid',
          fromName: 'E-Motiva',
        },
        fetchImpl,
      ),
    })

    const response = await executeScheduledProduction(
      [selectedCandidate(1), selectedCandidate(2)],
      EVALUATION_DATE,
      dependencies,
    )

    expect(response.status).toBe(503)
    expect(response.body.uncertain).toBe(1)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(dependencies.claim).toHaveBeenCalledTimes(1)
  })

  it('7. finalize failure requires reconciliation and stops safely', async () => {
    const dependencies = deliveryDependencies({
      finalize: vi.fn().mockResolvedValue({
        finalized: false,
        log_id: LOG_ID,
        reason: 'not_pending',
        final_status: null,
      }),
    })

    const response = await executeScheduledProduction(
      [selectedCandidate(1), selectedCandidate(2)],
      EVALUATION_DATE,
      dependencies,
    )

    expect(response.status).toBe(503)
    expect(response.body).toMatchObject({
      reconciliation_required: 1,
      log_id: LOG_ID,
      desired_status: 'sent',
    })
    expect(dependencies.claim).toHaveBeenCalledTimes(1)
    expect(dependencies.sendMail).toHaveBeenCalledTimes(1)
    expectNoPii(response.body)
  })

  it.each([
    ['already_sent', 'skipped_already_sent'],
    ['in_progress', 'skipped_in_progress'],
    ['uncertain_outcome', 'skipped_uncertain'],
    ['candidate_no_longer_eligible', 'skipped_no_longer_eligible'],
  ] as const)(
    '8. skips %s without Mailjet',
    async (reason, counter) => {
      const dependencies = deliveryDependencies({
        claim: vi.fn().mockResolvedValue({
          claimed: false,
          log_id:
            reason === 'candidate_no_longer_eligible' ? null : LOG_ID,
          reason,
          attempt: 1,
        }),
      })

      const response = await executeScheduledProduction(
        [selectedCandidate()],
        EVALUATION_DATE,
        dependencies,
      )

      expect(response.status).toBe(200)
      expect(response.body).toMatchObject({ skipped: 1, [counter]: 1 })
      expect(dependencies.sendMail).not.toHaveBeenCalled()
      expect(dependencies.finalize).not.toHaveBeenCalled()
    },
  )

  it('9. a failed candidate is not retried inside the same worker run', async () => {
    const dependencies = deliveryDependencies({
      sendMail: vi.fn().mockResolvedValue({
        outcome: 'rejected',
        error: 'explicit rejection',
      }),
    })

    const first = selectedCandidate()
    const duplicate = selectedCandidate(2, {
      membership_id: first.membership_id,
      idempotency_key: first.idempotency_key,
    })
    const response = await executeScheduledProduction(
      [first, duplicate],
      EVALUATION_DATE,
      dependencies,
    )

    expect(response.body.failed).toBe(1)
    expect(response.body).toMatchObject({
      selected: 2,
      skipped: 1,
      skipped_duplicate: 1,
    })
    expect(dependencies.claim).toHaveBeenCalledTimes(1)
    expect(dependencies.sendMail).toHaveBeenCalledTimes(1)
    expect(dependencies.finalize).toHaveBeenCalledTimes(1)
  })

  it('9a. renewal before claim returns no-longer-eligible with zero send or finalize', async () => {
    const selectedBeforeRenewal = selectedCandidate(1, {
      due_date: '2026-03-06',
      offset_days: 5,
    })
    const dependencies = deliveryDependencies({
      claim: vi.fn().mockResolvedValue({
        claimed: false,
        log_id: null,
        reason: 'candidate_no_longer_eligible',
        attempt: 1,
      }),
    })

    const response = await executeScheduledProduction(
      [selectedBeforeRenewal],
      EVALUATION_DATE,
      dependencies,
    )

    expect(response.body).toMatchObject({
      selected: 1,
      skipped: 1,
      skipped_no_longer_eligible: 1,
      sent: 0,
      failed: 0,
    })
    expect(dependencies.claim).toHaveBeenCalledWith(
      expect.objectContaining({ due_date: '2026-03-06' }),
    )
    expect(dependencies.sendMail).not.toHaveBeenCalled()
    expect(dependencies.finalize).not.toHaveBeenCalled()
  })

  it('10. enabled production uses the injected Cordoba clock once', async () => {
    const selectCandidates = vi.fn().mockResolvedValue(selection([]))
    const now = vi.fn().mockReturnValue(
      new Date('2026-03-02T02:30:00.000Z'),
    )
    const runtime = productionRuntime({ now, selectCandidates })

    const response = await runScheduledProduction(runtime)

    expect(response.status).toBe(200)
    expect(response.body.evaluation_date).toBe('2026-03-01')
    expect(selectCandidates).toHaveBeenCalledWith('2026-03-01')
    expect(now).toHaveBeenCalledTimes(1)
    expectNoPii(response.body)
  })
})
