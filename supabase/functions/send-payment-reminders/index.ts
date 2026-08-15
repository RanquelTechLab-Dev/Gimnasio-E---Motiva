import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.105.4'
import {
  addDaysToDate,
  evaluateReminderCandidate,
  getDateInTimeZone,
  PAYMENT_REMINDER_TIME_ZONE,
  type ReminderCandidate,
  validateDryRunPayload,
} from './reminder_logic.ts'
import {
  classifyPaymentReminderRequest,
  executeControlledE2EFromRuntime,
  getReminderReconciliationRequiredResponse,
  PaymentReminderRequestError,
  PRODUCTION_SEND_BLOCKED_MESSAGE,
} from './controlled_e2e.ts'

type MembershipRow = {
  id: string
  student_id: string
  status: string
  start_date: string
  end_date: string
}

type StudentProfileRow = {
  id: string
  first_name: string
  last_name: string
  email: string
  active: boolean
  receives_payment_reminders: boolean
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const MEMBERSHIP_PAGE_SIZE = 1_000
const PROFILE_BATCH_SIZE = 500

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
    },
  })
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (request.method !== 'POST') {
    return jsonResponse({ error: 'Metodo no permitido.' }, 405)
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse(
      { error: 'La Edge Function no tiene configuracion segura completa.' },
      500,
    )
  }

  const authorization = request.headers.get('Authorization') ?? ''
  const bearer = /^Bearer\s+(.+)$/i.exec(authorization)
  const token = bearer?.[1]?.trim() ?? ''

  if (!token) {
    return jsonResponse({ error: 'Sesion admin requerida.' }, 401)
  }

  let rawPayload: unknown
  try {
    rawPayload = await request.json()
  } catch {
    return jsonResponse({ error: 'JSON invalido.' }, 400)
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  })

  const {
    data: { user: requester },
    error: authError,
  } = await adminClient.auth.getUser(token)

  if (authError || !requester) {
    return jsonResponse({ error: 'Sesion admin invalida.' }, 401)
  }

  const { data: requesterProfile, error: requesterProfileError } =
    await adminClient
      .from('profiles')
      .select('id, role, active')
      .eq('id', requester.id)
      .single()

  if (
    requesterProfileError ||
    !requesterProfile ||
    requesterProfile.role !== 'admin' ||
    requesterProfile.active !== true
  ) {
    return jsonResponse(
      { error: 'Solo un admin activo puede evaluar recordatorios.' },
      403,
    )
  }

  let mode
  try {
    mode = classifyPaymentReminderRequest(rawPayload)
  } catch (error) {
    if (error instanceof PaymentReminderRequestError) {
      const status =
        error.message === PRODUCTION_SEND_BLOCKED_MESSAGE ? 409 : error.status
      return jsonResponse({ error: error.message }, status)
    }
    return jsonResponse({ error: 'Payload invalido.' }, 400)
  }

  if (mode.kind === 'controlled_e2e') {
    try {
      const result = await executeControlledE2EFromRuntime(mode.value, {
        client: adminClient,
        getEnv: (name) => Deno.env.get(name),
        fetchImpl: fetch,
      })
      if (result.state === 'uncertain') {
        return jsonResponse(
          {
            ...result,
            reconciliation_required: true,
            desired_status: 'uncertain',
          },
          503,
        )
      }
      return jsonResponse(result, result.state === 'failed' ? 502 : 200)
    } catch (error) {
      const reconciliationResponse =
        getReminderReconciliationRequiredResponse(error)
      if (reconciliationResponse !== null) {
        return jsonResponse(reconciliationResponse, 503)
      }
      return jsonResponse(
        { error: 'No se pudo ejecutar la prueba E2E controlada.' },
        500,
      )
    }
  }

  const payload = validateDryRunPayload(rawPayload)
  if (!payload.valid) {
    return jsonResponse({ error: payload.error }, 400)
  }

  const evaluationDate =
    payload.value.evaluationDate ?? getDateInTimeZone(new Date())
  const evaluationWindowEnd = addDaysToDate(evaluationDate, 5)

  const membershipRows: MembershipRow[] = []
  for (let from = 0; ; from += MEMBERSHIP_PAGE_SIZE) {
    const { data: memberships, error: membershipsError } = await adminClient
      .from('memberships')
      .select('id, student_id, status, start_date, end_date')
      .gte('end_date', evaluationDate)
      .lte('end_date', evaluationWindowEnd)
      .order('end_date', { ascending: true })
      .order('id', { ascending: true })
      .range(from, from + MEMBERSHIP_PAGE_SIZE - 1)

    if (membershipsError) {
      return jsonResponse(
        { error: 'No se pudieron consultar las membresias candidatas.' },
        500,
      )
    }

    const page = (memberships ?? []) as MembershipRow[]
    membershipRows.push(...page)

    if (page.length < MEMBERSHIP_PAGE_SIZE) {
      break
    }
  }

  const studentIds = [
    ...new Set(membershipRows.map((membership) => membership.student_id)),
  ]

  const profileRows: StudentProfileRow[] = []
  for (let from = 0; from < studentIds.length; from += PROFILE_BATCH_SIZE) {
    const studentIdBatch = studentIds.slice(from, from + PROFILE_BATCH_SIZE)
    const { data: profiles, error: profilesError } = await adminClient
      .from('profiles')
      .select(
        'id, first_name, last_name, email, active, receives_payment_reminders',
      )
      .in('id', studentIdBatch)
      .eq('role', 'student')

    if (profilesError) {
      return jsonResponse(
        { error: 'No se pudieron consultar los perfiles de alumnos.' },
        500,
      )
    }

    profileRows.push(...((profiles ?? []) as StudentProfileRow[]))
  }

  const profileById = new Map(
    profileRows.map((profile) => [profile.id, profile]),
  )
  const eligible: Array<{
    student_id: string
    membership_id: string
    email: string
    due_date: string
    offset_days: 5 | 3 | 1 | 0
    idempotency_key: string
  }> = []
  const excluded: Array<{
    student_id: string
    membership_id: string
    email: string | null
    due_date: string
    reason: string
  }> = []

  for (const membership of membershipRows) {
    const profile = profileById.get(membership.student_id)
    if (!profile) {
      excluded.push({
        student_id: membership.student_id,
        membership_id: membership.id,
        email: null,
        due_date: membership.end_date,
        reason: 'student_profile_not_found',
      })
      continue
    }

    const candidate: ReminderCandidate = {
      membership_id: membership.id,
      student_id: membership.student_id,
      student_first_name: profile.first_name,
      student_last_name: profile.last_name,
      email: profile.email,
      student_active: profile.active,
      receives_payment_reminders: profile.receives_payment_reminders,
      membership_status: membership.status,
      start_date: membership.start_date,
      end_date: membership.end_date,
    }
    const result = evaluateReminderCandidate(candidate, evaluationDate)

    if (
      result.eligible &&
      result.offset_days !== null &&
      result.idempotency_key !== null
    ) {
      eligible.push({
        student_id: candidate.student_id,
        membership_id: candidate.membership_id,
        email: candidate.email,
        due_date: candidate.end_date,
        offset_days: result.offset_days,
        idempotency_key: result.idempotency_key,
      })
    } else {
      excluded.push({
        student_id: candidate.student_id,
        membership_id: candidate.membership_id,
        email: candidate.email,
        due_date: candidate.end_date,
        reason: result.reason,
      })
    }
  }

  return jsonResponse({
    evaluation_date: evaluationDate,
    timezone: PAYMENT_REMINDER_TIME_ZONE,
    eligible_count: eligible.length,
    excluded_count: excluded.length,
    eligible,
    excluded,
  })
})
