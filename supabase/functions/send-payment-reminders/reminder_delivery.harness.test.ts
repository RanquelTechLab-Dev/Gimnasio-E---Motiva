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
      ok: true,
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

  it('3. Mailjet success finalizes sent', async () => {
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

  it('4. provider failure finalizes failed', async () => {
    const dependencies = successfulDependencies({
      sendMail: vi.fn().mockResolvedValue({
        ok: false,
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

  it('5. Mailjet exception finalizes failed', async () => {
    const dependencies = successfulDependencies({
      sendMail: vi.fn().mockRejectedValue(new Error('network unavailable')),
    })

    await expect(
      executeReminderDelivery(deliveryRequest(), dependencies),
    ).resolves.toMatchObject({
      state: 'failed',
      error: 'network unavailable',
    })
    expect(dependencies.finalize).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'failed',
        error: 'network unavailable',
      }),
    )
  })

  it('6. finalize rejection is surfaced after a successful send', async () => {
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
    ).rejects.toThrow(/not_pending/)
  })

  it('6a. malformed Mailjet output is finalized as failed', async () => {
    const dependencies = successfulDependencies({
      sendMail: vi.fn().mockResolvedValue(null),
    })

    await expect(
      executeReminderDelivery(deliveryRequest(), dependencies),
    ).resolves.toMatchObject({
      state: 'failed',
      error: 'El adaptador Mailjet devolvio una respuesta invalida.',
    })
    expect(dependencies.finalize).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'failed' }),
    )
  })

  it('7. finalize exception is surfaced after a failed send', async () => {
    const dependencies = successfulDependencies({
      sendMail: vi.fn().mockRejectedValue(new Error('provider timeout')),
      finalize: vi.fn().mockRejectedValue(new Error('finalize unavailable')),
    })

    await expect(
      executeReminderDelivery(deliveryRequest(), dependencies),
    ).rejects.toThrow('finalize unavailable')
  })

  it('8. finalize metadata is forwarded without replacing claim metadata', async () => {
    const dependencies = successfulDependencies()

    await executeReminderDelivery(deliveryRequest(), dependencies)

    expect(dependencies.finalize).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: { delivery_mode: 'controlled_e2e' },
      }),
    )
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
      ok: true,
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

  it('22. converts provider failure into a bounded failed result', async () => {
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
      ok: false,
      error: 'provider rejected message',
    })
  })

  it('22a. keeps an injected fetch exception observable to delivery', async () => {
    const adapter = createMailjetAdapter(
      {
        apiKey: 'api-key-value',
        apiSecret: 'api-secret-value',
        fromEmail: 'from@example.invalid',
        fromName: 'E-Motiva',
      },
      vi.fn().mockRejectedValue(new Error('network unavailable')),
    )

    await expect(adapter(deliveryRequest().message)).rejects.toThrow(
      'network unavailable',
    )
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
