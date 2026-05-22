import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

type DeleteStudentPayload = {
  student_id?: string
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
    throw new Error(error.message)
  }

  return count ?? 0
}

async function deleteRows(
  adminClient: ReturnType<typeof createClient>,
  table: string,
  column: string,
  value: string,
) {
  const count = await countRows(adminClient, table, column, value)

  if (count === 0) {
    return 0
  }

  const { error } = await adminClient.from(table).delete().eq(column, value)

  if (error) {
    throw new Error(error.message)
  }

  return count
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

  let payload: DeleteStudentPayload
  try {
    payload = await req.json()
  } catch {
    return jsonResponse({ error: 'JSON invalido.' }, 400)
  }

  const studentId = cleanText(payload.student_id)

  if (!studentId) {
    return jsonResponse({ error: 'Alumno requerido.' }, 400)
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
    return jsonResponse({ error: 'Solo un admin activo puede eliminar alumnos.' }, 403)
  }

  if (studentId === requester.id) {
    return jsonResponse(
      { error: 'No podes eliminar tu propio usuario desde esta accion.' },
      403,
    )
  }

  const { data: studentProfile, error: studentProfileError } = await adminClient
    .from('profiles')
    .select('id, role, email')
    .eq('id', studentId)
    .single()

  if (studentProfileError || !studentProfile) {
    return jsonResponse({ error: 'No se encontro el alumno.' }, 404)
  }

  if (studentProfile.role === 'admin') {
    return jsonResponse(
      { error: 'No se puede eliminar un usuario admin desde esta accion.' },
      403,
    )
  }

  if (studentProfile.role !== 'student') {
    return jsonResponse({ error: 'Solo se pueden eliminar perfiles de alumno.' }, 403)
  }

  const deletedCounts: Record<string, number> = {}

  try {
    deletedCounts.attendance = await deleteRows(
      adminClient,
      'attendance',
      'student_id',
      studentId,
    )
    deletedCounts.bookings = await deleteRows(
      adminClient,
      'bookings',
      'student_id',
      studentId,
    )
    deletedCounts.payments = await deleteRows(
      adminClient,
      'payments',
      'student_id',
      studentId,
    )
    deletedCounts.memberships = await deleteRows(
      adminClient,
      'memberships',
      'student_id',
      studentId,
    )
    deletedCounts.files = await deleteRows(
      adminClient,
      'files',
      'student_id',
      studentId,
    )
    deletedCounts.training_notes = await deleteRows(
      adminClient,
      'training_notes',
      'student_id',
      studentId,
    )

    const { error: auditError } = await adminClient.from('audit_logs').insert({
      actor_id: requester.id,
      entity_type: 'student',
      entity_id: studentId,
      action: 'student.delete_final',
      metadata: {
        email: studentProfile.email,
        deleted_counts: deletedCounts,
        note:
          'Eliminacion definitiva solicitada por admin para alumno de prueba o carga por error. Metadata de archivos eliminada; archivos Drive no se borran masivamente desde esta funcion.',
      },
    })

    if (auditError) {
      deletedCounts.audit_log_error = 1
    }
  } catch (deleteError) {
    const message =
      deleteError instanceof Error
        ? deleteError.message
        : 'No se pudieron eliminar los datos asociados del alumno.'
    return jsonResponse(
      {
        error: message,
        deleted_counts: deletedCounts,
      },
      500,
    )
  }

  const { error: deactivateError } = await adminClient
    .from('profiles')
    .update({ active: false })
    .eq('id', studentId)

  if (deactivateError) {
    return jsonResponse(
      {
        error: 'No se pudo desactivar el alumno antes de eliminarlo.',
        detail: deactivateError.message,
      },
      500,
    )
  }

  const { error: deleteAuthError } =
    await adminClient.auth.admin.deleteUser(studentId)

  if (deleteAuthError) {
    return jsonResponse(
      { error: deleteAuthError.message ?? 'No se pudo eliminar el usuario Auth.' },
      500,
    )
  }

  const { data: remainingProfile, error: remainingProfileError } =
    await adminClient
      .from('profiles')
      .select('id')
      .eq('id', studentId)
      .maybeSingle()

  if (remainingProfileError) {
    return jsonResponse(
      {
        error:
          'El usuario Auth fue eliminado, pero no se pudo verificar el profile.',
        detail: remainingProfileError.message,
      },
      500,
    )
  }

  if (remainingProfile) {
    const { error: profileDeleteError } = await adminClient
      .from('profiles')
      .delete()
      .eq('id', studentId)

    if (profileDeleteError) {
      return jsonResponse(
        {
          error:
            'Usuario Auth eliminado, pero fallo la eliminacion del profile.',
          detail: profileDeleteError.message,
        },
        500,
      )
    }
  }

  return jsonResponse({
    action: 'deleted',
    student_id: studentId,
    deleted_counts: deletedCounts,
  })
})
