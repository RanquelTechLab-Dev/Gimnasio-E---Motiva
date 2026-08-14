import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import {
  selectEligibleRecipients,
  validateRecipientIds,
} from './recipient_selection.ts'
import {
  buildPostgrestRecentPaymentsCursorFilter,
  buildLatestPaymentByStudent,
  collectAllRecentApprovedPayments,
  type RecentApprovedPayment,
} from './recent_payments_pagination.ts'
import { collectProfilesInBatches } from './profile_batching.ts'

type MassEmailPayload = {
  subject?: string
  body?: string
  audience?: 'recent_payers_6_months'
  dryRun?: boolean
  recipient_ids?: unknown
}

type Recipient = {
  id: string
  first_name: string
  last_name: string
  email: string
  last_paid_at: string
}

type EligibleProfile = {
  id: string
  first_name: string
  last_name: string
  email: string | null
  active: boolean
  role: string
  receives_emails: boolean
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
    },
  })
}

function cleanText(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

function renderHtml(body: string) {
  return escapeHtml(body).replaceAll('\n', '<br>')
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (req.method !== 'POST') {
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

  const authorization = req.headers.get('Authorization') ?? ''
  const token = authorization.replace('Bearer ', '').trim()

  if (!token) {
    return jsonResponse({ error: 'Sesion admin requerida.' }, 401)
  }

  let rawPayload: unknown
  try {
    rawPayload = await req.json()
  } catch {
    return jsonResponse({ error: 'JSON invalido.' }, 400)
  }

  if (
    typeof rawPayload !== 'object' ||
    rawPayload === null ||
    Array.isArray(rawPayload)
  ) {
    return jsonResponse({ error: 'JSON invalido.' }, 400)
  }

  const payload = rawPayload as MassEmailPayload
  const payloadRecord = rawPayload as Record<string, unknown>
  const forbiddenRecipientFields = ['recipient_emails', 'emails', 'to']

  if (
    forbiddenRecipientFields.some((field) =>
      Object.prototype.hasOwnProperty.call(payloadRecord, field),
    )
  ) {
    return jsonResponse(
      { error: 'Solo se aceptan recipient_ids para seleccionar destinatarios.' },
      400,
    )
  }

  const subject = cleanText(payload.subject)
  const body = cleanText(payload.body)
  const audience = payload.audience ?? 'recent_payers_6_months'
  const dryRun = payload.dryRun !== false

  if (audience !== 'recent_payers_6_months') {
    return jsonResponse({ error: 'Audiencia no soportada.' }, 400)
  }

  if (!subject || !body) {
    return jsonResponse({ error: 'Asunto y mensaje son requeridos.' }, 400)
  }

  if (subject.length > 180) {
    return jsonResponse({ error: 'El asunto no puede superar 180 caracteres.' }, 400)
  }

  if (body.length > 5000) {
    return jsonResponse({ error: 'El mensaje no puede superar 5000 caracteres.' }, 400)
  }

  const selectionValidation = validateRecipientIds(payload.recipient_ids)
  if (!selectionValidation.valid) {
    return jsonResponse({ error: selectionValidation.error }, 400)
  }

  const recipientSelection = selectionValidation.selection

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
    return jsonResponse({ error: 'Solo un admin activo puede enviar emails.' }, 403)
  }

  const since = new Date()
  since.setMonth(since.getMonth() - 6)

  let recentPayments: RecentApprovedPayment[]
  try {
    recentPayments = await collectAllRecentApprovedPayments(
      async (cursor, limit) => {
        const baseQuery = adminClient
          .from('payments')
          .select('id, student_id, paid_at, approved_at, created_at')
          .eq('status', 'approved')
          .gte('paid_at', since.toISOString())

        const keysetQuery = cursor
          ? baseQuery.or(buildPostgrestRecentPaymentsCursorFilter(cursor))
          : baseQuery

        const { data, error } = await keysetQuery
          .order('paid_at', { ascending: true })
          .order('id', { ascending: true })
          .limit(limit)

        if (error) {
          throw error
        }

        return (data ?? []) as RecentApprovedPayment[]
      },
    )
  } catch {
    return jsonResponse(
      { error: 'No se pudo obtener la audiencia de pagos recientes.' },
      500,
    )
  }

  const latestPaymentByStudent = buildLatestPaymentByStudent(recentPayments)

  const studentIds = [...latestPaymentByStudent.keys()]

  if (studentIds.length === 0) {
    const selectionResult = selectEligibleRecipients([], recipientSelection)

    if (selectionResult.selection_mode === 'selected') {
      return jsonResponse(
        {
          error: 'No hay destinatarios elegibles dentro de la selección.',
          audience,
          dryRun,
          eligible_count: 0,
          selection_mode: selectionResult.selection_mode,
          requested_count: selectionResult.requested_count,
          selected_count: selectionResult.selected_count,
          ignored_count: selectionResult.ignored_count,
        },
        400,
      )
    }

    return jsonResponse({
      audience,
      dryRun,
      eligible_count: 0,
      sent_count: 0,
      failed_count: 0,
      skipped_count: 0,
      selection_mode: selectionResult.selection_mode,
      requested_count: selectionResult.requested_count,
      selected_count: selectionResult.selected_count,
      ignored_count: selectionResult.ignored_count,
      recipients: [],
      message: 'No hay alumnos elegibles con pagos aprobados recientes.',
    })
  }

  let profiles: EligibleProfile[]
  try {
    profiles = await collectProfilesInBatches<EligibleProfile>(
      studentIds,
      async (batchIds) => {
        const { data, error } = await adminClient
          .from('profiles')
          .select(
            'id, first_name, last_name, email, active, role, receives_emails',
          )
          .in('id', batchIds)
          .eq('role', 'student')
          .eq('active', true)
          .eq('receives_emails', true)
          .not('email', 'is', null)

        if (error) {
          throw error
        }

        return (data ?? []) as EligibleProfile[]
      },
    )
  } catch {
    return jsonResponse(
      { error: 'No se pudo filtrar alumnos con opt-in activo.' },
      500,
    )
  }

  const eligibleRecipients: Recipient[] = profiles
    .filter((profile) => typeof profile.email === 'string' && profile.email.includes('@'))
    .map((profile) => ({
      id: profile.id as string,
      first_name: profile.first_name as string,
      last_name: profile.last_name as string,
      email: profile.email as string,
      last_paid_at: latestPaymentByStudent.get(profile.id as string) ?? '',
    }))
    .sort((a, b) => a.email.localeCompare(b.email))

  const selectionResult = selectEligibleRecipients(
    eligibleRecipients,
    recipientSelection,
  )
  const recipients = selectionResult.recipients

  if (
    selectionResult.selection_mode === 'selected' &&
    selectionResult.selected_count === 0
  ) {
    return jsonResponse(
      {
        error: 'No hay destinatarios elegibles dentro de la selección.',
        audience,
        dryRun,
        eligible_count: eligibleRecipients.length,
        selection_mode: selectionResult.selection_mode,
        requested_count: selectionResult.requested_count,
        selected_count: selectionResult.selected_count,
        ignored_count: selectionResult.ignored_count,
      },
      400,
    )
  }

  if (dryRun) {
    return jsonResponse({
      audience,
      dryRun: true,
      eligible_count: eligibleRecipients.length,
      sent_count: 0,
      failed_count: 0,
      skipped_count: recipients.length,
      selection_mode: selectionResult.selection_mode,
      requested_count: selectionResult.requested_count,
      selected_count: selectionResult.selected_count,
      ignored_count: selectionResult.ignored_count,
      recipients: recipients.map((recipient) => ({
        student_id: recipient.id,
        email: recipient.email,
        first_name: recipient.first_name,
        last_name: recipient.last_name,
        last_paid_at: recipient.last_paid_at,
      })),
    })
  }

  const mailjetApiKey = Deno.env.get('MAILJET_API_KEY')
  const mailjetApiSecret = Deno.env.get('MAILJET_API_SECRET')
  const fromEmail = Deno.env.get('MAILJET_FROM_EMAIL')
  const fromName = Deno.env.get('MAILJET_FROM_NAME') ?? 'E-Motiva'

  if (!mailjetApiKey || !mailjetApiSecret || !fromEmail) {
    return jsonResponse(
      { error: 'Mailjet no tiene secrets configurados en Supabase.' },
      500,
    )
  }

  let sentCount = 0
  let failedCount = 0
  const results: Array<{
    student_id: string
    email: string
    status: 'sent' | 'failed'
    provider_message_id?: string | null
    error?: string
  }> = []

  const encodedCredentials = btoa(`${mailjetApiKey}:${mailjetApiSecret}`)

  for (const recipient of recipients) {
    const mailjetBody = {
      Messages: [
        {
          From: {
            Email: fromEmail,
            Name: fromName,
          },
          To: [
            {
              Email: recipient.email,
              Name: `${recipient.first_name} ${recipient.last_name}`.trim(),
            },
          ],
          Subject: subject,
          TextPart: body,
          HTMLPart: renderHtml(body),
        },
      ],
    }

    try {
      const mailjetResponse = await fetch('https://api.mailjet.com/v3.1/send', {
        method: 'POST',
        headers: {
          Authorization: `Basic ${encodedCredentials}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(mailjetBody),
      })

      const responseBody = await mailjetResponse.json().catch(() => null)
      const message = responseBody?.Messages?.[0]
      const providerMessageId =
        message?.To?.[0]?.MessageID != null
          ? String(message.To[0].MessageID)
          : null

      if (mailjetResponse.ok && message?.Status === 'success') {
        sentCount += 1
        results.push({
          student_id: recipient.id,
          email: recipient.email,
          status: 'sent',
          provider_message_id: providerMessageId,
        })

        await adminClient.from('email_logs').insert({
          student_id: recipient.id,
          recipient_email: recipient.email,
          subject,
          provider: 'mailjet',
          status: 'sent',
          sent_at: new Date().toISOString(),
          metadata: {
            audience,
            dry_run: false,
            provider_message_id: providerMessageId,
            last_paid_at: recipient.last_paid_at,
            sent_by: requester.id,
            selection_mode: selectionResult.selection_mode,
            requested_count: selectionResult.requested_count,
            selected_count: selectionResult.selected_count,
          },
        })
      } else {
        failedCount += 1
        const errorMessage =
          message?.Errors?.[0]?.ErrorMessage ??
          responseBody?.ErrorMessage ??
          `Mailjet respondio HTTP ${mailjetResponse.status}.`

        results.push({
          student_id: recipient.id,
          email: recipient.email,
          status: 'failed',
          error: errorMessage,
        })

        await adminClient.from('email_logs').insert({
          student_id: recipient.id,
          recipient_email: recipient.email,
          subject,
          provider: 'mailjet',
          status: 'failed',
          metadata: {
            audience,
            dry_run: false,
            error: errorMessage,
            last_paid_at: recipient.last_paid_at,
            sent_by: requester.id,
            selection_mode: selectionResult.selection_mode,
            requested_count: selectionResult.requested_count,
            selected_count: selectionResult.selected_count,
          },
        })
      }
    } catch (error) {
      failedCount += 1
      const errorMessage =
        error instanceof Error ? error.message : 'No se pudo enviar el email.'

      results.push({
        student_id: recipient.id,
        email: recipient.email,
        status: 'failed',
        error: errorMessage,
      })

      await adminClient.from('email_logs').insert({
        student_id: recipient.id,
        recipient_email: recipient.email,
        subject,
        provider: 'mailjet',
        status: 'failed',
        metadata: {
          audience,
          dry_run: false,
          error: errorMessage,
          last_paid_at: recipient.last_paid_at,
          sent_by: requester.id,
          selection_mode: selectionResult.selection_mode,
          requested_count: selectionResult.requested_count,
          selected_count: selectionResult.selected_count,
        },
      })
    }
  }

  await adminClient.from('audit_logs').insert({
    actor_id: requester.id,
    entity_type: 'email',
    action: 'email.mass_sent',
    metadata: {
      audience,
      subject,
      selection_mode: selectionResult.selection_mode,
      requested_count: selectionResult.requested_count,
      eligible_count: eligibleRecipients.length,
      selected_count: selectionResult.selected_count,
      sent_count: sentCount,
      failed_count: failedCount,
      provider: 'mailjet',
    },
  })

  return jsonResponse({
    audience,
    dryRun: false,
    eligible_count: eligibleRecipients.length,
    sent_count: sentCount,
    failed_count: failedCount,
    skipped_count: 0,
    selection_mode: selectionResult.selection_mode,
    requested_count: selectionResult.requested_count,
    selected_count: selectionResult.selected_count,
    ignored_count: selectionResult.ignored_count,
    recipients: results,
  })
})
