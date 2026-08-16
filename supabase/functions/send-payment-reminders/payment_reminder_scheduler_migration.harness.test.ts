import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const functionDirectory = dirname(fileURLToPath(import.meta.url))
const migrationsDirectory = resolve(functionDirectory, '../../migrations')
const matchingMigrations = readdirSync(migrationsDirectory).filter((name) =>
  name.endsWith('_ran36_payment_reminder_scheduler.sql'),
)
const migrationSource =
  matchingMigrations.length === 1
    ? readFileSync(resolve(migrationsDirectory, matchingMigrations[0]), 'utf8')
    : ''
const executableSource = migrationSource
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/--.*$/gm, '')

const expectedPreviousMigrationHashes = new Map([
  [
    '20260809111209_ran36_payment_reminders_foundation.sql',
    'f2f7934182c9508d844cc6fb9c9c87907a145f93598036b5a970a0a160aaa679',
  ],
  [
    '20260814201220_ran36_payment_reminder_delivery_claim.sql',
    '8466278ef29f0d8a012859912e66bd8c4f637732a4030980509e7035ad709ef3',
  ],
  [
    '20260815193014_ran36_production_claim_revalidation.sql',
    'c46b85fbe38964bbac7aa3e9ee82d3f2da4388be8ad7f7d04f95a77305ed6594',
  ],
])

type LocalRun = {
  localDate: string
  localHour: number
}

function getCordobaRun(instant: Date): LocalRun {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Cordoba',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(instant)
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? ''

  return {
    localDate: `${value('year')}-${value('month')}-${value('day')}`,
    localHour: Number(value('hour')),
  }
}

function simulateDispatches(instants: Date[]) {
  const dispatchedDates = new Set<string>()

  return instants.map((instant) => {
    const run = getCordobaRun(instant)
    if (run.localHour !== 10 || dispatchedDates.has(run.localDate)) {
      return false
    }

    dispatchedDates.add(run.localDate)
    return true
  })
}

function normalizedSha256(path: string) {
  const normalized = readFileSync(path, 'utf8').replace(/\r\n/g, '\n')
  return createHash('sha256').update(normalized, 'utf8').digest('hex')
}

describe('RAN-36 B3D payment reminder scheduler migration contract', () => {
  it('1. adds exactly one scheduler migration and enables pg_cron once', () => {
    expect(matchingMigrations).toHaveLength(1)
    expect(
      executableSource.match(
        /create\s+extension\s+if\s+not\s+exists\s+pg_cron\s*;/gi,
      ),
    ).toHaveLength(1)
  })

  it('2. enables pg_net once without configuring remote networking', () => {
    expect(
      executableSource.match(
        /create\s+extension\s+if\s+not\s+exists\s+pg_net\s+with\s+schema\s+extensions\s*;/gi,
      ),
    ).toHaveLength(1)
    expect(executableSource).not.toMatch(
      /alter\s+system|net\.worker_restart|pg_net\.(?:ttl|batch_size)/i,
    )
  })

  it('3. reads exactly the three expected runtime values from Vault', () => {
    for (const name of [
      'emotiva_project_url',
      'emotiva_publishable_key',
      'emotiva_payment_reminder_cron_secret',
    ]) {
      expect(executableSource.match(new RegExp(`'${name}'`, 'g'))).toHaveLength(
        1,
      )
    }
    expect(executableSource.match(/vault\.decrypted_secrets/gi)).toHaveLength(3)
  })

  it('4. contains no real URL, email, API key, JWT or secret literal', () => {
    const projectBindingIndex = executableSource.search(
      /v_project_url\s+is\s+distinct\s+from\s+pg_catalog\.format/i,
    )
    const httpCallIndex = executableSource.search(/select\s+net\.http_post/i)

    expect(executableSource).not.toMatch(
      /https:\/\/[a-z0-9-]+\.supabase\.co|[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}|sb_(?:publishable|secret)_|eyJ[a-z0-9_-]+\.[a-z0-9_-]+/i,
    )
    expect(executableSource).toMatch(
      /v_expected_project_ref\s+constant\s+text\s*:=\s*'kmfxgeqxulwaauracyzs'/i,
    )
    expect(executableSource).toMatch(
      /v_project_url\s+is\s+distinct\s+from\s+pg_catalog\.format\s*\(\s*'https:\/\/%s\.supabase\.co'\s*,\s*v_expected_project_ref\s*\)/i,
    )
    expect(projectBindingIndex).toBeGreaterThan(-1)
    expect(projectBindingIndex).toBeLessThan(httpCallIndex)
    expect(executableSource).toMatch(
      /select\s+net\.http_post\s*\([\s\S]*?url\s*:=\s*v_project_url\s*\|\|\s*'\/functions\/v1\/send-payment-reminders'/i,
    )
  })

  it('5. never uses a service-role credential or Authorization header', () => {
    expect(executableSource).not.toMatch(/service_role|authorization/i)
  })

  it('6. derives local date and hour from the Córdoba IANA timezone', () => {
    expect(executableSource).toContain('America/Argentina/Cordoba')
    expect(executableSource).toMatch(
      /timezone\s*\(\s*'America\/Argentina\/Cordoba'\s*,\s*pg_catalog\.now\(\)\s*\)/i,
    )
  })

  it('7. exits before Vault and HTTP outside local hour 10', () => {
    const hourGuardIndex = executableSource.search(
      /if\s+v_local_hour\s*<>\s*10\s+then/i,
    )
    const hourGuard = executableSource.match(
      /if\s+v_local_hour\s*<>\s*10\s+then([\s\S]*?)end\s+if\s*;/i,
    )?.[1]
    const vaultIndex = executableSource.search(/vault\.decrypted_secrets/i)
    const httpIndex = executableSource.search(/select\s+net\.http_post/i)

    expect(hourGuardIndex).toBeGreaterThan(-1)
    expect(hourGuard).toMatch(/return\s+query[\s\S]*?return\s*;/i)
    expect(vaultIndex).toBeGreaterThan(hourGuardIndex)
    expect(httpIndex).toBeGreaterThan(vaultIndex)
    expect(
      simulateDispatches([
        new Date('2036-01-02T12:00:00.000Z'),
        new Date('2036-01-02T14:00:00.000Z'),
      ]),
    ).toEqual([false, false])
  })

  it('8. queues exactly one HTTP request at local hour 10', () => {
    expect(
      executableSource.match(/select\s+net\.http_post\s*\(/gi),
    ).toHaveLength(1)
    expect(
      simulateDispatches([new Date('2036-01-02T13:00:00.000Z')]),
    ).toEqual([true])
  })

  it('9. atomically limits a local date to at most one dispatch', () => {
    expect(executableSource).toMatch(
      /create\s+table\s+if\s+not\s+exists\s+private\.payment_reminder_scheduler_dispatches[\s\S]*?local_date\s+date\s+primary\s+key/i,
    )
    const conflictGuard = executableSource.match(
      /insert\s+into\s+private\.payment_reminder_scheduler_dispatches\s*\(\s*local_date\s*\)\s*values\s*\(\s*v_local_date\s*\)\s*on\s+conflict\s+on\s+constraint\s+payment_reminder_scheduler_dispatches_pkey\s+do\s+nothing\s*;\s*if\s+not\s+found\s+then([\s\S]*?)end\s+if\s*;/i,
    )
    expect(conflictGuard).not.toBeNull()
    expect(conflictGuard?.[1]).toMatch(
      /return\s+query\s+select\s+v_local_date\s*,\s*false\s*,\s*null::bigint\s*;[\s\S]*?return\s*;/i,
    )
    expect(executableSource.indexOf(conflictGuard?.[0] ?? '')).toBeLessThan(
      executableSource.search(/select\s+net\.http_post/i),
    )
    expect(
      simulateDispatches([
        new Date('2036-01-02T13:00:00.000Z'),
        new Date('2036-01-02T13:30:00.000Z'),
      ]),
    ).toEqual([true, false])
  })

  it('10. permits a new dispatch on the next Córdoba local date', () => {
    expect(executableSource).toMatch(
      /v_local_date\s*:=\s*v_local_timestamp::date\s*;/i,
    )
    expect(executableSource).toMatch(
      /insert\s+into\s+private\.payment_reminder_scheduler_dispatches\s*\(\s*local_date\s*\)\s*values\s*\(\s*v_local_date\s*\)/i,
    )
    expect(
      simulateDispatches([
        new Date('2036-01-02T13:00:00.000Z'),
        new Date('2036-01-03T13:00:00.000Z'),
      ]),
    ).toEqual([true, true])
  })

  it('11. sends only scheduled_preview mode', () => {
    expect(executableSource).toMatch(
      /jsonb_build_object\s*\(\s*'dryRun'\s*,\s*true\s*,\s*'mode'\s*,\s*'scheduled_preview'\s*\)/i,
    )
    expect(executableSource.match(/scheduled_preview/g)).toHaveLength(1)
  })

  it('12. sends dryRun as the JSON boolean true', () => {
    expect(executableSource).toMatch(/'dryRun'\s*,\s*true/i)
    expect(executableSource).not.toMatch(/'dryRun'\s*,\s*'true'/i)
  })

  it('13. sources the cron authentication header only from Vault', () => {
    expect(executableSource).toMatch(
      /'x-e-motiva-cron-secret'\s*,\s*v_cron_secret/i,
    )
    expect(executableSource).toMatch(
      /where\s+(?:secret\.)?name\s*=\s*'emotiva_payment_reminder_cron_secret'/i,
    )
  })

  it('14. sources the apikey header only from the Vault publishable key', () => {
    expect(executableSource).toMatch(/'apikey'\s*,\s*v_publishable_key/i)
    expect(executableSource).toMatch(
      /where\s+(?:secret\.)?name\s*=\s*'emotiva_publishable_key'/i,
    )
    expect(executableSource).toMatch(
      /'Content-Type'\s*,\s*'application\/json'/i,
    )
  })

  it('15. stores and returns technical fields only, with no PII', () => {
    expect(executableSource).toMatch(
      /returns\s+table\s*\(\s*local_date\s+date\s*,\s*dispatched\s+boolean\s*,\s*request_id\s+bigint\s*\)/i,
    )
    expect(executableSource).not.toMatch(
      /student_id|membership_id|recipient_email|first_name|last_name/i,
    )
  })

  it('16. upserts exactly one fixed-name cron job', () => {
    expect(executableSource.match(/cron\.schedule\s*\(/gi)).toHaveLength(1)
    expect(
      executableSource.match(/'emotiva-payment-reminders'/g),
    ).toHaveLength(1)
    expect(executableSource).not.toMatch(/cron\.unschedule/i)
  })

  it('17. uses the hourly command and explicitly leaves the job active', () => {
    expect(executableSource).toMatch(
      /cron\.schedule\s*\(\s*'emotiva-payment-reminders'\s*,\s*'0 \* \* \* \*'\s*,\s*\$cron\$\s*select\s+private\.invoke_payment_reminder_scheduler\(\)\s*;\s*\$cron\$/i,
    )
    expect(executableSource).toMatch(
      /cron\.alter_job\s*\([\s\S]*?job_id\s*=>\s*v_job_id[\s\S]*?active\s*=>\s*true/i,
    )
    expect(executableSource).not.toMatch(
      /(?:insert|update|delete)\s+(?:from\s+)?cron\.job/i,
    )
  })

  it('18. never schedules or invokes scheduled_production', () => {
    expect(executableSource).not.toMatch(/scheduled_production/i)
  })

  it('19. never enables or reads the production kill-switch', () => {
    expect(executableSource).not.toMatch(
      /PAYMENT_REMINDERS_PRODUCTION_ENABLED/i,
    )
  })

  it('20. has no Mailjet primitive or credential', () => {
    expect(executableSource).not.toMatch(/mailjet|api\.mailjet\.com/i)
  })

  it('21. never mutates email or application-domain data', () => {
    expect(executableSource).not.toMatch(/email_logs/i)
    expect(executableSource).not.toMatch(
      /(?:insert\s+into|update|delete\s+from)\s+(?:public\.)?(?:profiles|memberships|payments|bookings|attendance)/i,
    )
  })

  it('22. denies wrapper and table access to frontend roles', () => {
    expect(executableSource).toMatch(
      /revoke\s+all\s+on\s+function\s+private\.invoke_payment_reminder_scheduler\(\)\s+from\s+public\s*,\s*anon\s*,\s*authenticated\s*;/i,
    )
    expect(executableSource).toMatch(
      /revoke\s+all\s+on\s+table\s+private\.payment_reminder_scheduler_dispatches\s+from\s+public\s*,\s*anon\s*,\s*authenticated\s*;/i,
    )
    expect(executableSource).toMatch(
      /revoke\s+all\s+on\s+table\s+net\.http_request_queue\s+from\s+public\s*,\s*anon\s*,\s*authenticated\s*;/i,
    )
    expect(executableSource).toMatch(
      /revoke\s+all\s+on\s+sequence\s+net\.http_request_queue_id_seq\s+from\s+public\s*,\s*anon\s*,\s*authenticated\s*;/i,
    )
    expect(executableSource).toMatch(
      /revoke\s+all\s+on\s+function\s+net\.http_post\s*\(\s*text\s*,\s*jsonb\s*,\s*jsonb\s*,\s*jsonb\s*,\s*integer\s*\)\s+from\s+public\s*,\s*anon\s*,\s*authenticated\s*;/i,
    )
    expect(executableSource).toMatch(
      /grant\s+insert\s+on\s+table\s+net\.http_request_queue\s+to\s+postgres\s*;/i,
    )
    expect(executableSource).toMatch(
      /grant\s+select\s*\(\s*id\s*\)\s+on\s+table\s+net\.http_request_queue\s+to\s+postgres\s*;/i,
    )
    expect(executableSource).toMatch(
      /grant\s+usage\s+on\s+sequence\s+net\.http_request_queue_id_seq\s+to\s+postgres\s*;/i,
    )
    expect(executableSource).toMatch(
      /grant\s+execute\s+on\s+function\s+net\.http_post\s*\(\s*text\s*,\s*jsonb\s*,\s*jsonb\s*,\s*jsonb\s*,\s*integer\s*\)\s+to\s+postgres\s*;/i,
    )
    expect(executableSource).not.toMatch(
      /grant\s+execute[\s\S]*?to\s+(?:public|anon|authenticated)/i,
    )
  })

  it('23. hardens execution, validates Vault, and bounds HTTP timeout', () => {
    expect(executableSource).toMatch(/security\s+invoker/i)
    expect(executableSource).not.toMatch(/security\s+definer/i)
    expect(executableSource).toMatch(/set\s+search_path\s*=\s*''/i)
    expect(executableSource).toMatch(
      /if\s+v_project_url\s+is\s+null[\s\S]*?v_publishable_key\s+is\s+null[\s\S]*?v_cron_secret\s+is\s+null[\s\S]*?raise\s+exception/i,
    )
    expect(executableSource).toMatch(
      /timeout_milliseconds\s*(?::=|=>)\s*5000/i,
    )
    expect(executableSource).toMatch(
      /if\s+v_request_id\s+is\s+null\s+then[\s\S]*?raise\s+exception/i,
    )
  })

  it('24. leaves every earlier RAN-36 migration byte-equivalent', () => {
    for (const [name, expectedHash] of expectedPreviousMigrationHashes) {
      expect(normalizedSha256(resolve(migrationsDirectory, name))).toBe(
        expectedHash,
      )
    }
  })
})
