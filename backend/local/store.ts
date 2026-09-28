import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex } from '@noble/hashes/utils.js'
import type { SpaceSnapshot } from './types.js'
import { journalDate } from './date.js'
import { LocalDomainError } from './errors.js'

export interface TransactionKey {
  clientOperationId: string
  fingerprint: string
  expectedSpaceRevision: number
}

const UUID = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i

function uuidKey(value: string): string {
  if (typeof value !== 'string' || !UUID.test(value)) throw new LocalDomainError('invalid_input')
  return value.toLowerCase()
}

export function canonicalFingerprint(request: unknown): string {
  const visiting = new WeakSet<object>()
  function normalize(value: unknown): unknown {
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
    if (typeof value === 'number' && Number.isFinite(value)) return value
    if (typeof value !== 'object' || visiting.has(value)) throw new LocalDomainError('invalid_input')
    visiting.add(value)
    try {
      if (Array.isArray(value)) {
        if (Array.from({ length: value.length }, (_, index) => Object.hasOwn(value, index)).includes(false)) {
          throw new LocalDomainError('invalid_input')
        }
        return value.map(normalize)
      }
      if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) {
        throw new LocalDomainError('invalid_input')
      }
      if (Object.getOwnPropertySymbols(value).length > 0) throw new LocalDomainError('invalid_input')
      return Object.fromEntries(Object.keys(value).sort().map((key) => [key, normalize((value as Record<string, unknown>)[key])]))
    } finally {
      visiting.delete(value)
    }
  }
  return JSON.stringify(normalize(request))
}

type CommittedOperation =
  | { fingerprintSha256: string; status: 'current'; result: unknown }
  | { fingerprintSha256: string; status: 'invalidated' }

function previousSensitiveDataChanged(before: SpaceSnapshot, after: SpaceSnapshot): boolean {
  function changed<T extends { id: string }>(
    earlier: T[], current: T[], text: (item: T) => string | null,
  ): boolean {
    const currentById = new Map(current.map((item) => [item.id, item]))
    return earlier.some((item) => {
      const now = currentById.get(item.id)
      return !now || text(now) !== text(item)
    })
  }
  return changed(before.entries, after.entries, (entry) => entry.text) ||
    changed(before.messages, after.messages, (message) => message.controlText) ||
    changed(before.questions, after.questions, (question) => question.text) ||
    changed(before.observations, after.observations, (observation) => observation.text) ||
    Object.entries(before.titles).some(([date, title]) => after.titles[date]?.text !== title.text) ||
    before.sourceGrants.some((grant) => {
      const current = after.sourceGrants.find((item) => item.id === grant.id)
      return !current || JSON.stringify(current) !== JSON.stringify(grant)
    })
}

export interface RepositoryDependencies {
  now?: () => string
  newId?: () => string
}

export interface SpaceRepository {
  createSpace(spaceId: string, timezone: string): SpaceSnapshot
  read(spaceId: string): SpaceSnapshot
  transact<T>(
    spaceId: string, key: TransactionKey,
    mutate: (draft: SpaceSnapshot, nextRevision: number) => T,
  ): T
  now(): string
  newId(): string
}

export class InMemorySpaceRepository implements SpaceRepository {
  private readonly dependencies: RepositoryDependencies
  private readonly spaces = new Map<string, SpaceSnapshot>()
  private readonly operations = new Map<string, Map<string, CommittedOperation>>()
  private readonly activeSpaces = new Set<string>()

  constructor(dependencies: RepositoryDependencies = {}) {
    this.dependencies = dependencies
  }

  now(): string {
    return this.dependencies.now?.() ?? new Date().toISOString()
  }

  newId(): string {
    return this.dependencies.newId?.() ?? crypto.randomUUID()
  }

  createSpace(spaceId: string, timezone: string): SpaceSnapshot {
    const spaceKey = uuidKey(spaceId)
    if (this.spaces.has(spaceKey)) throw new LocalDomainError('revision_conflict')
    const anchorDate = journalDate(this.now(), timezone)
    const space: SpaceSnapshot = {
      id: spaceKey, revision: 0, timezone, nextMessageSequence: 1,
      messages: [], entries: [], questions: [], observations: [], titles: {},
      invitations: {
        cadence: 'daily', cadenceAnchorDate: anchorDate, paused: false,
        unansweredShownRounds: 0, pendingChange: null, changeEvents: [], invitations: [],
      },
      sourceGrants: [], tombstones: [],
    }
    this.spaces.set(spaceKey, space)
    this.operations.set(spaceKey, new Map())
    return structuredClone(space)
  }

  read(spaceId: string): SpaceSnapshot {
    const space = this.spaces.get(uuidKey(spaceId))
    if (!space) throw new LocalDomainError('not_found')
    return structuredClone(space)
  }

  transact<T>(
    spaceId: string, key: TransactionKey,
    mutate: (draft: SpaceSnapshot, nextRevision: number) => T,
  ): T {
    const spaceKey = uuidKey(spaceId)
    const space = this.spaces.get(spaceKey)
    if (!space) throw new LocalDomainError('not_found')
    if (this.activeSpaces.has(spaceKey)) throw new LocalDomainError('revision_conflict')
    const operationKey = uuidKey(key.clientOperationId)
    if (typeof key.fingerprint !== 'string' || !key.fingerprint || !Number.isInteger(key.expectedSpaceRevision) ||
      key.expectedSpaceRevision < 0) throw new LocalDomainError('invalid_input')
    const fingerprintSha256 = bytesToHex(sha256(new TextEncoder().encode(key.fingerprint)))
    const committed = this.operations.get(spaceKey)?.get(operationKey)
    if (committed) {
      if (committed.fingerprintSha256 !== fingerprintSha256) {
        throw new LocalDomainError('idempotency_conflict')
      }
      if (committed.status === 'invalidated') throw new LocalDomainError('revision_conflict')
      return structuredClone(committed.result) as T
    }
    if (key.expectedSpaceRevision !== space.revision) throw new LocalDomainError('revision_conflict')
    const draft = structuredClone(space)
    const nextRevision = space.revision + 1
    this.activeSpaces.add(spaceKey)
    try {
      const result = mutate(draft, nextRevision)
      const committedResult = structuredClone(result)
      draft.revision = nextRevision
      const committedDraft = structuredClone(draft)
      const operations = new Map(this.operations.get(spaceKey))
      if (previousSensitiveDataChanged(space, committedDraft)) {
        for (const [operationId, receipt] of operations) {
          operations.set(operationId, { fingerprintSha256: receipt.fingerprintSha256, status: 'invalidated' })
        }
      }
      operations.set(operationKey, {
        fingerprintSha256, status: 'current', result: committedResult,
      })
      this.spaces.set(spaceKey, committedDraft)
      this.operations.set(spaceKey, operations)
      return structuredClone(committedResult)
    } finally {
      this.activeSpaces.delete(spaceKey)
    }
  }
}
