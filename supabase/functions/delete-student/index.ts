import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

type DeleteStudentPayload = {
  student_id?: string
  confirm?: string
}

type DeleteStudentPreview = {
  ok: boolean
  affected: Record<string, number>
  warnings?: string[]
  details?: {
    drive_file_ids?: string[]
    confirmation_required?: string
    email?: string
    full_name?: string
  }
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

async function deleteDriveFile(accessToken: string, fileId: string) {
  const response = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${accessToken}` },
  })

  if (!response.ok && response.status !== 404) {
    throw new Error('No se pudo borrar un archivo en Google Drive.')
  }
}

async function ensureAdmin(
  adminClient: ReturnType<typeof createClient>,
  token: string,
) {
  const {
    data: { user: requester },
    error: authError,
  } = await adminClient.auth.getUser(token)

  if (authError || !requester) {
    throw new Error('SESSION_INVALID')
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
    throw new Error('SESSION_FORBIDDEN')
  }

  return requester
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Metodo no permitido.' }, 405)
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const anonKey =
    Deno.env.get('SUPABASE_ANON_KEY') ??
    Deno.env.get('SUPABASE_PUBLISHABLE_KEY')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
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

  let payload: DeleteStudentPayload
  try {
    payload = await req.json()
  } catch {
    return jsonResponse({ error: 'JSON invalido.' }, 400)
  }

  const studentId = cleanText(payload.student_id)
  const confirmation = cleanText(payload.confirm)

  if (!studentId) {
    return jsonResponse({ error: 'Alumno requerido.' }, 400)
  }

  if (!confirmation) {
    return jsonResponse(
      {
        error:
          'Debes escribir ELIMINAR ALUMNO DEFINITIVAMENTE para continuar.',
      },
      400,
    )
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  })
  const userClient = createClient(supabaseUrl, anonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
    global: {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
  })

  let requester: { id: string }
  try {
    requester = await ensureAdmin(adminClient, token)
  } catch (error) {
    if (error instanceof Error && error.message === 'SESSION_INVALID') {
      return jsonResponse({ error: 'Sesion admin invalida.' }, 401)
    }

    if (error instanceof Error && error.message === 'SESSION_FORBIDDEN') {
      return jsonResponse(
        { error: 'Solo un admin activo puede eliminar alumnos.' },
        403,
      )
    }

    return jsonResponse({ error: 'No se pudo validar la sesion admin.' }, 500)
  }

  if (studentId === requester.id) {
    return jsonResponse(
      { error: 'No podes eliminar tu propio usuario desde esta accion.' },
      403,
    )
  }

  const { data: previewData, error: previewError } = await userClient.rpc(
    'admin_preview_delete_student',
    {
      p_profile_id: studentId,
    },
  )

  if (previewError) {
    const status = previewError.message?.includes('admin') ? 403 : 400
    return jsonResponse({ error: previewError.message }, status)
  }

  const preview = previewData as DeleteStudentPreview
  const driveFileIds = Array.isArray(preview?.details?.drive_file_ids)
    ? preview.details.drive_file_ids.filter(
        (value): value is string => typeof value === 'string' && value.trim().length > 0,
      )
    : []

  if (
    confirmation !==
    (preview?.details?.confirmation_required ?? 'ELIMINAR ALUMNO DEFINITIVAMENTE')
  ) {
    return jsonResponse(
      {
        error:
          'La confirmacion no coincide. Debes escribir ELIMINAR ALUMNO DEFINITIVAMENTE.',
      },
      400,
    )
  }

  const deletedDriveFileIds: string[] = []
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
              : 'No se pudo autenticar Google Drive.',
          preview,
        },
        500,
      )
    }

    for (const driveFileId of driveFileIds) {
      try {
        await deleteDriveFile(accessToken, driveFileId)
        deletedDriveFileIds.push(driveFileId)
      } catch (error) {
        return jsonResponse(
          {
            error:
              error instanceof Error
                ? error.message
                : 'No se pudo borrar un archivo en Google Drive.',
            failed_drive_file_id: driveFileId,
            deleted_drive_file_ids: deletedDriveFileIds,
            preview,
          },
          500,
        )
      }
    }
  }

  const { data: deleteData, error: deleteError } = await userClient.rpc(
    'admin_delete_student_database',
    {
      p_profile_id: studentId,
      p_confirm: confirmation,
    },
  )

  if (deleteError) {
    return jsonResponse(
      {
        error: deleteError.message,
        deleted_drive_file_ids: deletedDriveFileIds,
        preview,
      },
      500,
    )
  }

  const { error: deleteAuthError } =
    await adminClient.auth.admin.deleteUser(studentId)

  if (deleteAuthError) {
    return jsonResponse(
      {
        error:
          deleteAuthError.message ??
          'La base se limpio, pero fallo el borrado del usuario Auth.',
        database_deleted: true,
        auth_cleanup_required: true,
        deleted_drive_file_ids: deletedDriveFileIds,
        preview,
        result: deleteData,
      },
      500,
    )
  }

  return jsonResponse({
    ...(deleteData as Record<string, unknown>),
    deleted_drive_file_ids: deletedDriveFileIds,
    preview,
    auth_user_deleted: true,
  })
})
