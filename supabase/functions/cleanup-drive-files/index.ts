import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

type DriveQuota = {
  used_bytes: number
  total_bytes: number | null
  remaining_bytes: number | null
  remaining_ratio: number | null
  warning: boolean
}

type CleanupRequest = {
  dryRun?: boolean
  force?: boolean
  maxFiles?: number
  studentId?: string | null
  fileId?: string | null
  fileIds?: string[] | null
}

type StudentCandidate = {
  student_id: string
  email: string | null
  first_name: string | null
  last_name: string | null
  last_payment_at: string | null
  last_real_activity_at: string | null
  last_attendance_at: string | null
  derived_last_activity_at: string | null
  eligible_file_count: number
  eligible_bytes: number
}

type MembershipRow = {
  student_id: string
  end_date: string | null
  updated_at: string | null
  status: string
}

type CleanupFile = {
  id: string
  student_id: string
  title: string
  kind: string
  drive_file_id: string | null
  drive_url: string | null
  size_bytes: number | null
  visible_to_student: boolean
  created_at: string
  archived_at?: string | null
}

type CleanupFailure = {
  file_id: string
  drive_file_id: string | null
  stage: 'drive_delete' | 'metadata_archive'
  error: string
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const defaultMaxFiles = 50
const maxAllowedFiles = 200
const warningThreshold = 0.1
const cleanupCriteria = {
  eligible_files: ['files.archived_at is null', 'files.drive_file_id is not null'],
  candidate_order:
    'oldest derived activity from last_real_activity_at, last_attendance_at, approved payments and memberships',
  excluded_students: ['profiles.role <> student', 'active membership with end_date >= current_date'],
  protected_data: [
    'payments',
    'memberships',
    'bookings',
    'attendance',
    'audit_logs',
    'email_logs',
    'profiles',
    'training_notes',
  ],
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

function uniqueStrings(values: unknown, limit: number) {
  if (!Array.isArray(values)) {
    return []
  }

  return [
    ...new Set(
      values
        .filter((value): value is string => typeof value === 'string')
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  ].slice(0, limit)
}

function normalizeRequest(body: unknown): Required<CleanupRequest> {
  const input = (body && typeof body === 'object' ? body : {}) as CleanupRequest
  const parsedMaxFiles = Number(input.maxFiles ?? defaultMaxFiles)

  return {
    dryRun: input.dryRun !== false,
    force: input.force === true,
    maxFiles: Math.max(
      1,
      Math.min(
        Number.isFinite(parsedMaxFiles) ? Math.trunc(parsedMaxFiles) : defaultMaxFiles,
        maxAllowedFiles,
      ),
    ),
    studentId:
      typeof input.studentId === 'string' && input.studentId.trim()
        ? input.studentId.trim()
        : null,
    fileId:
      typeof input.fileId === 'string' && input.fileId.trim()
        ? input.fileId.trim()
        : null,
    fileIds: uniqueStrings(input.fileIds, maxAllowedFiles),
  }
}

function getRequestMode(input: Required<CleanupRequest>) {
  if (input.fileId) {
    return 'file'
  }

  if (input.fileIds.length > 0) {
    return 'files'
  }

  return 'candidate'
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

async function getDriveQuota(accessToken: string): Promise<DriveQuota> {
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
    warning: remainingRatio !== null && remainingRatio <= warningThreshold,
  }
}

async function deleteDriveFile(accessToken: string, fileId: string) {
  const response = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${accessToken}` },
  })

  if (!response.ok && response.status !== 404) {
    throw new Error('No se pudo borrar un archivo en Google Drive.')
  }

  return { status: response.status }
}

function latestDate(...values: Array<string | null | undefined>) {
  const timestamps = values
    .map((value) => (value ? Date.parse(value) : Number.NaN))
    .filter((value) => Number.isFinite(value))

  if (timestamps.length === 0) {
    return null
  }

  return new Date(Math.max(...timestamps)).toISOString()
}

function candidateSortValue(candidate: StudentCandidate) {
  return candidate.derived_last_activity_at
    ? Date.parse(candidate.derived_last_activity_at)
    : Number.NEGATIVE_INFINITY
}

function hasActiveCurrentMembership(membership: MembershipRow, today: string) {
  return (
    membership.status === 'active' &&
    (!membership.end_date || membership.end_date >= today)
  )
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
    return jsonResponse({ error: 'Solo un admin activo puede limpiar Drive.' }, 403)
  }

  let requestBody: unknown
  try {
    requestBody = await req.json()
  } catch {
    requestBody = {}
  }
  const input = normalizeRequest(requestBody)
  const requestMode = getRequestMode(input)

  if (!input.dryRun && !input.force) {
    return jsonResponse(
      {
        error:
          'La limpieza real requiere force=true. Ejecuta primero una vista previa.',
      },
      400,
    )
  }

  let accessToken: string
  let quota: DriveQuota
  try {
    accessToken = await getGoogleAccessToken()
    quota = await getDriveQuota(accessToken)
  } catch (error) {
    return jsonResponse(
      { error: error instanceof Error ? error.message : 'No se pudo consultar Drive.' },
      500,
    )
  }

  const thresholdReached =
    quota.remaining_ratio !== null && quota.remaining_ratio <= warningThreshold

  await adminClient.from('drive_status').insert({
    used_bytes: quota.used_bytes,
    total_bytes: quota.total_bytes,
    warning_threshold: 1 - warningThreshold,
    checked_at: new Date().toISOString(),
  })

  let files: CleanupFile[] = []

  if (requestMode === 'file' || requestMode === 'files') {
    let fileQuery = adminClient
      .from('files')
      .select(
        'id, student_id, title, kind, drive_file_id, drive_url, size_bytes, visible_to_student, created_at, archived_at',
      )

    if (requestMode === 'file') {
      fileQuery = fileQuery.eq('id', input.fileId)
    } else {
      fileQuery = fileQuery.in('id', input.fileIds)
    }

    const { data: requestedFiles, error: fileError } = await fileQuery

    if (fileError) {
      return jsonResponse({ error: 'No se pudieron listar los archivos indicados.' }, 500)
    }

    if (requestMode === 'file' && (requestedFiles ?? []).length !== 1) {
      return jsonResponse({ error: 'No se encontro el archivo indicado.' }, 404)
    }

    if (requestMode === 'files') {
      const foundIds = new Set((requestedFiles ?? []).map((file) => file.id))
      const missingIds = input.fileIds.filter((fileId) => !foundIds.has(fileId))
      if (missingIds.length > 0) {
        return jsonResponse(
          {
            error:
              'La vista previa ya no coincide con los archivos actuales. Actualiza la vista previa antes de limpiar.',
            missing_file_ids: missingIds,
          },
          409,
        )
      }
    }

    const archivedFiles = (requestedFiles ?? []).filter((file) => file.archived_at)
    if (archivedFiles.length > 0) {
      return jsonResponse(
        {
          error:
            'Uno o mas archivos indicados ya fueron archivados. Actualiza la vista previa antes de limpiar.',
          archived_file_ids: archivedFiles.map((file) => file.id),
        },
        409,
      )
    }

    const filesWithoutDrive = (requestedFiles ?? []).filter((file) => !file.drive_file_id)
    if (filesWithoutDrive.length > 0) {
      return jsonResponse(
        {
          error:
            'Uno o mas documentos no tienen archivo real de Drive para eliminar definitivamente.',
          file_ids: filesWithoutDrive.map((file) => file.id),
        },
        409,
      )
    }

    files = (requestedFiles ?? []) as CleanupFile[]
  } else {
    let filesQuery = adminClient
      .from('files')
      .select(
        'id, student_id, title, kind, drive_file_id, drive_url, size_bytes, visible_to_student, created_at',
      )
      .is('archived_at', null)
      .not('drive_file_id', 'is', null)
      .order('created_at', { ascending: true })

    if (input.studentId) {
      filesQuery = filesQuery.eq('student_id', input.studentId)
    }

    const { data: eligibleFiles, error: filesError } = await filesQuery
    if (filesError) {
      return jsonResponse({ error: 'No se pudieron listar archivos elegibles.' }, 500)
    }

    files = (eligibleFiles ?? []) as CleanupFile[]
  }
  const studentIds = [...new Set(files.map((file) => file.student_id))]

  if (studentIds.length === 0) {
    await adminClient.from('audit_logs').insert({
      actor_id: requester.id,
      entity_type: 'drive_cleanup',
      action: input.dryRun ? 'drive_cleanup.dry_run' : 'drive_cleanup.executed',
      metadata: {
        dry_run: input.dryRun,
        force: input.force,
        mode: requestMode,
        requested_file_id: input.fileId,
        requested_file_ids: input.fileIds,
        quota,
        threshold_reached: thresholdReached,
        student_id: input.studentId,
        criteria: cleanupCriteria,
        excluded_active_membership_student_ids_count: 0,
        selected_file_count: 0,
        reclaimable_bytes: 0,
        candidate_student_id: null,
        candidate_email: null,
        candidates: [],
        selected_student: null,
        selected_files: [],
        deleted_count: 0,
        failed_count: 0,
        archived_count: 0,
      },
    })

    return jsonResponse({
      dryRun: input.dryRun,
      force: input.force,
      quota,
      threshold_reached: thresholdReached,
      selected_student: null,
      selected_files: [],
      deleted_files: [],
      archived_file_ids: [],
      failed_files: [],
      message: 'No hay archivos de Drive elegibles para limpieza.',
    })
  }

  const { data: profiles, error: profilesError } = await adminClient
    .from('profiles')
    .select(
      'id, email, first_name, last_name, last_payment_at, last_real_activity_at, last_attendance_at, active, role',
    )
    .in('id', studentIds)
    .eq('role', 'student')

  if (profilesError) {
    return jsonResponse({ error: 'No se pudieron evaluar alumnos.' }, 500)
  }

  const { data: payments, error: paymentsError } = await adminClient
    .from('payments')
    .select('student_id, paid_at, approved_at, created_at, status')
    .in('student_id', studentIds)
    .eq('status', 'approved')

  if (paymentsError) {
    return jsonResponse({ error: 'No se pudieron evaluar pagos.' }, 500)
  }

  const { data: memberships, error: membershipsError } = await adminClient
    .from('memberships')
    .select('student_id, end_date, updated_at, status')
    .in('student_id', studentIds)

  if (membershipsError) {
    return jsonResponse({ error: 'No se pudieron evaluar membresias.' }, 500)
  }

  const today = new Date().toISOString().slice(0, 10)
  const activeMembershipStudentIds = new Set(
    ((memberships ?? []) as MembershipRow[])
      .filter((membership) => hasActiveCurrentMembership(membership, today))
      .map((membership) => membership.student_id),
  )

  const candidates = (profiles ?? [])
    .filter(
      (student) => requestMode === 'file' || !activeMembershipStudentIds.has(student.id),
    )
    .map((student) => {
      const studentFiles = files.filter((file) => file.student_id === student.id)
      const studentPayments = (payments ?? []).filter(
        (payment) => payment.student_id === student.id,
      )
      const studentMemberships = ((memberships ?? []) as MembershipRow[]).filter(
        (membership) => membership.student_id === student.id,
      )
      const latestPaymentAt = latestDate(
        student.last_payment_at,
        ...studentPayments.flatMap((payment) => [
          payment.approved_at,
          payment.paid_at,
          payment.created_at,
        ]),
      )
      const latestMembershipAt = latestDate(
        ...studentMemberships.map((membership) =>
          membership.end_date
            ? `${membership.end_date}T23:59:59.000Z`
            : membership.updated_at,
        ),
      )
      const derivedLastActivityAt = latestDate(
        student.last_real_activity_at,
        student.last_attendance_at,
        latestPaymentAt,
        latestMembershipAt,
      )

      return {
        student_id: student.id,
        email: student.email,
        first_name: student.first_name,
        last_name: student.last_name,
        last_payment_at: latestPaymentAt,
        last_real_activity_at: student.last_real_activity_at,
        last_attendance_at: student.last_attendance_at,
        derived_last_activity_at: derivedLastActivityAt,
        eligible_file_count: studentFiles.length,
        eligible_bytes: studentFiles.reduce(
          (sum, file) => sum + Number(file.size_bytes ?? 0),
          0,
        ),
      } satisfies StudentCandidate
    })
    .filter((candidate) => candidate.eligible_file_count > 0)
    .sort((left, right) => candidateSortValue(left) - candidateSortValue(right))

  if (requestMode === 'files' && studentIds.length > 1) {
    return jsonResponse(
      {
        error:
          'La limpieza masiva confirmada debe pertenecer a un unico alumno. Actualiza la vista previa antes de limpiar.',
      },
      409,
    )
  }

  const selectedStudent =
    requestMode === 'file' || requestMode === 'files'
      ? candidates.find((candidate) => candidate.student_id === files[0]?.student_id) ??
        null
      : candidates[0] ?? null
  const selectedFiles =
    requestMode === 'file' || requestMode === 'files'
      ? files.slice(0, requestMode === 'file' ? 1 : files.length)
      : selectedStudent
        ? files
            .filter((file) => file.student_id === selectedStudent.student_id)
            .slice(0, input.maxFiles)
        : []

  if ((requestMode === 'file' || requestMode === 'files') && !selectedStudent) {
    return jsonResponse(
      {
        error:
          requestMode === 'files'
            ? 'Los archivos ya no pertenecen a un candidato elegible. Actualiza la vista previa antes de limpiar.'
            : 'El archivo indicado no esta asociado a un alumno valido.',
      },
      409,
    )
  }
  const reclaimableBytes = selectedFiles.reduce(
    (sum, file) => sum + Number(file.size_bytes ?? 0),
    0,
  )

  const deletedFiles: Array<{ file_id: string; drive_file_id: string; status: number }> = []
  const archivedFileIds: string[] = []
  const failedFiles: CleanupFailure[] = []

  if (!input.dryRun && selectedStudent) {
    for (const file of selectedFiles) {
      if (!file.drive_file_id) {
        continue
      }

      let result: { status: number }
      try {
        result = await deleteDriveFile(accessToken, file.drive_file_id)
      } catch (error) {
        failedFiles.push({
          file_id: file.id,
          drive_file_id: file.drive_file_id,
          stage: 'drive_delete',
          error:
            error instanceof Error
              ? error.message
              : 'No se pudo borrar el archivo en Drive.',
        })
        continue
      }

      deletedFiles.push({
        file_id: file.id,
        drive_file_id: file.drive_file_id,
        status: result.status,
      })

      const { error: archiveError } = await adminClient
        .from('files')
        .update({
          archived_at: new Date().toISOString(),
          updated_by: requester.id,
        })
        .eq('id', file.id)

      if (archiveError) {
        failedFiles.push({
          file_id: file.id,
          drive_file_id: file.drive_file_id,
          stage: 'metadata_archive',
          error: 'Se borro el archivo en Drive pero fallo el archivado.',
        })
        continue
      }

      archivedFileIds.push(file.id)
    }
  }

  await adminClient.from('audit_logs').insert({
    actor_id: requester.id,
    entity_type: 'drive_cleanup',
    action: input.dryRun ? 'drive_cleanup.dry_run' : 'drive_cleanup.executed',
    metadata: {
      dry_run: input.dryRun,
      force: input.force,
      mode: requestMode,
      max_files: input.maxFiles,
      requested_student_id: input.studentId,
      requested_file_id: input.fileId,
      requested_file_ids: input.fileIds,
      criteria: cleanupCriteria,
      quota,
      threshold_reached: thresholdReached,
      excluded_active_membership_student_ids_count: activeMembershipStudentIds.size,
      selected_file_count: selectedFiles.length,
      reclaimable_bytes: reclaimableBytes,
      candidate_student_id: selectedStudent?.student_id ?? null,
      candidate_email: selectedStudent?.email ?? null,
      candidates: candidates.slice(0, 10),
      selected_student: selectedStudent,
      selected_files: selectedFiles.map((file) => ({
        id: file.id,
        student_id: file.student_id,
        title: file.title,
        kind: file.kind,
        drive_file_id: file.drive_file_id,
        drive_url: file.drive_url,
        size_bytes: file.size_bytes,
        visible_to_student: file.visible_to_student,
        created_at: file.created_at,
      })),
      deleted_files: deletedFiles,
      archived_file_ids: archivedFileIds,
      failed_files: failedFiles,
      deleted_count: deletedFiles.length,
      failed_count: failedFiles.length,
      archived_count: archivedFileIds.length,
    },
  })

  const activeMembershipMessage =
    input.studentId && activeMembershipStudentIds.has(input.studentId)
      ? 'El alumno indicado tiene membresia activa vigente y no es elegible para limpieza automatica.'
      : null

  return jsonResponse({
    dryRun: input.dryRun,
    force: input.force,
    quota,
    threshold_reached: thresholdReached,
    criteria: cleanupCriteria,
    excluded_active_membership_student_ids_count: activeMembershipStudentIds.size,
    mode: requestMode,
    requested_file_id: input.fileId,
    requested_file_ids: input.fileIds,
    selected_student: selectedStudent,
    selected_files: selectedFiles,
    selected_file_count: selectedFiles.length,
    reclaimable_bytes: reclaimableBytes,
    deleted_files: deletedFiles,
    archived_file_ids: archivedFileIds,
    failed_files: failedFiles,
    message:
      activeMembershipMessage ??
      (input.dryRun
        ? requestMode === 'file'
          ? 'Vista previa del archivo generada. No se borro ningun archivo.'
          : requestMode === 'files'
            ? 'Vista previa confirmada por archivos. No se borro ningun archivo.'
          : 'Vista previa generada. No se borro ningun archivo.'
        : failedFiles.length > 0
          ? 'Limpieza ejecutada con incidencias auditadas.'
          : 'Limpieza ejecutada y auditada.'),
  })
})
