# Next Steps

## Actual

Preparar RAN-19 / RANV2-03 con migracion local inicial + RLS versionado.

## Siguiente

RAN-19 / RANV2-03: crear migracion local inicial, revisar SQL y recien despues validar `db push --dry-run`.

## Pendiente antes de RAN-19

Supabase nuevo ya fue creado y linkeado. Falta crear el schema inicial exclusivamente desde `supabase/migrations`, sin tablas manuales y sin `db push` hasta validar el dry-run.
