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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: 200, headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Metodo no permitido.', disabled: true }, 405)
  }

  return jsonResponse(
    {
      error:
        'La eliminacion definitiva de alumnos esta deshabilitada en produccion. Para preservar datos reales, usa desactivar, anular, archivar o un flujo de limpieza autorizado.',
      disabled: true,
    },
    410,
  )
})
