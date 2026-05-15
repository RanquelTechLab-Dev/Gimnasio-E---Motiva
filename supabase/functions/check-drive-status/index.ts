import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

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

async function getGoogleAccessToken() {
  const clientId = Deno.env.get('GOOGLE_CLIENT_ID')
  const clientSecret = Deno.env.get('GOOGLE_CLIENT_SECRET')
  const refreshToken = Deno.env.get('GOOGLE_REFRESH_TOKEN')

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error('Faltan credenciales OAuth de Google Drive.')
  }

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  })
  const body = await response.json().catch(() => null)
  if (!response.ok || !body?.access_token) {
    throw new Error('No se pudo autenticar Google Drive.')
  }
  return String(body.access_token)
}

async function getDriveQuota(accessToken: string) {
  const response = await fetch(
    'https://www.googleapis.com/drive/v3/about?fields=storageQuota',
    { headers: { Authorization: `Bearer ${accessToken}` } },
  )
  const body = await response.json().catch(() => null)
  if (!response.ok) {
    throw new Error('No se pudo consultar el espacio de Google Drive.')
  }

  const used = Number(body?.storageQuota?.usage ?? 0)
  const limit =
    body?.storageQuota?.limit == null ? null : Number(body.storageQuota.limit)
  const remaining = limit === null ? null : Math.max(limit - used, 0)
  const remainingRatio =
    limit === null || limit === 0 ? null : remaining === null ? null : remaining / limit

  return {
    used_bytes: used,
    total_bytes: limit,
    remaining_bytes: remaining,
    remaining_ratio: remainingRatio,
    warning: remainingRatio !== null && remainingRatio <= 0.1,
  }
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

  const token = (req.headers.get('Authorization') ?? '').replace('Bearer ', '').trim()
  if (!token) {
    return jsonResponse({ error: 'Sesion admin requerida.' }, 401)
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const {
    data: { user: requester },
    error: authError,
  } = await adminClient.auth.getUser(token)
  if (authError || !requester) {
    return jsonResponse({ error: 'Sesion admin invalida.' }, 401)
  }

  const { data: profile, error: profileError } = await adminClient
    .from('profiles')
    .select('id, role, active')
    .eq('id', requester.id)
    .single()
  if (profileError || !profile || profile.role !== 'admin' || profile.active !== true) {
    return jsonResponse({ error: 'Solo un admin activo puede consultar Drive.' }, 403)
  }

  try {
    const quota = await getDriveQuota(await getGoogleAccessToken())
    await adminClient.from('drive_status').insert({
      used_bytes: quota.used_bytes,
      total_bytes: quota.total_bytes,
      warning_threshold: 0.9,
      checked_at: new Date().toISOString(),
    })
    await adminClient.from('audit_logs').insert({
      actor_id: requester.id,
      entity_type: 'drive_status',
      action: 'drive_status.checked',
      metadata: quota,
    })
    return jsonResponse(quota)
  } catch (error) {
    return jsonResponse(
      { error: error instanceof Error ? error.message : 'No se pudo consultar Drive.' },
      500,
    )
  }
})
