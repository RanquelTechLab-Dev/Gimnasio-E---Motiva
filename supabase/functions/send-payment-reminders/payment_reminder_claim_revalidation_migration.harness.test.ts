import { readFileSync, readdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const functionDirectory = dirname(fileURLToPath(import.meta.url))
const migrationsDirectory = resolve(functionDirectory, '../../migrations')
const matchingMigrations = readdirSync(migrationsDirectory).filter((name) =>
  name.endsWith('_ran36_production_claim_revalidation.sql'),
)
const migrationSource =
  matchingMigrations.length === 1
    ? readFileSync(resolve(migrationsDirectory, matchingMigrations[0]), 'utf8')
    : ''
const executableSource = migrationSource.replace(/--.*$/gm, '')

describe('RAN-36 B3A real claim revalidation migration contract', () => {
  it('1. adds exactly one versioned production claim revalidation migration', () => {
    expect(matchingMigrations).toHaveLength(1)
  })

  it('2. replaces only the existing claim RPC with its exact public signature', () => {
    expect(executableSource.match(/create\s+or\s+replace\s+function/gi)).toHaveLength(1)
    expect(executableSource).toMatch(
      /create\s+or\s+replace\s+function\s+public\.claim_payment_reminder_delivery\s*\(\s*p_student_id\s+uuid\s*,\s*p_recipient_email\s+text\s*,\s*p_subject\s+text\s*,\s*p_idempotency_key\s+text\s*,\s*p_membership_id\s+uuid\s*,\s*p_due_date\s+date\s*,\s*p_offset_days\s+integer\s*,\s*p_synthetic_e2e\s+boolean\s+default\s+false\s*\)/i,
    )
    expect(executableSource).toMatch(
      /returns\s+table\s*\(\s*claimed\s+boolean\s*,\s*log_id\s+uuid\s*,\s*reason\s+text\s*,\s*attempt\s+integer\s*\)/i,
    )
  })

  it('3. keeps SECURITY DEFINER with an empty search_path', () => {
    expect(executableSource).toMatch(/security\s+definer/i)
    expect(executableSource).toMatch(/set\s+search_path\s*=\s*''/i)
  })

  it('4. revalidates only real deliveries and derives evaluation date', () => {
    expect(executableSource).toMatch(/if\s+not\s+p_synthetic_e2e\s+then/i)
    expect(executableSource).toMatch(
      /v_evaluation_date\s*:=\s*p_due_date\s*-\s*p_offset_days/i,
    )
  })

  it('5. locks the exact current membership row before validation', () => {
    expect(executableSource).toMatch(
      /select\s+m\.\*\s+into\s+v_membership\s+from\s+public\.memberships\s+as\s+m\s+where\s+m\.id\s*=\s*p_membership_id\s+for\s+update/i,
    )
  })

  it('6. validates membership identity, status and current dates exactly', () => {
    expect(executableSource).toMatch(
      /v_membership\.student_id\s+is\s+distinct\s+from\s+p_student_id/i,
    )
    expect(executableSource).toMatch(
      /v_membership\.status\s+is\s+distinct\s+from\s+'active'::public\.membership_status/i,
    )
    expect(executableSource).toMatch(
      /v_membership\.end_date\s+is\s+distinct\s+from\s+p_due_date/i,
    )
    expect(executableSource).toMatch(
      /v_membership\.start_date\s*>\s*v_evaluation_date/i,
    )
  })

  it('7. locks the exact current profile row before validation', () => {
    expect(executableSource).toMatch(
      /select\s+p\.\*\s+into\s+v_profile\s+from\s+public\.profiles\s+as\s+p\s+where\s+p\.id\s*=\s*p_student_id\s+for\s+update/i,
    )
  })

  it('8. validates student role, active preference and exact email', () => {
    expect(executableSource).toMatch(
      /v_profile\.role\s+is\s+distinct\s+from\s+'student'::public\.user_role/i,
    )
    expect(executableSource).toMatch(
      /v_profile\.active\s+is\s+distinct\s+from\s+true/i,
    )
    expect(executableSource).toMatch(
      /v_profile\.receives_payment_reminders\s+is\s+distinct\s+from\s+true/i,
    )
    expect(executableSource).toMatch(
      /v_profile\.email\s+is\s+distinct\s+from\s+p_recipient_email/i,
    )
    expect(executableSource).not.toMatch(/receives_emails/i)
  })

  it('9. rejects a stale candidate without creating an email log', () => {
    const staleReturnPattern =
      /select\s+false\s*,\s*null::uuid\s*,\s*'candidate_no_longer_eligible'::text\s*,\s*1\s*;\s*return\s*;\s*end\s+if/gi
    expect(executableSource.match(staleReturnPattern)).toHaveLength(2)
    const firstRevalidationIndex = executableSource.indexOf(
      "'candidate_no_longer_eligible'",
    )
    const lastRevalidationIndex = executableSource.lastIndexOf(
      "'candidate_no_longer_eligible'",
    )
    const insertIndex = executableSource.search(
      /insert\s+into\s+public\.email_logs/i,
    )
    const retryIndex = executableSource.search(
      /if\s+v_log\.status\s*=\s*'failed'/i,
    )
    expect(firstRevalidationIndex).toBeGreaterThan(-1)
    expect(lastRevalidationIndex).toBeGreaterThan(firstRevalidationIndex)
    expect(insertIndex).toBeGreaterThan(lastRevalidationIndex)
    expect(retryIndex).toBeGreaterThan(lastRevalidationIndex)
  })

  it('10. preserves atomic insert and partial-index conflict inference', () => {
    expect(executableSource).toMatch(
      /insert\s+into\s+public\.email_logs[\s\S]*?on\s+conflict\s*\(\s*idempotency_key\s*\)\s*where\s+idempotency_key\s+is\s+not\s+null\s*do\s+nothing[\s\S]*?returning/i,
    )
  })

  it('11. preserves terminal, in-progress, uncertain and failed retry semantics', () => {
    expect(executableSource).toMatch(
      /v_log\.status\s*=\s*'sent'[\s\S]*?'already_sent'/i,
    )
    expect(executableSource).toMatch(
      /v_log\.status\s*=\s*'pending'[\s\S]*?'in_progress'/i,
    )
    expect(executableSource).toMatch(
      /v_log\.status\s*=\s*'uncertain'[\s\S]*?'uncertain_outcome'/i,
    )
    expect(executableSource).toMatch(
      /v_log\.status\s*=\s*'failed'[\s\S]*?v_attempt\s*:=\s*v_attempt\s*\+\s*1[\s\S]*?status\s*=\s*'pending'[\s\S]*?'retry_claimed'/i,
    )
  })

  it('12. preserves synthetic E2E and canonical claim metadata', () => {
    expect(executableSource).toMatch(
      /if\s+p_synthetic_e2e\s+and\s+p_student_id\s+is\s+not\s+null/i,
    )
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
      expect(executableSource).toContain(`'${field}'`)
    }
  })

  it('13. revokes frontend execution and grants only service_role', () => {
    const signature =
      'public\\.claim_payment_reminder_delivery\\s*\\(\\s*uuid\\s*,\\s*text\\s*,\\s*text\\s*,\\s*text\\s*,\\s*uuid\\s*,\\s*date\\s*,\\s*integer\\s*,\\s*boolean\\s*\\)'
    expect(executableSource).toMatch(
      new RegExp(
        `revoke\\s+all\\s+on\\s+function\\s+${signature}\\s+from\\s+public\\s*,\\s*anon\\s*,\\s*authenticated\\s*;`,
        'i',
      ),
    )
    expect(executableSource).toMatch(
      new RegExp(
        `grant\\s+execute\\s+on\\s+function\\s+${signature}\\s+to\\s+service_role\\s*;`,
        'i',
      ),
    )
    expect(executableSource).not.toMatch(
      /grant\s+execute[\s\S]*?to\s+(?:public|anon|authenticated)\s*;/i,
    )
  })

  it('14. creates no schema object, scheduler or network primitive', () => {
    expect(executableSource).not.toMatch(
      /create\s+(?:unique\s+)?index|alter\s+table|pg_cron|cron\.|pg_net|net\.http|vault\./i,
    )
  })
})
