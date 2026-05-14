# Next Steps

## Actual

Revisar PR de RAN-19 / RANV2-03 con migracion local inicial + RLS versionado.

## Siguiente

RAN-19 / RANV2-03: validar `db push --dry-run`, revisar PR y luego aplicar `db push` real en bloque posterior autorizado.

## Pendiente antes de RAN-19

Supabase nuevo ya fue creado y linkeado. El schema inicial debe aplicarse exclusivamente desde `supabase/migrations`, sin tablas manuales y sin `db push` real hasta validar el dry-run y aprobar el bloque remoto.
