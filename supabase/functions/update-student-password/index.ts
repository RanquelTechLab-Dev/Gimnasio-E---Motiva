import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

type UpdateStudentPasswordPayload = {
  student_id?: string
  password?: string
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

  let payload: UpdateStudentPasswordPayload
  try {
    payload = await req.json()
  } catch {
    return jsonResponse({ error: 'JSON invalido.' }, 400)
  }

  const studentId = cleanText(payload.student_id)
  const password = cleanText(payload.password)

  if (!studentId || !password) {
    return jsonResponse(
      { error: 'Alumno y nueva contrasena son requeridos.' },
      400,
    )
  }

  if (password.length < 8) {
    return jsonResponse(
      { error: 'La nueva contrasena debe tener al menos 8 caracteres.' },
      400,
    )
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
      { error: 'Solo un admin activo puede cambiar contrasenas de alumnos.' },
      403,
    )
  }

  const { data: studentProfile, error: studentProfileError } = await adminClient
    .from('profiles')
    .select('id, role, email, active')
    .eq('id', studentId)
    .single()

  if (
    studentProfileError ||
    !studentProfile ||
    studentProfile.role !== 'student'
  ) {
    return jsonResponse({ error: 'Alumno no encontrado.' }, 404)
  }

  const { error: updateUserError } =
    await adminClient.auth.admin.updateUserById(studentId, {
      password,
    })

  if (updateUserError) {
    return jsonResponse(
      { error: updateUserError.message ?? 'No se pudo cambiar la contrasena.' },
      400,
    )
  }

  const { error: auditError } = await adminClient.from('audit_logs').insert({
    actor_id: requester.id,
    entity_type: 'profile',
    entity_id: studentId,
    action: 'student.password_updated',
    metadata: {
      email: studentProfile.email,
      active: studentProfile.active,
    },
  })

  if (auditError) {
    return jsonResponse(
      {
        error:
          'Contrasena actualizada, pero fallo la auditoria. Requiere revision manual.',
        student_id: studentId,
        detail: auditError.message,
      },
      500,
    )
  }

  return jsonResponse({
    action: 'updated',
    student_id: studentId,
  })
})
