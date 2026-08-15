import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const functionDirectory = dirname(fileURLToPath(import.meta.url))
const migrationsDirectory = resolve(functionDirectory, '../../migrations')
const matchingMigrations = readdirSync(migrationsDirectory).filter((name) =>
  name.endsWith('_ran36_payment_reminder_delivery_claim.sql'),
)
const migrationSource =
  matchingMigrations.length === 1
    ? readFileSync(resolve(migrationsDirectory, matchingMigrations[0]), 'utf8')
    : ''

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function extractRpcSource(functionName: string) {
  const declaration = new RegExp(
    `create\\s+(?:or\\s+replace\\s+)?function\\s+public\\.${escapeRegExp(functionName)}\\s*\\(`,
    'i',
  ).exec(migrationSource)

  if (!declaration) return ''

  const sourceFromDeclaration = migrationSource.slice(declaration.index)
  const openingDelimiter = /as\s+\$function\$/i.exec(sourceFromDeclaration)

  if (!openingDelimiter) return ''

  const bodyStart = openingDelimiter.index + openingDelimiter[0].length
  const sourceFromBody = sourceFromDeclaration.slice(bodyStart)
  const closingDelimiter = /\$function\$\s*;/i.exec(sourceFromBody)

  if (!closingDelimiter) return ''

  const functionEnd =
    bodyStart + closingDelimiter.index + closingDelimiter[0].length
  return sourceFromDeclaration.slice(0, functionEnd)
}

function valuesInNotInGuard(source: string, expression: string) {
  const guard = new RegExp(
    `${escapeRegExp(expression)}\\s+not\\s+in\\s*\\(([^)]*)\\)`,
    'i',
  ).exec(source)

  if (!guard) return []

  return Array.from(guard[1].matchAll(/'([^']+)'/g), (match) =>
    match[1].toLowerCase(),
  ).sort()
}

function rpcSignaturePattern(functionName: string, argumentTypes: string[]) {
  return `public\\.${escapeRegExp(functionName)}\\s*\\(\\s*${argumentTypes.join(
    '\\s*,\\s*',
  )}\\s*\\)`
}

const claimRpcSource = extractRpcSource('claim_payment_reminder_delivery')
const finalizeRpcSource = extractRpcSource('finalize_payment_reminder_delivery')
const reconcileRpcSource = extractRpcSource(
  'reconcile_payment_reminder_delivery',
)

const protectedRpcSignatures = [
  {
    name: 'claim_payment_reminder_delivery',
    argumentTypes: [
      'uuid',
      'text',
      'text',
      'text',
      'uuid',
      'date',
      'integer',
      'boolean',
    ],
  },
  {
    name: 'finalize_payment_reminder_delivery',
    argumentTypes: ['uuid', 'text', 'text', 'text', 'text', 'jsonb'],
  },
  {
    name: 'reconcile_payment_reminder_delivery',
    argumentTypes: ['uuid', 'text', 'text', 'text', 'text', 'jsonb'],
  },
]

describe('RAN-36 B2A atomic delivery migration contract', () => {
  it('1. adds exactly one delivery-claim migration', () => {
    expect(matchingMigrations).toHaveLength(1)
  })

  it('2. scopes claim, finalize and reconcile as three distinct RPC bodies', () => {
    expect(claimRpcSource).not.toBe('')
    expect(finalizeRpcSource).not.toBe('')
    expect(reconcileRpcSource).not.toBe('')
  })

  it('3. claims a new key atomically with ON CONFLICT DO NOTHING', () => {
    expect(claimRpcSource).toMatch(
      /insert\s+into\s+public\.email_logs[\s\S]*?on\s+conflict\s*\(\s*idempotency_key\s*\)[\s\S]*?do\s+nothing[\s\S]*?returning/i,
    )
    expect(claimRpcSource).toMatch(/'pending'/i)
    expect(claimRpcSource).toMatch(/'claimed'/i)
  })

  it('4. locks an existing key and blocks sent, pending and uncertain claims', () => {
    expect(claimRpcSource).toMatch(
      /where\s+(?:el|email_log)\.idempotency_key\s*=\s*p_idempotency_key[\s\S]*?for\s+update/i,
    )
    expect(claimRpcSource).toMatch(
      /if\s+v_log\.status\s*=\s*'sent'\s+then[\s\S]*?select\s+false\s*,\s*v_log\.id\s*,\s*'already_sent'/i,
    )
    expect(claimRpcSource).toMatch(
      /if\s+v_log\.status\s*=\s*'pending'\s+then[\s\S]*?select\s+false\s*,\s*v_log\.id\s*,\s*'in_progress'/i,
    )
    expect(claimRpcSource).toMatch(
      /if\s+v_log\.status\s*=\s*'uncertain'\s+then[\s\S]*?select\s+false\s*,\s*v_log\.id\s*,\s*'uncertain_outcome'/i,
    )
  })

  it('5. retries failed claims under the row lock and increments attempt', () => {
    expect(claimRpcSource).toMatch(
      /if\s+v_log\.status\s*=\s*'failed'\s+then[\s\S]*?v_attempt\s*:=\s*v_attempt\s*\+\s*1[\s\S]*?update\s+public\.email_logs[\s\S]*?status\s*=\s*'pending'[\s\S]*?'attempt'\s*,\s*v_attempt[\s\S]*?'retry_claimed'/i,
    )
  })

  it('6. finalizes only an exact pending log and key', () => {
    expect(finalizeRpcSource).toMatch(
      /update\s+public\.email_logs[\s\S]*?where\s+(?:email_log\.)?id\s*=\s*p_log_id[\s\S]*?(?:email_log\.)?idempotency_key\s*=\s*p_idempotency_key[\s\S]*?(?:email_log\.)?status\s*=\s*'pending'/i,
    )
  })

  it('7. finalizes sent, failed or uncertain with canonical certainty metadata', () => {
    expect(valuesInNotInGuard(finalizeRpcSource, 'p_status')).toEqual([
      'failed',
      'sent',
      'uncertain',
    ])
    expect(finalizeRpcSource).toMatch(
      /sent_at\s*=\s*case[\s\S]*?p_status\s*=\s*'sent'[\s\S]*?now\(\)[\s\S]*?else\s+null/i,
    )
    expect(finalizeRpcSource).toContain("'delivery_certainty'")
    expect(finalizeRpcSource).toContain("'accepted'")
    expect(finalizeRpcSource).toContain("'rejected'")
    expect(finalizeRpcSource).toContain("'uncertain'")
  })

  it('8. preserves every required bounded metadata field', () => {
    for (const field of [
      'notification_type',
      'membership_id',
      'due_date',
      'offset_days',
      'idempotency_key',
      'attempt',
      'provider',
      'synthetic_e2e',
    ]) {
      expect(migrationSource).toContain(`'${field}'`)
    }
  })

  it('9. reconciles only pending or uncertain rows to the three final outcomes', () => {
    expect(valuesInNotInGuard(reconcileRpcSource, 'p_final_status')).toEqual([
      'failed',
      'sent',
      'uncertain',
    ])
    expect(valuesInNotInGuard(reconcileRpcSource, 'v_log.status')).toEqual([
      'pending',
      'uncertain',
    ])
    expect(reconcileRpcSource).toMatch(
      /update\s+public\.email_logs[\s\S]*?set[\s\S]*?status\s*=\s*p_final_status/i,
    )
    expect(reconcileRpcSource).toMatch(
      /sent_at\s*=\s*case[\s\S]*?p_final_status\s*=\s*'sent'[\s\S]*?now\(\)[\s\S]*?else\s+null/i,
    )
    expect(reconcileRpcSource).toContain("'delivery_certainty'")
  })

  it('10. reconciles under an exact-identity row lock without sending', () => {
    expect(reconcileRpcSource).toMatch(
      /select\s+(?:email_log|el)\.\*[\s\S]*?where\s+(?:email_log|el)\.id\s*=\s*p_log_id[\s\S]*?(?:email_log|el)\.idempotency_key\s*=\s*p_idempotency_key[\s\S]*?for\s+update/i,
    )
    expect(reconcileRpcSource).toMatch(
      /where\s+(?:email_log|el)\.id\s*=\s*(?:p_log_id|v_log\.id)[\s\S]*?(?:email_log|el)\.idempotency_key\s*=\s*p_idempotency_key[\s\S]*?(?:email_log|el)\.status\s*=\s*v_log\.status/i,
    )
    expect(reconcileRpcSource).not.toMatch(
      /fetch\s*\(|pg_net|http_post|net\.http/i,
    )
  })

  it('11. rejects mutation of sent rows and wrong log/key identity', () => {
    expect(reconcileRpcSource).toMatch(
      /if\s+v_log\.status\s*=\s*'sent'\s+then[\s\S]*?select\s+false[\s\S]*?'already_sent'/i,
    )
    expect(reconcileRpcSource).toMatch(
      /if\s+not\s+found\s+then[\s\S]*?select\s+false[\s\S]*?'identity_mismatch'/i,
    )
  })

  it('12. hardens all three SECURITY DEFINER RPC bodies', () => {
    for (const rpcSource of [
      claimRpcSource,
      finalizeRpcSource,
      reconcileRpcSource,
    ]) {
      expect(rpcSource).toMatch(/security\s+definer/i)
      expect(rpcSource).toMatch(/set\s+search_path\s*=\s*''/i)
    }
  })

  it('13. revokes frontend execution and grants only service_role', () => {
    for (const { name, argumentTypes } of protectedRpcSignatures) {
      const signature = rpcSignaturePattern(name, argumentTypes)

      expect(migrationSource).toMatch(
        new RegExp(
          `revoke\\s+all\\s+on\\s+function\\s+${signature}\\s+from\\s+public\\s*,\\s*anon\\s*,\\s*authenticated\\s*;`,
          'i',
        ),
      )
      expect(migrationSource).toMatch(
        new RegExp(
          `grant\\s+execute\\s+on\\s+function\\s+${signature}\\s+to\\s+service_role\\s*;`,
          'i',
        ),
      )
      expect(migrationSource).not.toMatch(
        new RegExp(
          `grant\\s+execute\\s+on\\s+function\\s+${signature}\\s+to\\s+(?:public|anon|authenticated)\\s*;`,
          'i',
        ),
      )
    }
  })

  it('14. reuses the existing unique index instead of creating another one', () => {
    expect(migrationSource).not.toMatch(/create\s+unique\s+index/i)
    expect(migrationSource).not.toMatch(/email_logs_idempotency_key_unique_idx/i)
  })

  it('15. contains no cron scheduling or network delivery primitive', () => {
    expect(migrationSource).not.toMatch(/pg_cron|cron\.schedule|pg_net/i)
  })
})
