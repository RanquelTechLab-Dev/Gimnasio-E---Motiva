export const MAX_RECIPIENT_IDS = 1_000

export type SelectableRecipient = {
  id: string
}

export type RecipientSelection =
  | {
      mode: 'all_eligible'
      requested_ids: null
    }
  | {
      mode: 'selected'
      requested_ids: string[]
    }

export type RecipientSelectionValidation =
  | {
      valid: true
      selection: RecipientSelection
    }
  | {
      valid: false
      error: string
    }

export type RecipientSelectionResult<T extends SelectableRecipient> = {
  recipients: T[]
  selection_mode: RecipientSelection['mode']
  requested_count: number
  selected_count: number
  ignored_count: number
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function validateRecipientIds(
  value: unknown,
): RecipientSelectionValidation {
  if (value === undefined) {
    return {
      valid: true,
      selection: {
        mode: 'all_eligible',
        requested_ids: null,
      },
    }
  }

  if (!Array.isArray(value)) {
    return {
      valid: false,
      error: 'recipient_ids debe ser un array.',
    }
  }

  if (value.length === 0) {
    return {
      valid: false,
      error: 'recipient_ids debe contener al menos un ID.',
    }
  }

  if (value.length > MAX_RECIPIENT_IDS) {
    return {
      valid: false,
      error: `recipient_ids no puede superar ${MAX_RECIPIENT_IDS} IDs.`,
    }
  }

  const requestedIds: string[] = []
  const seenIds = new Set<string>()

  for (const candidate of value) {
    if (
      typeof candidate !== 'string' ||
      candidate !== candidate.trim() ||
      !UUID_PATTERN.test(candidate)
    ) {
      return {
        valid: false,
        error: 'recipient_ids solo admite UUIDs validos.',
      }
    }

    const normalizedId = candidate.toLowerCase()
    if (!seenIds.has(normalizedId)) {
      seenIds.add(normalizedId)
      requestedIds.push(normalizedId)
    }
  }

  return {
    valid: true,
    selection: {
      mode: 'selected',
      requested_ids: requestedIds,
    },
  }
}

export function selectEligibleRecipients<T extends SelectableRecipient>(
  eligibleRecipients: readonly T[],
  selection: RecipientSelection,
): RecipientSelectionResult<T> {
  const requestedIds =
    selection.mode === 'selected' ? new Set(selection.requested_ids) : null
  const seenEligibleIds = new Set<string>()
  const recipients: T[] = []

  for (const recipient of eligibleRecipients) {
    const normalizedId = recipient.id.toLowerCase()
    if (seenEligibleIds.has(normalizedId)) {
      continue
    }

    seenEligibleIds.add(normalizedId)
    if (requestedIds === null || requestedIds.has(normalizedId)) {
      recipients.push(recipient)
    }
  }

  const requestedCount = requestedIds?.size ?? 0
  const selectedCount = recipients.length

  return {
    recipients,
    selection_mode: selection.mode,
    requested_count: requestedCount,
    selected_count: selectedCount,
    ignored_count:
      selection.mode === 'selected' ? requestedCount - selectedCount : 0,
  }
}
