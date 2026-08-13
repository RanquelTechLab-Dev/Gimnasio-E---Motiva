import { describe, expect, it } from 'vitest'
import {
  MAX_RECIPIENT_IDS,
  selectEligibleRecipients,
  validateRecipientIds,
  type RecipientSelection,
  type SelectableRecipient,
} from './recipient_selection'

type RecipientFixture = SelectableRecipient & {
  email: string
}

const ALPHA_ID = '00000000-0000-4000-8000-000000000001'
const BETA_ID = '00000000-0000-4000-8000-000000000002'
const GAMMA_ID = '00000000-0000-4000-8000-000000000003'
const UNKNOWN_ID = '00000000-0000-4000-8000-000000000004'
const INELIGIBLE_ID = '00000000-0000-4000-8000-000000000005'

const ALPHA: RecipientFixture = {
  id: ALPHA_ID,
  email: 'fixture.alpha@example.invalid',
}

const BETA: RecipientFixture = {
  id: BETA_ID,
  email: 'fixture.beta@example.invalid',
}

const GAMMA: RecipientFixture = {
  id: GAMMA_ID,
  email: 'fixture.gamma@example.invalid',
}

const INELIGIBLE: RecipientFixture = {
  id: INELIGIBLE_ID,
  email: 'fixture.ineligible@example.invalid',
}

const ELIGIBLE_RECIPIENTS = [ALPHA, BETA, GAMMA] as const

function requireSelection(value: unknown): RecipientSelection {
  const validation = validateRecipientIds(value)
  if (!validation.valid) {
    throw new Error(validation.error)
  }

  return validation.selection
}

function select(
  recipientIds: unknown,
  eligibleRecipients: readonly RecipientFixture[] = ELIGIBLE_RECIPIENTS,
) {
  return selectEligibleRecipients(
    eligibleRecipients,
    requireSelection(recipientIds),
  )
}

function syntheticUuid(index: number) {
  return `00000000-0000-4000-8000-${index.toString(16).padStart(12, '0')}`
}

describe('MANUAL EMAIL BACKEND recipient selection contract', () => {
  it('1. recipient_ids ausente selecciona todos los elegibles', () => {
    expect(select(undefined)).toEqual({
      recipients: [ALPHA, BETA, GAMMA],
      selection_mode: 'all_eligible',
      requested_count: 0,
      selected_count: 3,
      ignored_count: 0,
    })
  })

  it('2. selección explícita de un ID devuelve uno', () => {
    expect(select([BETA_ID])).toEqual({
      recipients: [BETA],
      selection_mode: 'selected',
      requested_count: 1,
      selected_count: 1,
      ignored_count: 0,
    })
  })

  it('3. selección explícita de varios IDs devuelve varios', () => {
    expect(select([ALPHA_ID, GAMMA_ID]).recipients).toEqual([ALPHA, GAMMA])
  })

  it('4. IDs repetidos se deduplican', () => {
    const validation = validateRecipientIds([ALPHA_ID, ALPHA_ID, ALPHA_ID])

    expect(validation).toEqual({
      valid: true,
      selection: {
        mode: 'selected',
        requested_ids: [ALPHA_ID],
      },
    })
    expect(select([ALPHA_ID, ALPHA_ID]).recipients).toEqual([ALPHA])
  })

  it('5. conserva el orden de la audiencia elegible', () => {
    expect(select([GAMMA_ID, ALPHA_ID]).recipients).toEqual([ALPHA, GAMMA])
  })

  it('6. IDs desconocidos quedan excluidos', () => {
    expect(select([ALPHA_ID, UNKNOWN_ID]).recipients).toEqual([ALPHA])
  })

  it('7. un ID no elegible no puede forzarse', () => {
    const eligibleWithoutTarget = [ALPHA, BETA]

    expect(
      select([INELIGIBLE.id], eligibleWithoutTarget).recipients,
    ).toEqual([])
  })

  it('8. UUID inválido es rechazado', () => {
    expect(validateRecipientIds(['not-a-uuid'])).toEqual({
      valid: false,
      error: 'recipient_ids solo admite UUIDs validos.',
    })
  })

  it('9. array vacío es rechazado', () => {
    expect(validateRecipientIds([])).toEqual({
      valid: false,
      error: 'recipient_ids debe contener al menos un ID.',
    })
  })

  it('10. valor no-array es rechazado', () => {
    expect(validateRecipientIds(ALPHA_ID)).toEqual({
      valid: false,
      error: 'recipient_ids debe ser un array.',
    })
  })

  it('11. más de 1000 IDs es rechazado', () => {
    const tooManyIds = Array.from(
      { length: MAX_RECIPIENT_IDS + 1 },
      (_, index) => syntheticUuid(index + 1),
    )

    expect(validateRecipientIds(tooManyIds)).toEqual({
      valid: false,
      error: 'recipient_ids no puede superar 1000 IDs.',
    })
  })

  it('12. requested_count refleja IDs únicos solicitados', () => {
    expect(select([ALPHA_ID, ALPHA_ID, GAMMA_ID]).requested_count).toBe(2)
  })

  it('13. selected_count refleja la intersección elegible', () => {
    expect(
      select([ALPHA_ID, UNKNOWN_ID, INELIGIBLE_ID]).selected_count,
    ).toBe(1)
  })

  it('14. ignored_count refleja IDs no elegibles/desconocidos', () => {
    const result = select([ALPHA_ID, UNKNOWN_ID, INELIGIBLE_ID])

    expect(result.requested_count).toBe(3)
    expect(result.selected_count).toBe(1)
    expect(result.ignored_count).toBe(2)
  })

  it('15. misma entrada produce exactamente el mismo resultado', () => {
    const requestedIds = [GAMMA_ID, ALPHA_ID, ALPHA_ID]

    expect(select(requestedIds)).toEqual(select(requestedIds))
  })
})
