import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.105.4'
import {
  classifyPaymentReminderRequest,
  createReminderRpcDependencies,
  executeControlledE2EFromRuntime,
  getReminderReconciliationRequiredResponse,
  PaymentReminderRequestError,
  PRODUCTION_SEND_BLOCKED_MESSAGE,
  type ReminderRpcClient,
} from './controlled_e2e.ts'
import { createMailjetAdapter, readMailjetConfig } from './mailjet_adapter.ts'
import {
  getDateInTimeZone,
  validateDryRunPayload,
} from './reminder_logic.ts'
import { handleClassifiedPaymentReminderRequest } from './reminder_request_handler.ts'
import {
  createReminderSelectorDependencies,
  ReminderSelectorError,
  selectPaymentReminderCandidates,
  type ReminderSelectorClient,
} from './reminder_selector.ts'
import {
  runScheduledPreview,
  runScheduledProduction,
} from './scheduled_worker.ts'

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

  let rawPayload: unknown
  try {
    rawPayload = await request.json()
  } catch {
    return jsonResponse({ error: 'JSON invalido.' }, 400)
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

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  })

  const selectorDependencies = createReminderSelectorDependencies(
    adminClient as unknown as ReminderSelectorClient,
  )
  const selectCandidates = (evaluationDate: string) =>
    selectPaymentReminderCandidates(evaluationDate, selectorDependencies)

  const response = await handleClassifiedPaymentReminderRequest(
    mode,
    {
      authorization: request.headers.get('Authorization'),
      cronSecret: request.headers.get('x-e-motiva-cron-secret'),
    },
    {
      auth: {
        getEnv: (name) => Deno.env.get(name),
        async getUser(token) {
          const {
            data: { user },
            error,
          } = await adminClient.auth.getUser(token)
          return error || !user ? null : { id: user.id }
        },
        async getProfile(userId) {
          const { data, error } = await adminClient
            .from('profiles')
            .select('role, active')
            .eq('id', userId)
            .single()
          return error || !data
            ? null
            : { role: data.role, active: data.active }
        },
      },
      async executeControlledE2E(payload) {
        try {
          const result = await executeControlledE2EFromRuntime(payload, {
            client: adminClient,
            getEnv: (name) => Deno.env.get(name),
            fetchImpl: fetch,
          })
          if (result.state === 'uncertain') {
            return {
              status: 503,
              body: {
                ...result,
                reconciliation_required: true,
                desired_status: 'uncertain',
              },
            }
          }
          return {
            status: result.state === 'failed' ? 502 : 200,
            body: result,
          }
        } catch (error) {
          const reconciliationResponse =
            getReminderReconciliationRequiredResponse(error)
          return reconciliationResponse === null
            ? {
                status: 500,
                body: {
                  error: 'No se pudo ejecutar la prueba E2E controlada.',
                },
              }
            : { status: 503, body: reconciliationResponse }
        }
      },
      async executeScheduledPreview() {
        try {
          return await runScheduledPreview({
            now: () => new Date(),
            selectCandidates,
          })
        } catch {
          return {
            status: 500,
            body: { error: 'No se pudo evaluar la audiencia programada.' },
          }
        }
      },
      async executeScheduledProduction() {
        try {
          return await runScheduledProduction({
            now: () => new Date(),
            getEnv: (name) => Deno.env.get(name),
            selectCandidates,
            createDeliveryDependencies: () => {
              const mailjet = createMailjetAdapter(
                readMailjetConfig((name) => Deno.env.get(name)),
                fetch,
              )
              return createReminderRpcDependencies(
                adminClient as unknown as ReminderRpcClient,
                mailjet,
              )
            },
          })
        } catch {
          return {
            status: 500,
            body: {
              error: 'No se pudo ejecutar el worker de recordatorios.',
            },
          }
        }
      },
      async executeDryRun() {
        const payload = validateDryRunPayload(rawPayload)
        if (!payload.valid) {
          return { status: 400, body: { error: payload.error } }
        }

        const evaluationDate =
          payload.value.evaluationDate ?? getDateInTimeZone(new Date())

        try {
          const candidates = await selectCandidates(evaluationDate)
          return {
            status: 200,
            body: {
              evaluation_date: evaluationDate,
              timezone: 'America/Argentina/Cordoba',
              eligible_count: candidates.eligible.length,
              excluded_count: candidates.excluded.length,
              eligible: candidates.eligible.map((candidate) => ({
                student_id: candidate.student_id,
                membership_id: candidate.membership_id,
                email: candidate.recipient_email,
                due_date: candidate.due_date,
                offset_days: candidate.offset_days,
                idempotency_key: candidate.idempotency_key,
              })),
              excluded: candidates.excluded.map((candidate) => ({
                student_id: candidate.student_id,
                membership_id: candidate.membership_id,
                email: candidate.recipient_email,
                due_date: candidate.due_date,
                reason: candidate.reason,
              })),
            },
          }
        } catch (error) {
          if (error instanceof ReminderSelectorError) {
            const selectorError =
              error.code === 'memberships_query_failed'
                ? 'No se pudieron consultar las membresias candidatas.'
                : error.code === 'profiles_query_failed'
                  ? 'No se pudieron consultar los perfiles de alumnos.'
                  : 'La paginacion de membresias fue invalida.'
            return { status: 500, body: { error: selectorError } }
          }
          return {
            status: 500,
            body: {
              error: 'No se pudo evaluar la audiencia de recordatorios.',
            },
          }
        }
      },
    },
  )

  return jsonResponse(response.body, response.status)
})
