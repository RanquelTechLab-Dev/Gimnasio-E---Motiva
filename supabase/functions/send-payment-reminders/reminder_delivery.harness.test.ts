import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import {
  claimReminderDelivery,
  executeReminderDelivery,
  type ClaimReminderInput,
  type ReminderDeliveryDependencies,
  type ReminderDeliveryRequest,
} from './reminder_delivery'
import {
  createMailjetAdapter,
  readMailjetConfig,
} from './mailjet_adapter'
import {
  CONTROLLED_E2E_MEMBERSHIP_ID,
  PRODUCTION_SEND_BLOCKED_MESSAGE,
  classifyPaymentReminderRequest,
  createReminderRpcDependencies,
  executeControlledE2E,
  getReminderReconciliationRequiredResponse,
} from './controlled_e2e'
import { renderPaymentReminder } from './reminder_template'

const E2E_EMAIL = 'payment-reminder-e2e@example.invalid'
const LOG_ID = '00000000-0000-4000-8000-000000000137'
const IDEMPOTENCY_KEY =
  'payment_due_reminder:00000000-0000-4000-8000-000000000036:2036-01-06:5'

function claimInput(
  overrides: Partial<ClaimReminderInput> = {},
): ClaimReminderInput {
  return {
    student_id: null,
    recipient_email: E2E_EMAIL,
    subject: '[E-Motiva TEST] Recordatorio de cuota',
    idempotency_key: IDEMPOTENCY_KEY,
    membership_id: CONTROLLED_E2E_MEMBERSHIP_ID,
    due_date: '2036-01-06',
    offset_days: 5,
    synthetic_e2e: true,
    ...overrides,
  }
}

function deliveryRequest(): ReminderDeliveryRequest {
  return {
    claim: claimInput(),
    message: {
      toEmail: E2E_EMAIL,
      toName: 'Fixture E2E',
      subject: '[E-Motiva TEST] Recordatorio de cuota',
      textPart: 'Tu cuota vence en 5 días',
      htmlPart: '<p>Tu cuota vence en 5 días</p>',
    },
    finalizeMetadata: {
      delivery_mode: 'controlled_e2e',
    },
  }
}

function successfulDependencies(
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
      provider_message_id: 'mailjet-message-01',
    }),
    finalize: vi.fn().mockImplementation(async (input) => ({
      finalized: true,
      log_id: LOG_ID,
      reason: 'finalized',
      final_status: input.status,
    })),
    ...overrides,
  }
}

describe('RAN-36 B2A delivery orchestration', () => {
  it('1. a skipped claim never calls Mailjet or finalize', async () => {
    const dependencies = successfulDependencies({
      claim: vi.fn().mockResolvedValue({
        claimed: false,
        log_id: LOG_ID,
        reason: 'already_sent',
        attempt: 1,
      }),
    })

    await expect(
      executeReminderDelivery(deliveryRequest(), dependencies),
    ).resolves.toMatchObject({ state: 'skipped', reason: 'already_sent' })
    expect(dependencies.sendMail).not.toHaveBeenCalled()
    expect(dependencies.finalize).not.toHaveBeenCalled()
  })

  it('2. exposes the claimed state before delivery', async () => {
    const claim = vi.fn().mockResolvedValue({
      claimed: true,
      log_id: LOG_ID,
      reason: 'claimed',
      attempt: 1,
    })

    await expect(
      claimReminderDelivery(claimInput(), claim),
    ).resolves.toEqual({
      state: 'claimed',
      log_id: LOG_ID,
      attempt: 1,
    })
  })

  it('3. an accepted Mailjet result finalizes sent', async () => {
    const dependencies = successfulDependencies()

    await expect(
      executeReminderDelivery(deliveryRequest(), dependencies),
    ).resolves.toMatchObject({
      state: 'sent',
      log_id: LOG_ID,
      provider_message_id: 'mailjet-message-01',
    })
    expect(dependencies.finalize).toHaveBeenCalledWith(
      expect.objectContaining({
        log_id: LOG_ID,
        idempotency_key: IDEMPOTENCY_KEY,
        status: 'sent',
        provider_message_id: 'mailjet-message-01',
        error: null,
      }),
    )
  })

  it('4. an explicit provider rejection finalizes failed', async () => {
    const dependencies = successfulDependencies({
      sendMail: vi.fn().mockResolvedValue({
        outcome: 'rejected',
        error: 'mailjet_provider_failure',
      }),
    })

    await expect(
      executeReminderDelivery(deliveryRequest(), dependencies),
    ).resolves.toMatchObject({
      state: 'failed',
      error: 'mailjet_provider_failure',
    })
    expect(dependencies.finalize).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'failed',
        provider_message_id: null,
        error: 'mailjet_provider_failure',
      }),
    )
  })

  it('A. a transport exception finalizes uncertain, never failed', async () => {
    const dependencies = successfulDependencies({
      sendMail: vi.fn().mockRejectedValue(new Error('network unavailable')),
    })

    await expect(
      executeReminderDelivery(deliveryRequest(), dependencies),
    ).resolves.toMatchObject({
      state: 'uncertain',
      error: 'network unavailable',
    })
    expect(dependencies.finalize).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'uncertain',
        error: 'network unavailable',
        metadata: expect.objectContaining({
          delivery_certainty: 'uncertain',
        }),
      }),
    )
  })

  it('R. finalize rejection after accepted delivery requires reconciliation', async () => {
    const dependencies = successfulDependencies({
      finalize: vi.fn().mockResolvedValue({
        finalized: false,
        log_id: LOG_ID,
        reason: 'not_pending',
        final_status: null,
      }),
    })

    await expect(
      executeReminderDelivery(deliveryRequest(), dependencies),
    ).rejects.toMatchObject({
      name: 'ReminderReconciliationRequiredError',
      code: 'reconciliation_required',
      reconciliation_required: true,
      log_id: LOG_ID,
      idempotency_key: IDEMPOTENCY_KEY,
      desired_status: 'sent',
      provider_message_id: 'mailjet-message-01',
      bounded_error: expect.stringMatching(/not_pending/),
    })
    expect(dependencies.sendMail).toHaveBeenCalledTimes(1)
  })

  it('R2. exposes only a redacted reconciliation response', async () => {
    const dependencies = successfulDependencies({
      finalize: vi
        .fn()
        .mockRejectedValue(
          new Error(
            `Authorization: Basic sensitive-token for ${E2E_EMAIL}`,
          ),
        ),
    })

    const error = await executeReminderDelivery(
      deliveryRequest(),
      dependencies,
    ).catch((caught: unknown) => caught)

    expect(error).toMatchObject({
      name: 'ReminderReconciliationRequiredError',
      bounded_error: expect.not.stringContaining('sensitive-token'),
    })
    expect((error as { bounded_error: string }).bounded_error).not.toContain(
      E2E_EMAIL,
    )
    expect(getReminderReconciliationRequiredResponse(error)).toEqual({
      error: 'reconciliation_required',
      reconciliation_required: true,
      log_id: LOG_ID,
      desired_status: 'sent',
    })
    expect(dependencies.sendMail).toHaveBeenCalledTimes(1)
  })

  it('6a. malformed Mailjet output is finalized as uncertain', async () => {
    const dependencies = successfulDependencies({
      sendMail: vi.fn().mockResolvedValue(null),
    })

    await expect(
      executeReminderDelivery(deliveryRequest(), dependencies),
    ).resolves.toMatchObject({
      state: 'uncertain',
      error: 'El adaptador Mailjet devolvio una respuesta invalida.',
    })
    expect(dependencies.finalize).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'uncertain' }),
    )
  })

  it('T. finalize exception after uncertain delivery is structured', async () => {
    const dependencies = successfulDependencies({
      sendMail: vi.fn().mockRejectedValue(new Error('provider timeout')),
      finalize: vi.fn().mockRejectedValue(new Error('finalize unavailable')),
    })

    await expect(
      executeReminderDelivery(deliveryRequest(), dependencies),
    ).rejects.toMatchObject({
      name: 'ReminderReconciliationRequiredError',
      code: 'reconciliation_required',
      reconciliation_required: true,
      log_id: LOG_ID,
      idempotency_key: IDEMPOTENCY_KEY,
      desired_status: 'uncertain',
      provider_message_id: null,
      bounded_error: expect.stringMatching(/finalize unavailable/),
    })
    expect(dependencies.sendMail).toHaveBeenCalledTimes(1)
  })

  it('8. finalize metadata is forwarded without replacing claim metadata', async () => {
    const dependencies = successfulDependencies()

    await executeReminderDelivery(deliveryRequest(), dependencies)

    expect(dependencies.finalize).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: {
          delivery_mode: 'controlled_e2e',
          delivery_certainty: 'accepted',
        },
      }),
    )
  })

  it('D. an uncertain row skips Mailjet with uncertain_outcome', async () => {
    const dependencies = successfulDependencies({
      claim: vi.fn().mockResolvedValue({
        claimed: false,
        log_id: LOG_ID,
        reason: 'uncertain_outcome',
        attempt: 1,
      }),
    })

    await expect(
      executeReminderDelivery(deliveryRequest(), dependencies),
    ).resolves.toMatchObject({
      state: 'skipped',
      reason: 'uncertain_outcome',
    })
    expect(dependencies.sendMail).not.toHaveBeenCalled()
    expect(dependencies.finalize).not.toHaveBeenCalled()
  })

  it('E. a controlled failed retry can claim attempt two', async () => {
    const dependencies = successfulDependencies({
      claim: vi.fn().mockResolvedValue({
        claimed: true,
        log_id: LOG_ID,
        reason: 'retry_claimed',
        attempt: 2,
      }),
    })

    await expect(
      executeReminderDelivery(deliveryRequest(), dependencies),
    ).resolves.toMatchObject({
      state: 'sent',
      attempt: 2,
    })
    expect(dependencies.sendMail).toHaveBeenCalledTimes(1)
  })

  it('F. a sent row remains terminal and never calls Mailjet', async () => {
    const dependencies = successfulDependencies({
      claim: vi.fn().mockResolvedValue({
        claimed: false,
        log_id: LOG_ID,
        reason: 'already_sent',
        attempt: 1,
      }),
    })

    await expect(
      executeReminderDelivery(deliveryRequest(), dependencies),
    ).resolves.toMatchObject({ state: 'skipped', reason: 'already_sent' })
    expect(dependencies.sendMail).not.toHaveBeenCalled()
  })

  it('G. a pending row remains in progress and never calls Mailjet', async () => {
    const dependencies = successfulDependencies({
      claim: vi.fn().mockResolvedValue({
        claimed: false,
        log_id: LOG_ID,
        reason: 'in_progress',
        attempt: 1,
      }),
    })

    await expect(
      executeReminderDelivery(deliveryRequest(), dependencies),
    ).resolves.toMatchObject({ state: 'skipped', reason: 'in_progress' })
    expect(dependencies.sendMail).not.toHaveBeenCalled()
  })

  it('H. an uncertain provider outcome finalizes uncertain', async () => {
    const dependencies = successfulDependencies({
      sendMail: vi.fn().mockResolvedValue({
        outcome: 'uncertain',
        error: 'provider response was ambiguous',
      }),
    })

    await expect(
      executeReminderDelivery(deliveryRequest(), dependencies),
    ).resolves.toMatchObject({
      state: 'uncertain',
      error: 'provider response was ambiguous',
    })
    expect(dependencies.finalize).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'uncertain',
        provider_message_id: null,
        error: 'provider response was ambiguous',
        metadata: {
          delivery_mode: 'controlled_e2e',
          delivery_certainty: 'uncertain',
        },
      }),
    )
  })

  it('S. finalize failure after rejection requires reconciliation', async () => {
    const dependencies = successfulDependencies({
      sendMail: vi.fn().mockResolvedValue({
        outcome: 'rejected',
        error: 'provider rejected message',
      }),
      finalize: vi.fn().mockRejectedValue(new Error('finalize unavailable')),
    })

    await expect(
      executeReminderDelivery(deliveryRequest(), dependencies),
    ).rejects.toMatchObject({
      name: 'ReminderReconciliationRequiredError',
      code: 'reconciliation_required',
      reconciliation_required: true,
      log_id: LOG_ID,
      idempotency_key: IDEMPOTENCY_KEY,
      desired_status: 'failed',
      provider_message_id: null,
      bounded_error: expect.stringMatching(/finalize unavailable/),
    })
    expect(dependencies.sendMail).toHaveBeenCalledTimes(1)
  })

  it('U. a second execution left pending never resends Mailjet', async () => {
    const claim = vi
      .fn()
      .mockResolvedValueOnce({
        claimed: true,
        log_id: LOG_ID,
        reason: 'claimed',
        attempt: 1,
      })
      .mockResolvedValueOnce({
        claimed: false,
        log_id: LOG_ID,
        reason: 'in_progress',
        attempt: 1,
      })
    const dependencies = successfulDependencies({
      claim,
      finalize: vi.fn().mockRejectedValue(new Error('finalize unavailable')),
    })

    await expect(
      executeReminderDelivery(deliveryRequest(), dependencies),
    ).rejects.toMatchObject({
      name: 'ReminderReconciliationRequiredError',
      desired_status: 'sent',
    })
    await expect(
      executeReminderDelivery(deliveryRequest(), dependencies),
    ).resolves.toMatchObject({ state: 'skipped', reason: 'in_progress' })
    expect(dependencies.sendMail).toHaveBeenCalledTimes(1)
  })

  it('V. a second execution left uncertain never resends Mailjet', async () => {
    const claim = vi
      .fn()
      .mockResolvedValueOnce({
        claimed: true,
        log_id: LOG_ID,
        reason: 'claimed',
        attempt: 1,
      })
      .mockResolvedValueOnce({
        claimed: false,
        log_id: LOG_ID,
        reason: 'uncertain_outcome',
        attempt: 1,
      })
    const dependencies = successfulDependencies({
      claim,
      sendMail: vi.fn().mockResolvedValue({
        outcome: 'uncertain',
        error: 'provider response was ambiguous',
      }),
    })

    await expect(
      executeReminderDelivery(deliveryRequest(), dependencies),
    ).resolves.toMatchObject({ state: 'uncertain' })
    await expect(
      executeReminderDelivery(deliveryRequest(), dependencies),
    ).resolves.toMatchObject({
      state: 'skipped',
      reason: 'uncertain_outcome',
    })
    expect(dependencies.sendMail).toHaveBeenCalledTimes(1)
  })
})

describe('RAN-36 B2A controlled E2E boundary', () => {
  it('9. classifies dry-run without invoking delivery dependencies', () => {
    expect(
      classifyPaymentReminderRequest({
        dryRun: true,
        evaluationDate: '2026-03-01',
      }),
    ).toEqual({ kind: 'dry_run' })
  })

  it('9a. dry-run cannot call claim', async () => {
    const dependencies = successfulDependencies()
    await expect(
      executeControlledE2E(
        { dryRun: true },
        { ...dependencies, getEnv: () => E2E_EMAIL },
      ),
    ).rejects.toThrow(/controlled_e2e/)
    expect(dependencies.claim).not.toHaveBeenCalled()
  })

  it('9b. dry-run cannot call Mailjet', async () => {
    const dependencies = successfulDependencies()
    await expect(
      executeControlledE2E(
        { dryRun: true },
        { ...dependencies, getEnv: () => E2E_EMAIL },
      ),
    ).rejects.toThrow(/controlled_e2e/)
    expect(dependencies.sendMail).not.toHaveBeenCalled()
  })

  it('9c. dry-run cannot finalize', async () => {
    const dependencies = successfulDependencies()
    await expect(
      executeControlledE2E(
        { dryRun: true },
        { ...dependencies, getEnv: () => E2E_EMAIL },
      ),
    ).rejects.toThrow(/controlled_e2e/)
    expect(dependencies.finalize).not.toHaveBeenCalled()
  })

  it('10. blocks non-controlled production delivery', () => {
    expect(() =>
      classifyPaymentReminderRequest({ dryRun: false }),
    ).toThrow(PRODUCTION_SEND_BLOCKED_MESSAGE)
  })

  it('11. rejects an arbitrary recipient_email from the request', () => {
    expect(() =>
      classifyPaymentReminderRequest({
        dryRun: false,
        mode: 'controlled_e2e',
        fixture: { offset_days: 5 },
        recipient_email: 'attacker@example.com',
      }),
    ).toThrow(/no permitidos/i)
  })

  it.each(['email', 'to', 'student_id', 'membership_id'])(
    '12. rejects forbidden request field %s',
    (field) => {
      expect(() =>
        classifyPaymentReminderRequest({
          dryRun: false,
          mode: 'controlled_e2e',
          fixture: { offset_days: 5 },
          [field]: 'untrusted-value',
        }),
      ).toThrow(/no permitidos/i)
    },
  )

  it('13. rejects a controlled fixture with an unsupported offset', () => {
    expect(() =>
      classifyPaymentReminderRequest({
        dryRun: false,
        mode: 'controlled_e2e',
        fixture: { offset_days: 2 },
      }),
    ).toThrow(/offset_days/i)
  })

  it('14. fails closed before claim when the destination secret is absent', async () => {
    const dependencies = successfulDependencies()

    await expect(
      executeControlledE2E(
        {
          dryRun: false,
          mode: 'controlled_e2e',
          fixture: { offset_days: 5 },
        },
        {
          ...dependencies,
          getEnv: () => undefined,
        },
      ),
    ).rejects.toThrow(/PAYMENT_REMINDER_E2E_EMAIL/)
    expect(dependencies.claim).not.toHaveBeenCalled()
  })

  it('15. uses only the secret email, null student and the fixed synthetic membership', async () => {
    const dependencies = successfulDependencies()

    await executeControlledE2E(
      {
        dryRun: false,
        mode: 'controlled_e2e',
        fixture: { offset_days: 5 },
      },
      {
        ...dependencies,
        getEnv: (name) =>
          name === 'PAYMENT_REMINDER_E2E_EMAIL' ? E2E_EMAIL : undefined,
      },
    )

    expect(dependencies.claim).toHaveBeenCalledWith(
      expect.objectContaining({
        student_id: null,
        recipient_email: E2E_EMAIL,
        membership_id: CONTROLLED_E2E_MEMBERSHIP_ID,
        due_date: '2036-01-06',
        offset_days: 5,
        synthetic_e2e: true,
        idempotency_key: IDEMPOTENCY_KEY,
      }),
    )
    expect(dependencies.sendMail).toHaveBeenCalledWith(
      expect.objectContaining({ toEmail: E2E_EMAIL }),
    )
  })

  it('16. a second execution of the same fixture skips Mailjet', async () => {
    let claimedOnce = false
    const claim = vi.fn().mockImplementation(async () => {
      if (!claimedOnce) {
        claimedOnce = true
        return {
          claimed: true,
          log_id: LOG_ID,
          reason: 'claimed',
          attempt: 1,
        }
      }

      return {
        claimed: false,
        log_id: LOG_ID,
        reason: 'already_sent',
        attempt: 1,
      }
    })
    const dependencies = successfulDependencies({ claim })
    const controlledDependencies = {
      ...dependencies,
      getEnv: (name: string) =>
        name === 'PAYMENT_REMINDER_E2E_EMAIL' ? E2E_EMAIL : undefined,
    }
    const payload = {
      dryRun: false as const,
      mode: 'controlled_e2e' as const,
      fixture: { offset_days: 5 as const },
    }

    await expect(
      executeControlledE2E(payload, controlledDependencies),
    ).resolves.toMatchObject({ state: 'sent' })
    await expect(
      executeControlledE2E(payload, controlledDependencies),
    ).resolves.toMatchObject({ state: 'skipped', reason: 'already_sent' })
    expect(dependencies.sendMail).toHaveBeenCalledTimes(1)
  })
})

describe('RAN-36 B2A deterministic template and Mailjet adapter', () => {
  it.each([
    [5, 'Tu cuota vence en 5 días'],
    [3, 'Tu cuota vence en 3 días'],
    [1, 'Tu cuota vence mañana'],
    [0, 'Tu cuota vence hoy'],
  ] as const)('17. renders offset %i deterministically', (offset, phrase) => {
    const rendered = renderPaymentReminder({
      studentName: 'Fixture Alpha',
      dueDate: '2026-03-06',
      offsetDays: offset,
      syntheticE2E: false,
    })

    expect(rendered.subject).toBe('E-Motiva — Recordatorio de cuota')
    expect(rendered.textPart).toContain(phrase)
    expect(rendered.textPart).toContain('Fixture Alpha')
    expect(rendered.textPart).toContain('2026-03-06')
  })

  it('18. uses the controlled E2E subject', () => {
    expect(
      renderPaymentReminder({
        studentName: 'Fixture E2E',
        dueDate: '2026-03-06',
        offsetDays: 5,
        syntheticE2E: true,
      }).subject,
    ).toBe('[E-Motiva TEST] Recordatorio de cuota')
  })

  it('19. escapes interpolated HTML without escaping TextPart', () => {
    const rendered = renderPaymentReminder({
      studentName: '<Admin & "Fixture">',
      dueDate: '2026-03-06',
      offsetDays: 1,
      syntheticE2E: true,
    })

    expect(rendered.htmlPart).toContain(
      '&lt;Admin &amp; &quot;Fixture&quot;&gt;',
    )
    expect(rendered.htmlPart).not.toContain('<Admin')
    expect(rendered.textPart).toContain('<Admin & "Fixture">')
  })

  it('20. reads the four Mailjet secrets without exposing their values', () => {
    const config = readMailjetConfig((name) =>
      ({
        MAILJET_API_KEY: 'api-key-value',
        MAILJET_API_SECRET: 'api-secret-value',
        MAILJET_FROM_EMAIL: 'from@example.invalid',
        MAILJET_FROM_NAME: 'E-Motiva Test',
      })[name],
    )

    expect(config).toEqual({
      apiKey: 'api-key-value',
      apiSecret: 'api-secret-value',
      fromEmail: 'from@example.invalid',
      fromName: 'E-Motiva Test',
    })
  })

  it('21. sends the expected TextPart and escaped HTMLPart through injected fetch', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          Messages: [
            {
              Status: 'success',
              To: [{ MessageID: 12345 }],
            },
          ],
        }),
        { status: 200 },
      ),
    )
    const adapter = createMailjetAdapter(
      {
        apiKey: 'api-key-value',
        apiSecret: 'api-secret-value',
        fromEmail: 'from@example.invalid',
        fromName: 'E-Motiva',
      },
      fetchImpl,
    )
    const rendered = renderPaymentReminder({
      studentName: '<Fixture>',
      dueDate: '2026-03-06',
      offsetDays: 5,
      syntheticE2E: true,
    })

    await expect(
      adapter({
        toEmail: E2E_EMAIL,
        toName: 'Fixture E2E',
        subject: rendered.subject,
        textPart: rendered.textPart,
        htmlPart: rendered.htmlPart,
      }),
    ).resolves.toEqual({
      outcome: 'accepted',
      provider_message_id: '12345',
    })

    const request = fetchImpl.mock.calls[0]?.[1] as RequestInit
    const body = JSON.parse(String(request.body))
    expect(body.Messages[0]).toMatchObject({
      Subject: '[E-Motiva TEST] Recordatorio de cuota',
      TextPart: expect.stringContaining('<Fixture>'),
      HTMLPart: expect.stringContaining('&lt;Fixture&gt;'),
    })
  })

  it('C. converts an explicit provider rejection into rejected', async () => {
    const adapter = createMailjetAdapter(
      {
        apiKey: 'api-key-value',
        apiSecret: 'api-secret-value',
        fromEmail: 'from@example.invalid',
        fromName: 'E-Motiva',
      },
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            Messages: [
              {
                Status: 'error',
                Errors: [{ ErrorMessage: 'provider rejected message' }],
              },
            ],
          }),
          { status: 400 },
        ),
      ),
    )

    await expect(adapter(deliveryRequest().message)).resolves.toEqual({
      outcome: 'rejected',
      error: 'provider rejected message',
    })
  })

  it('A2. converts an injected fetch exception into uncertain', async () => {
    const adapter = createMailjetAdapter(
      {
        apiKey: 'api-key-value',
        apiSecret: 'api-secret-value',
        fromEmail: 'from@example.invalid',
        fromName: 'E-Motiva',
      },
      vi.fn().mockRejectedValue(new Error('network unavailable')),
    )

    await expect(adapter(deliveryRequest().message)).resolves.toEqual({
      outcome: 'uncertain',
      error: 'network unavailable',
    })
  })

  it('B. converts an ambiguous HTTP 200 body into uncertain', async () => {
    const adapter = createMailjetAdapter(
      {
        apiKey: 'api-key-value',
        apiSecret: 'api-secret-value',
        fromEmail: 'from@example.invalid',
        fromName: 'E-Motiva',
      },
      vi.fn().mockResolvedValue(
        new Response('{"Messages":[]}', {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    )

    await expect(adapter(deliveryRequest().message)).resolves.toEqual({
      outcome: 'uncertain',
      error: expect.any(String),
    })
  })

  it('22b. surfaces bounded PostgREST error messages', async () => {
    const dependencies = createReminderRpcDependencies(
      {
        rpc: vi.fn().mockResolvedValue({
          data: null,
          error: { message: 'claim RPC unavailable', code: 'PGRST500' },
        }),
      },
      vi.fn(),
    )

    await expect(dependencies.claim(claimInput())).rejects.toThrow(
      'claim RPC unavailable',
    )
  })

  const indexSource = readFileSync(
    new URL('./index.ts', import.meta.url),
    'utf8',
  )

  it('23. keeps the production-blocking route in the real Edge Function', () => {
    expect(indexSource).toContain('classifyPaymentReminderRequest(rawPayload)')
    expect(indexSource).toContain('PRODUCTION_SEND_BLOCKED_MESSAGE')
  })
})
