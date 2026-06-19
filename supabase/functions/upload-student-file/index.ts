import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

type DriveQuota = {
  used_bytes: number
  total_bytes: number | null
  remaining_bytes: number | null
  remaining_ratio: number | null
  warning: boolean
}

type DriveShareResult = {
  mode: 'not_requested' | 'student_email' | 'anyone_with_link'
  warning: string | null
}

class GoogleDriveRequestError extends Error {
  status: number
  reason: string | null

  constructor(message: string, status: number, reason: string | null) {
    super(message)
    this.name = 'GoogleDriveRequestError'
    this.status = status
    this.reason = reason
  }
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const maxFileSize = 10 * 1024 * 1024
const allowedMimeTypes = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'text/plain',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
])
const allowedKinds = new Set(['training_plan', 'observation', 'attachment'])

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
    },
  })
}

function cleanText(value: FormDataEntryValue | null) {
  return typeof value === 'string' ? value.trim() : ''
}

function cleanBoolean(value: FormDataEntryValue | null) {
  const normalized = cleanText(value).toLowerCase()
  return normalized === 'false' || normalized === '0' || normalized === 'no'
    ? false
    : true
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

function concatBytes(parts: Uint8Array[]) {
  const total = parts.reduce((sum, part) => sum + part.length, 0)
  const result = new Uint8Array(total)
  let offset = 0
  for (const part of parts) {
    result.set(part, offset)
    offset += part.length
  }
  return result
}

function safeFileName(fileName: string) {
  return fileName.replace(/[^\w.\- ]+/g, '_').slice(0, 120) || 'archivo'
}

function resolvedMimeType(file: File) {
  if (file.type) {
    return file.type
  }

  return file.name.toLowerCase().endsWith('.txt')
    ? 'text/plain'
    : 'application/octet-stream'
}

function safeUploadLog(message: string, metadata: Record<string, unknown>) {
  console.log(
    JSON.stringify({
      event: 'upload-student-file',
      message,
      ...metadata,
    }),
  )
}

function buildGoogleDriveError(
  status: number,
  body: unknown,
  fallbackMessage: string,
) {
  const payload = body && typeof body === 'object' ? body as { error?: { message?: unknown; errors?: Array<{ reason?: unknown }> } } : null
  const error = payload?.error
  const reason = Array.isArray(error?.errors)
    ? String(error.errors[0]?.reason ?? '')
    : ''
  const message =
    typeof error?.message === 'string' && error.message.trim()
      ? error.message.trim()
      : fallbackMessage

  return new GoogleDriveRequestError(
    `${fallbackMessage} (${status}: ${message})`,
    status,
    reason || null,
  )
}

async function uploadToDrive(
  accessToken: string,
  rootFolderId: string,
  file: File,
  mimeType: string,
  title: string,
  description: string | null,
) {
  const boundary = `emotiva_${crypto.randomUUID()}`
  const metadata = {
    name: `${title} - ${safeFileName(file.name)}`,
    parents: [rootFolderId],
    description: description ?? undefined,
  }
  const encoder = new TextEncoder()
  const fileBytes = new Uint8Array(await file.arrayBuffer())
  const body = concatBytes([
    encoder.encode(
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(
        metadata,
      )}\r\n`,
    ),
    encoder.encode(
      `--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`,
    ),
    fileBytes,
    encoder.encode(`\r\n--${boundary}--\r\n`),
  ])

  const response = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id,name,webViewLink,mimeType,size',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': `multipart/related; boundary=${boundary}`,
      },
      body,
    },
  )
  const responseBody = await response.json().catch(() => null)
  if (!response.ok || !responseBody?.id) {
    throw buildGoogleDriveError(
      response.status,
      responseBody,
      'No se pudo subir el archivo a Google Drive.',
    )
  }
  return responseBody as {
    id: string
    name?: string
    webViewLink?: string
    mimeType?: string
    size?: string
  }
}

async function grantReaderPermission(
  accessToken: string,
  fileId: string,
  email: string,
) {
  const response = await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}/permissions?sendNotificationEmail=false&supportsAllDrives=true&fields=id,type,role,emailAddress`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        type: 'user',
        role: 'reader',
        emailAddress: email,
      }),
    },
  )
  const responseBody = await response.json().catch(() => null)
  if (!response.ok) {
    throw buildGoogleDriveError(
      response.status,
      responseBody,
      'No se pudo dar acceso de lectura al alumno en Drive.',
    )
  }
}

async function grantAnyoneWithLinkPermission(
  accessToken: string,
  fileId: string,
) {
  const response = await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}/permissions?supportsAllDrives=true&fields=id,type,role`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        type: 'anyone',
        role: 'reader',
        allowFileDiscovery: false,
      }),
    },
  )
  const responseBody = await response.json().catch(() => null)
  if (!response.ok) {
    throw buildGoogleDriveError(
      response.status,
      responseBody,
      'No se pudo habilitar acceso por enlace en Drive.',
    )
  }
}

async function shareDriveFileForStudent(
  accessToken: string,
  fileId: string,
  email: string | null,
  visibleToStudent: boolean,
): Promise<DriveShareResult> {
  if (!visibleToStudent) {
    return { mode: 'not_requested', warning: null }
  }

  if (email) {
    try {
      await grantReaderPermission(accessToken, fileId, email)
      return { mode: 'student_email', warning: null }
    } catch (error) {
      safeUploadLog('student email share failed; falling back to link share', {
        drive_status: error instanceof GoogleDriveRequestError ? error.status : null,
        drive_reason: error instanceof GoogleDriveRequestError ? error.reason : null,
        student_email_domain: email.split('@')[1] ?? null,
      })
    }
  }

  await grantAnyoneWithLinkPermission(accessToken, fileId)
  return {
    mode: 'anyone_with_link',
    warning:
      'No se pudo compartir por email; se habilito acceso de lectura por enlace.',
  }
}

async function deleteDriveFile(accessToken: string, fileId: string) {
  await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?supportsAllDrives=true`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${accessToken}` },
  }).catch(() => null)
}

async function getDriveQuota(accessToken: string): Promise<DriveQuota> {
  const response = await fetch(
    'https://www.googleapis.com/drive/v3/about?fields=storageQuota',
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    },
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

async function recordDriveStatus(
  adminClient: ReturnType<typeof createClient>,
  quota: DriveQuota,
) {
  await adminClient.from('drive_status').insert({
    used_bytes: quota.used_bytes,
    total_bytes: quota.total_bytes,
    warning_threshold: 0.9,
    checked_at: new Date().toISOString(),
  })
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
  const rootFolderId = Deno.env.get('GOOGLE_DRIVE_ROOT_FOLDER_ID')

  if (!supabaseUrl || !serviceRoleKey || !rootFolderId) {
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
    return jsonResponse({ error: 'Solo un admin activo puede subir archivos.' }, 403)
  }

  let formData: FormData
  try {
    formData = await req.formData()
  } catch {
    return jsonResponse({ error: 'Formulario invalido.' }, 400)
  }

  const studentId =
    cleanText(formData.get('student_id')) ||
    cleanText(formData.get('studentId')) ||
    cleanText(formData.get('profile_id'))
  const rawTitle = cleanText(formData.get('title'))
  const description = cleanText(formData.get('description')) || null
  const kind =
    cleanText(formData.get('kind')) ||
    cleanText(formData.get('file_kind')) ||
    'attachment'
  const visibleToStudent = cleanBoolean(
    formData.get('visible_to_student') ?? formData.get('visibleToStudent'),
  )
  const fileFieldNames = ['file', 'document', 'upload']
  const fileFieldName =
    fileFieldNames.find((fieldName) => formData.get(fieldName) instanceof File) ??
    fileFieldNames.find((fieldName) => formData.has(fieldName)) ??
    'file'
  const file = formData.get(fileFieldName)
  const hasFile = file instanceof File

  safeUploadLog('form parsed', {
    method: req.method,
    content_type: req.headers.get('content-type') ?? null,
    form_keys: Array.from(formData.keys()),
    has_student_id: Boolean(studentId),
    kind,
    visible_to_student: visibleToStudent,
    file_field: hasFile ? fileFieldName : null,
    has_file: hasFile,
    file_name: hasFile ? file.name : null,
    file_size: hasFile ? file.size : null,
    file_type: hasFile ? resolvedMimeType(file) : null,
  })

  if (!studentId) {
    return jsonResponse({ error: 'Falta alumno seleccionado.' }, 400)
  }

  if (!allowedKinds.has(kind)) {
    return jsonResponse({ error: 'Tipo de archivo invalido.' }, 400)
  }

  if (!(file instanceof File)) {
    return jsonResponse({ error: 'Falta archivo.' }, 400)
  }

  if (file.size <= 0) {
    return jsonResponse({ error: 'El archivo esta vacio.' }, 400)
  }

  if (file.size > maxFileSize) {
    return jsonResponse({ error: 'El archivo debe pesar hasta 10 MB.' }, 400)
  }

  const mimeType = resolvedMimeType(file)

  if (!allowedMimeTypes.has(mimeType)) {
    return jsonResponse(
      { error: `Tipo de archivo no permitido: ${mimeType}.` },
      400,
    )
  }

  const title = rawTitle || safeFileName(file.name)

  safeUploadLog('validated upload input', {
    student_id_present: true,
    kind,
    title,
    file_field: fileFieldName,
    file_name: file.name,
    file_size: file.size,
    file_type: mimeType,
    visible_to_student: visibleToStudent,
  })

  const { data: student, error: studentError } = await adminClient
    .from('profiles')
    .select('id, email, role, active')
    .eq('id', studentId)
    .single()

  if (
    studentError ||
    !student ||
    student.role !== 'student' ||
    student.active !== true
  ) {
    return jsonResponse({ error: 'Alumno invalido o inactivo.' }, 400)
  }

  let accessToken: string
  try {
    accessToken = await getGoogleAccessToken()
  } catch (error) {
    return jsonResponse(
      { error: error instanceof Error ? error.message : 'No se pudo conectar Drive.' },
      500,
    )
  }

  let driveFile: Awaited<ReturnType<typeof uploadToDrive>> | null = null
  let driveShare: DriveShareResult
  try {
    driveFile = await uploadToDrive(
      accessToken,
      rootFolderId,
      file,
      mimeType,
      title,
      description,
    )
    driveShare = await shareDriveFileForStudent(
      accessToken,
      driveFile.id,
      student.email,
      visibleToStudent,
    )
  } catch (error) {
    if (typeof driveFile?.id === 'string') {
      await deleteDriveFile(accessToken, driveFile.id)
    }
    return jsonResponse(
      { error: error instanceof Error ? error.message : 'No se pudo subir el archivo.' },
      500,
    )
  }

  if (!driveFile) {
    return jsonResponse({ error: 'No se pudo subir el archivo.' }, 500)
  }

  let quota: DriveQuota | null = null
  try {
    quota = await getDriveQuota(accessToken)
    await recordDriveStatus(adminClient, quota)
  } catch {
    // Upload should not fail only because quota telemetry is unavailable.
  }

  const { data: insertedFile, error: insertError } = await adminClient
    .from('files')
    .insert({
      student_id: studentId,
      kind,
      title,
      description,
      drive_file_id: driveFile.id,
      drive_url: driveFile.webViewLink ?? null,
      mime_type: driveFile.mimeType ?? mimeType,
      size_bytes: Number(driveFile.size ?? file.size),
      visible_to_student: visibleToStudent,
      uploaded_by: requester.id,
      updated_by: requester.id,
    })
    .select('*')
    .single()

  if (insertError || !insertedFile) {
    console.error(
      JSON.stringify({
        event: 'upload-student-file',
        message: 'metadata insert failed',
        error_code: insertError?.code ?? null,
        error_message: insertError?.message ?? null,
        error_details: insertError?.details ?? null,
      }),
    )
    await deleteDriveFile(accessToken, driveFile.id)
    return jsonResponse(
      { error: 'Archivo subido a Drive, pero fallo la metadata. Se limpio Drive.' },
      500,
    )
  }

  await adminClient.from('audit_logs').insert({
    actor_id: requester.id,
    entity_type: 'file',
    entity_id: insertedFile.id,
    action: 'file.uploaded',
    metadata: {
      student_id: studentId,
      kind,
      title,
      mime_type: insertedFile.mime_type,
      size_bytes: insertedFile.size_bytes,
      visible_to_student: visibleToStudent,
      drive_file_id: driveFile.id,
      drive_share_mode: driveShare.mode,
      drive_share_warning: driveShare.warning,
      drive_warning: quota?.warning ?? null,
    },
  })

  return jsonResponse({
    file: {
      ...insertedFile,
      file_id: insertedFile.id,
    },
    drive_status: quota,
    drive_share: driveShare,
  })
})
