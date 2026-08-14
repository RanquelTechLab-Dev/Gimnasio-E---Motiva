import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  collectProfilesInBatches,
  type FetchProfileBatch,
  type ProfileWithId,
} from './profile_batching'

type SyntheticProfile = ProfileWithId & {
  marker: string
}

function syntheticUuid(index: number) {
  return `00000000-0000-4000-8000-${index.toString(16).padStart(12, '0')}`
}

function studentIds(count: number) {
  return Array.from({ length: count }, (_, index) => syntheticUuid(index + 1))
}

function profile(id: string, marker = id): SyntheticProfile {
  return { id, marker }
}

describe('MANUAL EMAIL BACKEND profile batching contract', () => {
  it('501 IDs se consultan en dos lotes 500+1', async () => {
    const ids = studentIds(501)
    const calls: string[][] = []
    const fetchBatch: FetchProfileBatch<SyntheticProfile> = async (batch) => {
      calls.push([...batch])
      return batch.map((id) => profile(id))
    }

    const result = await collectProfilesInBatches(ids, fetchBatch)

    expect(calls.map((batch) => batch.length)).toEqual([500, 1])
    expect(result).toHaveLength(501)
    expect(result.map(({ id }) => id)).toEqual(ids)
  })

  it('1001 IDs se consultan en tres lotes 500+500+1', async () => {
    const ids = studentIds(1_001)
    const calls: string[][] = []
    const fetchBatch: FetchProfileBatch<SyntheticProfile> = async (batch) => {
      calls.push([...batch])
      return batch.map((id) => profile(id))
    }

    const result = await collectProfilesInBatches(ids, fetchBatch)
    const consultedIds = calls.flat()

    expect(calls.map((batch) => batch.length)).toEqual([500, 500, 1])
    expect(consultedIds).toEqual(ids)
    expect(new Set(consultedIds).size).toBe(1_001)
    expect(result.map(({ id }) => id)).toEqual(ids)
  })

  it('un error en el segundo lote rechaza toda la operación', async () => {
    const ids = studentIds(1_001)
    const calls: string[][] = []
    const secondBatchError = new Error('synthetic second profile batch failure')
    const fetchBatch: FetchProfileBatch<SyntheticProfile> = async (batch) => {
      calls.push([...batch])
      if (calls.length === 2) {
        throw secondBatchError
      }
      return batch.map((id) => profile(id))
    }

    await expect(collectProfilesInBatches(ids, fetchBatch)).rejects.toBe(
      secondBatchError,
    )
    expect(calls).toEqual([ids.slice(0, 500), ids.slice(500, 1_000)])
  })

  it('agrega resultados multilote sin pérdidas y conserva orden de IDs', async () => {
    const ids = Object.freeze(studentIds(751))
    const originalIds = [...ids]
    const calls: string[][] = []
    const fetchBatch: FetchProfileBatch<SyntheticProfile> = async (batch) => {
      calls.push([...batch])
      return [...batch].reverse().map((id) => profile(id))
    }

    const result = await collectProfilesInBatches(ids, fetchBatch)

    expect(calls.map((batch) => batch.length)).toEqual([500, 251])
    expect(result).toHaveLength(ids.length)
    expect(result.map(({ id }) => id)).toEqual(originalIds)
    expect(ids).toEqual(originalIds)
  })

  it('IDs y perfiles repetidos producen un solo perfil por alumno', async () => {
    const firstId = syntheticUuid(1)
    const secondId = syntheticUuid(2)
    const thirdId = syntheticUuid(3)
    const unexpectedId = syntheticUuid(999)
    const ids = [firstId, secondId, firstId, thirdId, secondId]
    const calls: string[][] = []
    const firstProfile = profile(firstId, 'first instance')
    const fetchBatch: FetchProfileBatch<SyntheticProfile> = async (batch) => {
      calls.push([...batch])
      return [
        profile(thirdId),
        firstProfile,
        profile(firstId, 'duplicate instance'),
        profile(unexpectedId),
        profile('', 'empty id'),
        profile(secondId),
      ]
    }

    const result = await collectProfilesInBatches(ids, fetchBatch)

    expect(calls).toEqual([[firstId, secondId, thirdId]])
    expect(result.map(({ id }) => id)).toEqual([firstId, secondId, thirdId])
    expect(result).toHaveLength(3)
    expect(result[0]).toBe(firstProfile)
  })

  it('index delega el loteo de profiles al helper auditado', () => {
    const indexSource = readFileSync(new URL('./index.ts', import.meta.url), 'utf8')

    expect(indexSource).toMatch(
      /import\s*\{[^}]*collectProfilesInBatches[^}]*\}\s*from\s*['"]\.\/profile_batching\.ts['"]/s,
    )
    expect(indexSource).toMatch(
      /\bcollectProfilesInBatches(?:<[^>]+>)?\s*\(\s*studentIds\s*,/,
    )
    expect(indexSource).not.toMatch(
      /for\s*\(\s*let\s+from\s*=\s*0;\s*from\s*<\s*studentIds\.length;\s*from\s*\+=\s*PROFILE_BATCH_SIZE\s*\)/,
    )
    expect(indexSource).not.toContain(
      'studentIds.slice(from, from + PROFILE_BATCH_SIZE)',
    )
  })
})
