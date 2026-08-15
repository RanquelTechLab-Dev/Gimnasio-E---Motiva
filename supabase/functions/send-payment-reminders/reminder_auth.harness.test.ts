import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import { classifyPaymentReminderRequest } from './controlled_e2e'
import {
  authorizePaymentReminderMode,
  PaymentReminderAuthError,
  verifyCronSecret,
  type PaymentReminderAuthDependencies,
} from './reminder_auth'
import {
  handleClassifiedPaymentReminderRequest,
  type PaymentReminderHandlerDependencies,
} from './reminder_request_handler'
import { runScheduledProduction } from './scheduled_worker'

const ADMIN_ID = '00000000-0000-4000-8000-000000000001'
const VALID_CRON_SECRET = 'a'.repeat(32)
const functionDirectory = dirname(fileURLToPath(import.meta.url))
const indexSource = readFileSync(resolve(functionDirectory, 'index.ts'), 'utf8')
const requestHandlerSource = readFileSync(
  resolve(functionDirectory, 'reminder_request_handler.ts'),
  'utf8',
)
const configSource = readFileSync(
  resolve(functionDirectory, '../../config.toml'),
  'utf8',
)

function authDependencies(
  overrides: Partial<PaymentReminderAuthDependencies> = {},
): PaymentReminderAuthDependencies {
  return {
    getEnv: (name) =>
      name === 'PAYMENT_REMINDER_CRON_SECRET'
        ? VALID_CRON_SECRET
        : undefined,
    getUser: vi.fn().mockResolvedValue({ id: ADMIN_ID }),
    getProfile: vi.fn().mockResolvedValue({ role: 'admin', active: true }),
    ...overrides,
  }
}

function requestHeaders(input: {
  authorization?: string
  cronSecret?: string
} = {}) {
  return {
    authorization: input.authorization ?? null,
    cronSecret: input.cronSecret ?? null,
  }
}

function handlerDependencies(
  auth: PaymentReminderAuthDependencies = authDependencies(),
): PaymentReminderHandlerDependencies {
  return {
    auth,
    executeDryRun: vi.fn().mockResolvedValue({
      status: 200,
      body: { route: 'dry_run' },
    }),
    executeControlledE2E: vi.fn().mockResolvedValue({
      status: 200,
      body: { route: 'controlled_e2e' },
    }),
    executeScheduledPreview: vi.fn().mockResolvedValue({
      status: 200,
      body: { route: 'scheduled_preview' },
    }),
    executeScheduledProduction: vi.fn().mockResolvedValue({
      status: 200,
      body: { route: 'scheduled_production' },
    }),
  }
}

describe('RAN-36 B3A request classification', () => {
  it('1. classifies scheduled_preview before generic dry-run', () => {
    expect(
      classifyPaymentReminderRequest({
        dryRun: true,
        mode: 'scheduled_preview',
      }),
    ).toEqual({
      kind: 'scheduled_preview',
      value: { dryRun: true, mode: 'scheduled_preview' },
    })
  })

  it('2. classifies scheduled_production as a service mode', () => {
    expect(
      classifyPaymentReminderRequest({
        dryRun: false,
        mode: 'scheduled_production',
      }),
    ).toEqual({
      kind: 'scheduled_production',
      value: { dryRun: false, mode: 'scheduled_production' },
    })
  })

  it.each([
    'evaluationDate',
    'recipient_email',
    'email',
    'to',
    'student_id',
    'membership_id',
    'due_date',
    'offset_days',
    'fixture',
  ])('3. rejects scheduled_preview field %s', (field) => {
    expect(() =>
      classifyPaymentReminderRequest({
        dryRun: true,
        mode: 'scheduled_preview',
        [field]: field === 'fixture' ? { offset_days: 5 } : 'forbidden',
      }),
    ).toThrow('scheduled_request_invalid')
  })

  it.each([
    'evaluationDate',
    'recipient_email',
    'email',
    'to',
    'student_id',
    'membership_id',
    'due_date',
    'offset_days',
    'fixture',
  ])('4. rejects scheduled_production field %s', (field) => {
    expect(() =>
      classifyPaymentReminderRequest({
        dryRun: false,
        mode: 'scheduled_production',
        [field]: field === 'fixture' ? { offset_days: 5 } : 'forbidden',
      }),
    ).toThrow('scheduled_request_invalid')
  })

  it('4a. never reflects a forbidden scheduled field name or value', () => {
    const attackerField = 'student@example.invalid'
    const error = (() => {
      try {
        classifyPaymentReminderRequest({
          dryRun: true,
          mode: 'scheduled_preview',
          [attackerField]: 'recipient@example.invalid',
        })
      } catch (caught) {
        return caught
      }
      return null
    })()

    expect(error).toMatchObject({
      status: 400,
      message: 'scheduled_request_invalid',
    })
    expect(JSON.stringify(error)).not.toContain('@')
    expect(JSON.stringify(error)).not.toContain('email')
  })

  it.each(['controlled_e2e', 'unknown_mode'])(
    '4b. rejects mismatched admin dry-run mode %s',
    (mode) => {
      expect(() =>
        classifyPaymentReminderRequest({
          dryRun: true,
          mode,
          fixture: { offset_days: 5 },
        }),
      ).toThrow('admin_request_invalid')
    },
  )
})

describe('RAN-36 B3A dual authentication', () => {
  it('5. rejects dryRun without a user JWT', async () => {
    const mode = classifyPaymentReminderRequest({ dryRun: true })

    await expect(
      authorizePaymentReminderMode(mode, requestHeaders(), authDependencies()),
    ).rejects.toMatchObject({ status: 401, code: 'admin_auth_required' })
  })

  it('6. rejects dryRun for a non-admin user', async () => {
    const mode = classifyPaymentReminderRequest({ dryRun: true })
    const dependencies = authDependencies({
      getProfile: vi.fn().mockResolvedValue({ role: 'student', active: true }),
    })

    await expect(
      authorizePaymentReminderMode(
        mode,
        requestHeaders({ authorization: 'Bearer valid-user-jwt' }),
        dependencies,
      ),
    ).rejects.toMatchObject({ status: 403, code: 'admin_forbidden' })
  })

  it('7. allows dryRun for an active admin', async () => {
    const mode = classifyPaymentReminderRequest({ dryRun: true })

    await expect(
      authorizePaymentReminderMode(
        mode,
        requestHeaders({ authorization: 'Bearer valid-admin-jwt' }),
        authDependencies(),
      ),
    ).resolves.toEqual({ kind: 'admin', user_id: ADMIN_ID })
  })

  it('8. rejects controlled_e2e without a user JWT', async () => {
    const mode = classifyPaymentReminderRequest({
      dryRun: false,
      mode: 'controlled_e2e',
      fixture: { offset_days: 5 },
    })

    await expect(
      authorizePaymentReminderMode(mode, requestHeaders(), authDependencies()),
    ).rejects.toMatchObject({ status: 401, code: 'admin_auth_required' })
  })

  it('9. rejects controlled_e2e for a non-admin user', async () => {
    const mode = classifyPaymentReminderRequest({
      dryRun: false,
      mode: 'controlled_e2e',
      fixture: { offset_days: 5 },
    })
    const dependencies = authDependencies({
      getProfile: vi.fn().mockResolvedValue({ role: 'student', active: true }),
    })

    await expect(
      authorizePaymentReminderMode(
        mode,
        requestHeaders({ authorization: 'Bearer valid-user-jwt' }),
        dependencies,
      ),
    ).rejects.toMatchObject({ status: 403, code: 'admin_forbidden' })
  })

  it('10. preserves controlled_e2e access for an active admin', async () => {
    const mode = classifyPaymentReminderRequest({
      dryRun: false,
      mode: 'controlled_e2e',
      fixture: { offset_days: 5 },
    })

    await expect(
      authorizePaymentReminderMode(
        mode,
        requestHeaders({ authorization: 'Bearer valid-admin-jwt' }),
        authDependencies(),
      ),
    ).resolves.toEqual({ kind: 'admin', user_id: ADMIN_ID })
  })

  it('11. rejects scheduled_preview with only an admin JWT', async () => {
    const mode = classifyPaymentReminderRequest({
      dryRun: true,
      mode: 'scheduled_preview',
    })

    await expect(
      authorizePaymentReminderMode(
        mode,
        requestHeaders({ authorization: 'Bearer valid-admin-jwt' }),
        authDependencies(),
      ),
    ).rejects.toMatchObject({ status: 401, code: 'service_auth_failed' })
  })

  it('12. rejects scheduled_production with only an admin JWT', async () => {
    const mode = classifyPaymentReminderRequest({
      dryRun: false,
      mode: 'scheduled_production',
    })

    await expect(
      authorizePaymentReminderMode(
        mode,
        requestHeaders({ authorization: 'Bearer valid-admin-jwt' }),
        authDependencies(),
      ),
    ).rejects.toMatchObject({ status: 401, code: 'service_auth_failed' })
  })

  it('13. fails closed when the cron secret env is missing', async () => {
    const mode = classifyPaymentReminderRequest({
      dryRun: true,
      mode: 'scheduled_preview',
    })

    await expect(
      authorizePaymentReminderMode(
        mode,
        requestHeaders({ cronSecret: VALID_CRON_SECRET }),
        authDependencies({ getEnv: () => undefined }),
      ),
    ).rejects.toMatchObject({ status: 503, code: 'service_auth_unavailable' })
  })

  it('14. fails closed when the configured cron secret is too short', async () => {
    const mode = classifyPaymentReminderRequest({
      dryRun: true,
      mode: 'scheduled_preview',
    })

    await expect(
      authorizePaymentReminderMode(
        mode,
        requestHeaders({ cronSecret: 'short' }),
        authDependencies({
          getEnv: () => 'short',
        }),
      ),
    ).rejects.toMatchObject({ status: 503, code: 'service_auth_unavailable' })
  })

  it('15. rejects a missing cron header', async () => {
    const mode = classifyPaymentReminderRequest({
      dryRun: true,
      mode: 'scheduled_preview',
    })

    await expect(
      authorizePaymentReminderMode(mode, requestHeaders(), authDependencies()),
    ).rejects.toMatchObject({ status: 401, code: 'service_auth_failed' })
  })

  it('16. rejects a wrong cron header', async () => {
    const mode = classifyPaymentReminderRequest({
      dryRun: true,
      mode: 'scheduled_preview',
    })

    await expect(
      authorizePaymentReminderMode(
        mode,
        requestHeaders({ cronSecret: 'b'.repeat(32) }),
        authDependencies(),
      ),
    ).rejects.toMatchObject({ status: 401, code: 'service_auth_failed' })
  })

  it('17. allows scheduled_preview with the exact cron secret', async () => {
    const mode = classifyPaymentReminderRequest({
      dryRun: true,
      mode: 'scheduled_preview',
    })
    const dependencies = authDependencies()

    await expect(
      authorizePaymentReminderMode(
        mode,
        requestHeaders({ cronSecret: VALID_CRON_SECRET }),
        dependencies,
      ),
    ).resolves.toEqual({ kind: 'service' })
    expect(dependencies.getUser).not.toHaveBeenCalled()
    expect(dependencies.getProfile).not.toHaveBeenCalled()
  })

  it('18. compares SHA-256 digests without returning the secret', async () => {
    await expect(
      verifyCronSecret(VALID_CRON_SECRET, VALID_CRON_SECRET),
    ).resolves.toBe(true)
    await expect(
      verifyCronSecret('b'.repeat(32), VALID_CRON_SECRET),
    ).resolves.toBe(false)

    const error = new PaymentReminderAuthError(
      'service_auth_failed',
      401,
    )
    expect(JSON.stringify(error)).not.toContain(VALID_CRON_SECRET)
    expect(error.message).not.toContain(VALID_CRON_SECRET)
  })

  it.each([
    [
      'dryRun',
      classifyPaymentReminderRequest({ dryRun: true }),
      'executeDryRun',
    ],
    [
      'controlled_e2e',
      classifyPaymentReminderRequest({
        dryRun: false,
        mode: 'controlled_e2e',
        fixture: { offset_days: 5 },
      }),
      'executeControlledE2E',
    ],
  ] as const)(
    '19. real %s handler rejects missing JWT before execution',
    async (_label, mode, executor) => {
      const dependencies = handlerDependencies()

      await expect(
        handleClassifiedPaymentReminderRequest(
          mode,
          requestHeaders(),
          dependencies,
        ),
      ).resolves.toEqual({
        status: 401,
        body: { error: 'admin_auth_required' },
      })
      expect(dependencies[executor]).not.toHaveBeenCalled()
    },
  )

  it.each([
    [
      'dryRun',
      classifyPaymentReminderRequest({ dryRun: true }),
      'executeDryRun',
    ],
    [
      'controlled_e2e',
      classifyPaymentReminderRequest({
        dryRun: false,
        mode: 'controlled_e2e',
        fixture: { offset_days: 5 },
      }),
      'executeControlledE2E',
    ],
  ] as const)(
    '20. real %s handler rejects non-admin before execution',
    async (_label, mode, executor) => {
      const dependencies = handlerDependencies(
        authDependencies({
          getProfile: vi
            .fn()
            .mockResolvedValue({ role: 'student', active: true }),
        }),
      )

      await expect(
        handleClassifiedPaymentReminderRequest(
          mode,
          requestHeaders({ authorization: 'Bearer valid-user-jwt' }),
          dependencies,
        ),
      ).resolves.toEqual({
        status: 403,
        body: { error: 'admin_forbidden' },
      })
      expect(dependencies[executor]).not.toHaveBeenCalled()
    },
  )

  it.each([
    [
      'dryRun',
      classifyPaymentReminderRequest({ dryRun: true }),
      'executeDryRun',
    ],
    [
      'controlled_e2e',
      classifyPaymentReminderRequest({
        dryRun: false,
        mode: 'controlled_e2e',
        fixture: { offset_days: 5 },
      }),
      'executeControlledE2E',
    ],
  ] as const)(
    '21. real %s handler allows an active admin only',
    async (_label, mode, executor) => {
      const dependencies = handlerDependencies()

      await expect(
        handleClassifiedPaymentReminderRequest(
          mode,
          requestHeaders({ authorization: 'Bearer valid-admin-jwt' }),
          dependencies,
        ),
      ).resolves.toMatchObject({ status: 200 })
      expect(dependencies[executor]).toHaveBeenCalledTimes(1)
    },
  )

  it.each([
    classifyPaymentReminderRequest({
      dryRun: true,
      mode: 'scheduled_preview',
    }),
    classifyPaymentReminderRequest({
      dryRun: false,
      mode: 'scheduled_production',
    }),
  ])(
    '22. real scheduled handler rejects an admin JWT without cron auth',
    async (mode) => {
      const dependencies = handlerDependencies()

      await expect(
        handleClassifiedPaymentReminderRequest(
          mode,
          requestHeaders({ authorization: 'Bearer valid-admin-jwt' }),
          dependencies,
        ),
      ).resolves.toEqual({
        status: 401,
        body: { error: 'service_auth_failed' },
      })
      expect(dependencies.executeScheduledPreview).not.toHaveBeenCalled()
      expect(dependencies.executeScheduledProduction).not.toHaveBeenCalled()
    },
  )

  it('23. real scheduled preview handler accepts only the exact cron credential', async () => {
    const dependencies = handlerDependencies()
    const mode = classifyPaymentReminderRequest({
      dryRun: true,
      mode: 'scheduled_preview',
    })

    await expect(
      handleClassifiedPaymentReminderRequest(
        mode,
        requestHeaders({ cronSecret: VALID_CRON_SECRET }),
        dependencies,
      ),
    ).resolves.toEqual({
      status: 200,
      body: { route: 'scheduled_preview' },
    })
    expect(dependencies.executeScheduledPreview).toHaveBeenCalledTimes(1)
    expect(dependencies.auth.getUser).not.toHaveBeenCalled()
    expect(dependencies.auth.getProfile).not.toHaveBeenCalled()
  })

  it('24. correct cron auth plus disabled production stops before selection and delivery setup', async () => {
    const selectCandidates = vi.fn()
    const createDeliveryDependencies = vi.fn()
    const dependencies = handlerDependencies()
    dependencies.executeScheduledProduction = vi.fn(() =>
      runScheduledProduction({
        now: () => new Date('2026-03-01T15:00:00.000Z'),
        getEnv: () => undefined,
        selectCandidates,
        createDeliveryDependencies,
      }),
    )
    const mode = classifyPaymentReminderRequest({
      dryRun: false,
      mode: 'scheduled_production',
    })

    await expect(
      handleClassifiedPaymentReminderRequest(
        mode,
        requestHeaders({ cronSecret: VALID_CRON_SECRET }),
        dependencies,
      ),
    ).resolves.toEqual({
      status: 503,
      body: { error: 'payment_reminders_production_disabled' },
    })
    expect(dependencies.executeScheduledProduction).toHaveBeenCalledTimes(1)
    expect(selectCandidates).not.toHaveBeenCalled()
    expect(createDeliveryDependencies).not.toHaveBeenCalled()
  })

  it('25. wires the pure router into the Edge handler and disables only its platform JWT gate', () => {
    expect(indexSource).toContain('classifyPaymentReminderRequest(rawPayload)')
    expect(indexSource).toContain('handleClassifiedPaymentReminderRequest(')
    expect(requestHandlerSource).toContain('authorizePaymentReminderMode(')
    expect(indexSource).toContain('adminClient.auth.getUser(token)')
    expect(indexSource).toContain(
      "request.headers.get('x-e-motiva-cron-secret')",
    )
    expect(configSource).toMatch(
      /\[functions\.send-payment-reminders\]\s*verify_jwt\s*=\s*false/i,
    )
    expect(configSource.match(/verify_jwt\s*=\s*false/gi)).toHaveLength(1)
  })
})
