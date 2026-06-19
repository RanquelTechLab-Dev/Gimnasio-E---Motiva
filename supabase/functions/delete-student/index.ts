import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

type DeletePreview = {
  student_id: string
  student_email: string
  student_name: string
  counts: {
    attendance: number
    bookings: number
    payments: number
    memberships: number
    files: number
    training_notes: number
    fixed_schedules: number
    email_logs: number
    audit_logs: number
  }
  drive_files: Array<{
    file_id: string
    title: string
    drive_file_id: string | null
  }>
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

function cleanUuid(value: unknown) {
  const text = cleanText(value)
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    text,
  )
    ? text
    : ''
}

function toBoolean(value: unknown) {
  if (typeof value === 'boolean') {
    return value
  }
  const text = cleanText(value).toLowerCase()
  return text === 'true' || text === '1' || text === 'yes'
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
  const body = (await response.json().catch(() => null)) as
    | { access_token?: unknown }
    | null
  if (!response.ok || typeof body?.access_token !== 'string') {
    throw new Error('No se pudo autenticar Google Drive.')
  }
  return body.access_token
}

async function deleteDriveFile(accessToken: string, fileId: string) {
  const response = await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}?supportsAllDrives=true`,
    {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${accessToken}` },
    },
  )

  if (response.ok || response.status === 404) {
    return { drive_file_id: fileId, status: response.status || 204 }
  }

  const body = (await response.json().catch(() => null)) as
    | { error?: { message?: unknown } }
    | null
  const message =
    typeof body?.error?.message === 'string'
      ? body.error.message
      : 'No se pudo borrar archivo en Drive.'
  throw new Error(`Drive ${response.status}: ${message}`)
}

async function requireActiveAdmin(
  adminClient: ReturnType<typeof createClient>,
  token: string,
) {
  const {
    data: { user },
    error: authError,
  } = await adminClient.auth.getUser(token)

  if (authError || !user) {
    throw new Response(JSON.stringify({ error: 'Sesion admin invalida.' }), {
      status: 401,
    })
  }

  const { data: profile, error: profileError } = await adminClient
    .from('profiles')
    .select('id, role, active')
    .eq('id', user.id)
    .single()

  if (
    profileError ||
    !profile ||
    profile.role !== 'admin' ||
    profile.active !== true
  ) {
    throw new Response(
      JSON.stringify({ error: 'Solo un admin activo puede eliminar alumnos.' }),
      { status: 403 },
    )
  }

  return user
}

async function countRows(
  adminClient: ReturnType<typeof createClient>,
  table: string,
  column: string,
  value: string,
) {
  const { count, error } = await adminClient
    .from(table)
    .select('id', { count: 'exact', head: true })
    .eq(column, value)

  if (error) {
    throw error
  }

  return count ?? 0
}

async function buildPreview(
  adminClient: ReturnType<typeof createClient>,
  studentId: string,
): Promise<DeletePreview> {
  const { data: student, error: studentError } = await adminClient
    .from('profiles')
    .select('id, role, first_name, last_name, email')
    .eq('id', studentId)
    .single()

  if (studentError || !student) {
    throw new Error('Alumno no encontrado.')
  }

  if (student.role !== 'student') {
    throw new Error('La eliminacion definitiva solo permite alumnos.')
  }

  const { data: files, error: filesError } = await adminClient
    .from('files')
    .select('id, title, drive_file_id')
    .eq('student_id', studentId)

  if (filesError) {
    throw filesError
  }

  const auditByEntity = await adminClient
    .from('audit_logs')
    .select('id', { count: 'exact', head: true })
    .eq('entity_id', studentId)
  const auditByActor = await adminClient
    .from('audit_logs')
    .select('id', { count: 'exact', head: true })
    .eq('actor_id', studentId)

  if (auditByEntity.error) {
    throw auditByEntity.error
  }
  if (auditByActor.error) {
    throw auditByActor.error
  }

  return {
    student_id: student.id,
    student_email: student.email,
    student_name: [student.first_name, student.last_name].filter(Boolean).join(' '),
    counts: {
      attendance: await countRows(adminClient, 'attendance', 'student_id', studentId),
      bookings: await countRows(adminClient, 'bookings', 'student_id', studentId),
      payments: await countRows(adminClient, 'payments', 'student_id', studentId),
      memberships: await countRows(adminClient, 'memberships', 'student_id', studentId),
      files: files?.length ?? 0,
      training_notes: await countRows(adminClient, 'training_notes', 'student_id', studentId),
      fixed_schedules: await countRows(
        adminClient,
        'student_fixed_schedules',
        'student_id',
        studentId,
      ),
      email_logs: await countRows(adminClient, 'email_logs', 'student_id', studentId),
      audit_logs: (auditByEntity.count ?? 0) + (auditByActor.count ?? 0),
    },
    drive_files: (files ?? []).map((file) => ({
      file_id: file.id,
      title: file.title,
      drive_file_id: file.drive_file_id,
    })),
  }
}

async function deleteFromTable(
  adminClient: ReturnType<typeof createClient>,
  table: string,
  column: string,
  value: string,
) {
  const { error } = await adminClient.from(table).delete().eq(column, value)
  if (error) {
    throw error
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: 200, headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Metodo no permitido.' }, 405)
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse({ error: 'Configuracion segura incompleta.' }, 500)
  }

  const token = (req.headers.get('Authorization') ?? '')
    .replace('Bearer ', '')
    .trim()

  if (!token) {
    return jsonResponse({ error: 'Sesion admin requerida.' }, 401)
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  let requester: { id: string }
  try {
    requester = await requireActiveAdmin(adminClient, token)
  } catch (error) {
    if (error instanceof Response) {
      return new Response(error.body, {
        status: error.status,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
        },
      })
    }
    return jsonResponse({ error: 'No se pudo validar admin.' }, 401)
  }

  const body = await req.json().catch(() => null)
  const studentId = cleanUuid(body?.studentId ?? body?.student_id)
  const targetEmail = cleanText(body?.targetEmail ?? body?.target_email).toLowerCase()
  const confirmText = cleanText(body?.confirmText ?? body?.confirm_text)
  const dryRun = toBoolean(body?.dryRun ?? body?.dry_run)

  if (!studentId) {
    return jsonResponse({ error: 'Falta alumno valido.' }, 400)
  }

  let preview: DeletePreview
  try {
    preview = await buildPreview(adminClient, studentId)
  } catch (error) {
    return jsonResponse(
      { error: error instanceof Error ? error.message : 'No se pudo preparar preview.' },
      400,
    )
  }

  if (targetEmail !== preview.student_email.toLowerCase()) {
    return jsonResponse(
      { error: 'El email de confirmacion no coincide con el alumno.', preview },
      400,
    )
  }

  if (dryRun) {
    return jsonResponse({
      dryRun: true,
      deleted: false,
      preview,
      required_confirmation: 'ELIMINAR',
    })
  }

  if (confirmText !== 'ELIMINAR') {
    return jsonResponse(
      {
        error: 'Confirmacion invalida. Escribi ELIMINAR.',
        preview,
        required_confirmation: 'ELIMINAR',
      },
      400,
    )
  }

  const driveDeletes: Array<{ drive_file_id: string; status: number }> = []
  const driveFailures: Array<{ drive_file_id: string; error: string }> = []
  const driveFileIds = preview.drive_files
    .map((file) => file.drive_file_id)
    .filter((fileId): fileId is string => Boolean(fileId))

  if (driveFileIds.length > 0) {
    let accessToken: string
    try {
      accessToken = await getGoogleAccessToken()
    } catch (error) {
      return jsonResponse(
        {
          error:
            error instanceof Error
              ? error.message
              : 'No se pudo autenticar Drive.',
          preview,
          drive_deleted: false,
          database_deleted: false,
        },
        502,
      )
    }

    for (const fileId of driveFileIds) {
      try {
        driveDeletes.push(await deleteDriveFile(accessToken, fileId))
      } catch (error) {
        driveFailures.push({
          drive_file_id: fileId,
          error: error instanceof Error ? error.message : 'Fallo Drive.',
        })
      }
    }
  }

  if (driveFailures.length > 0) {
    return jsonResponse(
      {
        error: 'No se borro DB porque fallo el borrado de Drive.',
        preview,
        drive_deleted: driveDeletes.length > 0,
        drive_failures: driveFailures,
        database_deleted: false,
      },
      502,
    )
  }

  try {
    await deleteFromTable(adminClient, 'attendance', 'student_id', studentId)
    await deleteFromTable(adminClient, 'bookings', 'student_id', studentId)
    await deleteFromTable(adminClient, 'student_fixed_schedules', 'student_id', studentId)
    await deleteFromTable(adminClient, 'files', 'student_id', studentId)
    await deleteFromTable(adminClient, 'training_notes', 'student_id', studentId)
    await deleteFromTable(adminClient, 'payments', 'student_id', studentId)
    await deleteFromTable(adminClient, 'memberships', 'student_id', studentId)
    await deleteFromTable(adminClient, 'email_logs', 'student_id', studentId)
    await deleteFromTable(adminClient, 'audit_logs', 'entity_id', studentId)
    await deleteFromTable(adminClient, 'audit_logs', 'actor_id', studentId)

    const { error: profileError } = await adminClient
      .from('profiles')
      .delete()
      .eq('id', studentId)
      .eq('role', 'student')

    if (profileError) {
      throw profileError
    }
  } catch (error) {
    return jsonResponse(
      {
        error:
          error instanceof Error
            ? error.message
            : 'Fallo borrado de DB despues de Drive.',
        preview,
        drive_deleted: driveDeletes.length > 0,
        database_deleted: false,
        retry_required: true,
      },
      500,
    )
  }

  const { error: authDeleteError } = await adminClient.auth.admin.deleteUser(studentId)
  const authCleanupRequired = Boolean(authDeleteError)

  await adminClient.from('audit_logs').insert({
    actor_id: requester.id,
    entity_type: 'student',
    entity_id: studentId,
    action: 'student_definitive_delete',
    metadata: {
      counts: preview.counts,
      drive_file_count: driveFileIds.length,
      drive_deleted_count: driveDeletes.length,
      database_deleted: true,
      auth_deleted: !authCleanupRequired,
      auth_cleanup_required: authCleanupRequired,
    },
  })

  return jsonResponse({
    dryRun: false,
    deleted: true,
    preview,
    drive_deleted_count: driveDeletes.length,
    database_deleted: true,
    auth_deleted: !authCleanupRequired,
    auth_cleanup_required: authCleanupRequired,
    warning: authCleanupRequired
      ? 'El alumno se borro de DB, pero requiere limpieza manual/reintento en Auth.'
      : null,
  })
})