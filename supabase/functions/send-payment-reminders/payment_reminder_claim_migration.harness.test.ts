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

describe('RAN-36 B2A atomic delivery migration contract', () => {
  it('1. adds exactly one delivery-claim migration', () => {
    expect(matchingMigrations).toHaveLength(1)
  })

  it('2. creates both SECURITY DEFINER RPCs with a hardened search_path', () => {
    expect(migrationSource).toMatch(
      /create\s+(?:or\s+replace\s+)?function\s+public\.claim_payment_reminder_delivery[\s\S]*?security\s+definer[\s\S]*?set\s+search_path\s*=\s*''/i,
    )
    expect(migrationSource).toMatch(
      /create\s+(?:or\s+replace\s+)?function\s+public\.finalize_payment_reminder_delivery[\s\S]*?security\s+definer[\s\S]*?set\s+search_path\s*=\s*''/i,
    )
  })

  it('3. claims a new key atomically with ON CONFLICT DO NOTHING', () => {
    expect(migrationSource).toMatch(
      /insert\s+into\s+public\.email_logs[\s\S]*?on\s+conflict\s*\(\s*idempotency_key\s*\)[\s\S]*?do\s+nothing[\s\S]*?returning/i,
    )
    expect(migrationSource).toMatch(/'pending'/i)
    expect(migrationSource).toMatch(/'claimed'/i)
  })

  it('4. locks an existing key before deciding sent, pending or failed', () => {
    expect(migrationSource).toMatch(
      /where\s+(?:el|email_log)\.idempotency_key\s*=\s*p_idempotency_key[\s\S]*?for\s+update/i,
    )
    expect(migrationSource).toMatch(
      /(?:when\s+'sent'|status\s*=\s*'sent')[\s\S]*?'already_sent'/i,
    )
    expect(migrationSource).toMatch(
      /(?:when\s+'pending'|status\s*=\s*'pending')[\s\S]*?'in_progress'/i,
    )
    expect(migrationSource).toMatch(
      /(?:when\s+'failed'|status\s*=\s*'failed')/i,
    )
  })

  it('5. retries failed claims under the row lock and increments attempt', () => {
    expect(migrationSource).toMatch(
      /(?:when\s+'failed'|status\s*=\s*'failed')[\s\S]*?update\s+public\.email_logs[\s\S]*?'attempt'[\s\S]*?v_attempt/i,
    )
    expect(migrationSource).toMatch(/'retry_claimed'/i)
  })

  it('6. finalizes only an exact pending log and key', () => {
    expect(migrationSource).toMatch(
      /update\s+public\.email_logs[\s\S]*?where\s+(?:email_log\.)?id\s*=\s*p_log_id[\s\S]*?(?:email_log\.)?idempotency_key\s*=\s*p_idempotency_key[\s\S]*?(?:email_log\.)?status\s*=\s*'pending'/i,
    )
  })

  it('7. permits only sent or failed final states with correct sent_at semantics', () => {
    expect(migrationSource).toMatch(
      /p_status\s+not\s+in\s*\(\s*'sent'\s*,\s*'failed'\s*\)/i,
    )
    expect(migrationSource).toMatch(
      /sent_at\s*=\s*case[\s\S]*?p_status\s*=\s*'sent'[\s\S]*?now\(\)[\s\S]*?else\s+null/i,
    )
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

  it('9. revokes frontend execution and grants only service_role', () => {
    for (const functionName of [
      'claim_payment_reminder_delivery',
      'finalize_payment_reminder_delivery',
    ]) {
      expect(migrationSource).toMatch(
        new RegExp(
          `revoke\\s+all\\s+on\\s+function\\s+public\\.${functionName}[\\s\\S]*?from\\s+public\\s*,\\s*anon\\s*,\\s*authenticated`,
          'i',
        ),
      )
      expect(migrationSource).toMatch(
        new RegExp(
          `grant\\s+execute\\s+on\\s+function\\s+public\\.${functionName}[\\s\\S]*?to\\s+service_role`,
          'i',
        ),
      )
    }
  })

  it('10. reuses the existing unique index instead of creating another one', () => {
    expect(migrationSource).not.toMatch(/create\s+unique\s+index/i)
    expect(migrationSource).not.toMatch(/email_logs_idempotency_key_unique_idx/i)
  })

  it('11. contains no cron scheduling', () => {
    expect(migrationSource).not.toMatch(/pg_cron|cron\.schedule|pg_net/i)
  })
})
