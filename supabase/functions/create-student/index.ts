import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

type CreateStudentPayload = {
  first_name?: string
  last_name?: string
  email?: string
  phone?: string | null
  password?: string
  receives_emails?: boolean
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

  let payload: CreateStudentPayload
  try {
    payload = await req.json()
  } catch {
    return jsonResponse({ error: 'JSON invalido.' }, 400)
  }

  const firstName = cleanText(payload.first_name)
  const lastName = cleanText(payload.last_name)
  const email = cleanText(payload.email).toLowerCase()
  const phone = cleanText(payload.phone) || null
  const password = cleanText(payload.password)
  const receivesEmails = payload.receives_emails !== false

  if (!firstName || !lastName || !email || !password) {
    return jsonResponse(
      { error: 'Nombre, apellido, email y contrasena provisoria son requeridos.' },
      400,
    )
  }

  if (!email.includes('@')) {
    return jsonResponse({ error: 'Email invalido.' }, 400)
  }

  if (password.length < 8) {
    return jsonResponse(
      { error: 'La contrasena provisoria debe tener al menos 8 caracteres.' },
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
    return jsonResponse({ error: 'Solo un admin activo puede crear alumnos.' }, 403)
  }

  const { data: authUserData, error: createUserError } =
    await adminClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        first_name: firstName,
        last_name: lastName,
      },
    })

  if (createUserError || !authUserData.user) {
    return jsonResponse(
      { error: createUserError?.message ?? 'No se pudo crear el usuario Auth.' },
      400,
    )
  }

  const studentId = authUserData.user.id

  const { error: profileError } = await adminClient.from('profiles').insert({
    id: studentId,
    role: 'student',
    first_name: firstName,
    last_name: lastName,
    email,
    phone,
    active: true,
    receives_emails: receivesEmails,
  })

  if (profileError) {
    return jsonResponse(
      {
        error:
          'Usuario Auth creado, pero fallo la creacion del profile. Requiere revision manual.',
        auth_user_id: studentId,
        detail: profileError.message,
      },
      500,
    )
  }

  const { error: auditError } = await adminClient.from('audit_logs').insert({
    actor_id: requester.id,
    entity_type: 'profile',
    entity_id: studentId,
    action: 'student.created',
    metadata: {
      email,
      receives_emails: receivesEmails,
    },
  })

  if (auditError) {
    return jsonResponse(
      {
        error:
          'Alumno creado, pero fallo la auditoria. Requiere revision manual.',
        auth_user_id: studentId,
        detail: auditError.message,
      },
      500,
    )
  }

  return jsonResponse({
    student: {
      id: studentId,
      first_name: firstName,
      last_name: lastName,
      email,
      phone,
      active: true,
      receives_emails: receivesEmails,
    },
  })
})
