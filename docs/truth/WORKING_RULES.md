# Working Rules

## Fuente de verdad

- Linear manda.
- Codex ejecuta.
- ChatGPT audita y genera prompts.
- No inventar.
- Separar Confirmado, Inferido y Pendiente de validar.

## Flujo por RAN

- Una PR por RAN.
- No avanzar al siguiente RAN sin cerrar el anterior.
- No usar `git add .`.
- No trabajar con `main` sucio.
- No hacer refactor masivo sin necesidad real.
- No simular backend inexistente.

## Antes de modificar

Verificar:

- branch actual;
- `git status`;
- relacion con `main`;
- archivos a tocar;
- objetivo exacto del bloque.

## Supabase

Orden obligatorio:

1. Migracion local primero.
2. Revisar SQL.
3. Commit/PR.
4. `db push --dry-run`.
5. `db push`.
6. Validar remoto.

Nunca al reves.

## Seguridad

- No secrets en repo.
- No `service_role` en frontend.
- No imprimir secrets.
- Ninguna Edge Function sin estar versionada en Git.
- Ningun cambio Supabase remoto si antes no existe como migracion versionada.
