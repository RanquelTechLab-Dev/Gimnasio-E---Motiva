export const PROFILE_BATCH_SIZE = 500

export type ProfileWithId = {
  id: string
}

export type FetchProfileBatch<TProfile extends ProfileWithId> = (
  studentIds: readonly string[],
) => Promise<readonly TProfile[]>

export function dedupeStudentIdsPreservingOrder(
  studentIds: readonly string[],
): string[] {
  const uniqueStudentIds: string[] = []
  const seenStudentIds = new Set<string>()

  for (const studentId of [...studentIds]) {
    if (seenStudentIds.has(studentId)) {
      continue
    }

    seenStudentIds.add(studentId)
    uniqueStudentIds.push(studentId)
  }

  return uniqueStudentIds
}

export function buildProfileIdBatches(
  studentIds: readonly string[],
): string[][] {
  const uniqueStudentIds = dedupeStudentIdsPreservingOrder(studentIds)
  const batches: string[][] = []

  for (
    let from = 0;
    from < uniqueStudentIds.length;
    from += PROFILE_BATCH_SIZE
  ) {
    batches.push(uniqueStudentIds.slice(from, from + PROFILE_BATCH_SIZE))
  }

  return batches
}

export async function collectProfilesInBatches<
  TProfile extends ProfileWithId,
>(
  studentIds: readonly string[],
  fetchBatch: FetchProfileBatch<TProfile>,
): Promise<TProfile[]> {
  const uniqueStudentIds = dedupeStudentIdsPreservingOrder(studentIds)
  const requestedStudentIds = new Set(uniqueStudentIds)
  const firstProfileByStudentId = new Map<string, TProfile>()
  const batches = buildProfileIdBatches(uniqueStudentIds)

  for (const batch of batches) {
    const profiles = await fetchBatch(batch)

    for (const profile of profiles) {
      if (
        !profile.id ||
        !requestedStudentIds.has(profile.id) ||
        firstProfileByStudentId.has(profile.id)
      ) {
        continue
      }

      firstProfileByStudentId.set(profile.id, profile)
    }
  }

  const orderedProfiles: TProfile[] = []
  for (const studentId of uniqueStudentIds) {
    const profile = firstProfileByStudentId.get(studentId)
    if (profile) {
      orderedProfiles.push(profile)
    }
  }

  return orderedProfiles
}
