# RAN-37A - Calendar delete semantics

## Principle

If the UI says `Borrar`, it must physically delete the calendar data in scope.

If the action keeps history, it cannot be labeled `Borrar`.

## Vocabulary

- Cancelar clase: preserves history.
- Pausar serie: preserves history.
- Desactivar horario o regla: preserves history.
- Archivar: preserves history.
- Borrar clase: real hard delete.
- Borrar serie recurrente: real hard delete of the series and confirmed dependencies in scope.
- Borrar calendario: real hard delete of calendar data in the confirmed scope.

## Contract by Action

### Cancelar clase

May use `cancelled_at`, flags, or recurring exceptions.

It does not physically delete anything.

It must be labeled `Cancelar clase`.

### Borrar clase

It must physically delete:

- `class_sessions`
- `bookings`
- `attendance`

It must not leave the class as cancelled or inactive residue.

### Borrar ocurrencia recurrente

It must delete the real occurrence and its dependencies.

If a technical anti-regeneration marker is required, it must not remain visible or operational as a class or as operational history.

### Borrar serie recurrente

It must delete or otherwise remove the recurring rule from the real operational circuit.

It must delete future materialized sessions and confirmed dependencies in scope.

### Borrar calendario

It must only delete calendar data and dependencies:

- `class_sessions`
- `class_recurring_rules`
- `class_recurring_rule_exceptions`
- associated `bookings`
- associated `attendance`

It must not touch:

- `profiles` / students
- `payments`
- `memberships`
- `files`
- `Auth`
- `Drive`

## Security

Any future hard delete must include:

- preview first,
- exact counts,
- strong written confirmation,
- admin-only access,
- in-operation recheck,
- minimal audit trail that does not reconstruct deleted data,
- explicit exclusion of non-calendar business data.

Future confirmation strings:

- `BORRAR CLASE DEFINITIVAMENTE`
- `BORRAR OCURRENCIA DEFINITIVAMENTE`
- `BORRAR SERIE RECURRENTE DEFINITIVAMENTE`
- `BORRAR CALENDARIO DEFINITIVAMENTE`

## Scope of This PR

This PR only documents the contract and adjusts confusing UI copy.

It does not implement real hard delete.

It does not execute cleanup.
