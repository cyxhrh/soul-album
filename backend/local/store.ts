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

/** Accept only a complete internal snapshot; never partially repair private records. */
function validateSnapshot(space: SpaceSnapshot): void {
  const check = (condition: unknown): void => { if (!condition) throw new LocalDomainError('invalid_input') }
  const object = (value: unknown): void => check(!!value && typeof value === 'object' && !Array.isArray(value))
  const integer = (value: unknown, minimum = 0): void => check(Number.isSafeInteger(value) && Number(value) >= minimum)
  const text = (value: unknown): void => check(typeof value === 'string')
  const id = (value: string): void => { check(uuidKey(value) === value) }
  const member = (value: unknown, choices: string[]): void => check(choices.includes(value as string))
  const date = (value: string): void => {
    text(value)
    check(/^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00Z`)))
    check(new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value)
  }
  object(space)
  id(space.id); integer(space.revision); text(space.timezone)
  const timestamp = (value: string): void => { text(value); journalDate(value, space.timezone) }
  timestamp('2026-01-01T00:00:00Z')
  integer(space.nextMessageSequence, 1)
  for (const list of [space.messages, space.entries, space.questions, space.observations, space.sourceGrants, space.tombstones]) {
    check(Array.isArray(list))
  }
  object(space.titles); object(space.invitations)
  check(Array.isArray(space.invitations.invitations) && Array.isArray(space.invitations.changeEvents))
  const allIds = new Set<string>()
  for (const list of [space.messages, space.entries, space.questions, space.observations, space.sourceGrants,
    space.invitations.invitations, space.invitations.changeEvents]) {
    for (const item of list) {
      object(item); id(item.id); check(!allIds.has(item.id)); allIds.add(item.id)
    }
  }
  const entries = new Map(space.entries.map((item) => [item.id, item]))
  const messages = new Map(space.messages.map((item) => [item.id, item]))
  const questions = new Map(space.questions.map((item) => [item.id, item]))
  const observations = new Map(space.observations.map((item) => [item.id, item]))
  const invitationIds = new Set(space.invitations.invitations.map((item) => item.id))
  const optionalRef = (value: string | null | undefined, ids: { has(id: string): boolean }): void => {
    if (value == null) return
    id(value); check(ids.has(value))
  }
  const deleted = new Set<string>()
  for (const item of space.tombstones) {
    object(item); id(item.entityId); timestamp(item.deletedAt); integer(item.spaceRevision, 1)
    member(item.entityKind, ['message', 'entry', 'observation', 'source_fact', 'source_summary'])
    check(item.spaceRevision <= space.revision && !allIds.has(item.entityId))
    deleted.add(`${item.entityKind}:${item.entityId}`)
  }
  const sequences = new Set<number>()
  const operationIds = new Set<string>()
  for (const message of space.messages) {
    integer(message.revision, 1); integer(message.sequence, 1)
    check(message.sequence < space.nextMessageSequence && !sequences.has(message.sequence))
    sequences.add(message.sequence)
    id(message.clientOperationId); check(!operationIds.has(message.clientOperationId)); operationIds.add(message.clientOperationId)
    timestamp(message.occurredAt); timestamp(message.recordedAt); object(message.interpretation)
    member(message.interpretation.kind, ['answer', 'proactive_record', 'skip', 'decline', 'request_more', 'uncertain'])
    member(message.interpretation.status, ['proposed', 'accepted', 'user_corrected'])
    member(message.interpretation.provenance, ['local_rule', 'on_device_model', 'cloud_model', 'user_correction'])
    optionalRef(message.replyToQuestionId, questions); optionalRef(message.invitationId, invitationIds)
    if (message.controlEvent != null) member(message.controlEvent, ['skip', 'decline', 'request_more'])
    if (message.entryId !== null) {
      id(message.entryId); check(entries.get(message.entryId)?.messageId === message.id && message.controlText === null)
    } else text(message.controlText)
  }
  for (const entry of space.entries) {
    text(entry.text); integer(entry.revision, 1); id(entry.messageId); date(entry.journalDate)
    timestamp(entry.occurredAt); timestamp(entry.recordedAt); text(entry.timezone)
    check(journalDate(entry.occurredAt, entry.timezone) === entry.journalDate)
    check(entry.source === 'conversation' && messages.get(entry.messageId)?.entryId === entry.id)
  }
  const citations = (value: SpaceSnapshot['questions'][number]['citations'], withdrawn = false, entryOnly = false): void => {
    check(Array.isArray(value))
    for (const citation of value) {
      object(citation); id(citation.id); integer(citation.revision, 1)
      member(citation.kind, entryOnly ? ['entry'] : ['entry', 'observation'])
      const target = citation.kind === 'entry' ? entries.get(citation.id) : observations.get(citation.id)
      check(target ? (withdrawn ? citation.revision <= target.revision : citation.revision === target.revision)
        : withdrawn && deleted.has(`${citation.kind}:${citation.id}`))
    }
  }
  for (const question of space.questions) {
    text(question.text); integer(question.revision, 1); timestamp(question.displayedAt)
    member(question.provenance, ['local_rule', 'on_device_model', 'cloud_model'])
    member(question.status, ['ready', 'skipped', 'user_corrected', 'citation_revised', 'citation_deleted'])
    const withdrawn = question.status === 'citation_revised' || question.status === 'citation_deleted'
    citations(question.citations, withdrawn)
    optionalRef(question.answeredByMessageId, messages); optionalRef(question.skippedByMessageId, messages)
    optionalRef(question.invitationId, invitationIds)
    if (question.approvedExcerpt !== undefined) { text(question.approvedExcerpt); check(!withdrawn) }
  }
  for (const observation of space.observations) {
    text(observation.text); integer(observation.revision, 1)
    member(observation.status, ['tentative', 'user_corrected'])
    member(observation.provenance, ['local_rule', 'on_device_model', 'cloud_model', 'user_correction'])
    citations(observation.citations, false, true)
    if (observation.journalDate !== undefined) date(observation.journalDate)
    if (observation.recordedAt !== undefined) timestamp(observation.recordedAt)
  }
  for (const [key, title] of Object.entries(space.titles)) {
    date(key); object(title); text(title.text); integer(title.revision, 1)
    check(Array.isArray(title.dependencyEntryIds))
    for (const dependency of title.dependencyEntryIds) { id(dependency); check(entries.has(dependency)) }
  }
  const state = space.invitations
  const cadence = (value: unknown): void => member(value, ['daily', 'weekly', 'manual'])
  cadence(state.cadence); date(state.cadenceAnchorDate); check(typeof state.paused === 'boolean')
  integer(state.unansweredShownRounds)
  for (const invitation of state.invitations) {
    date(invitation.date); integer(invitation.revision, 1); check([1, 2].includes(invitation.questionTarget))
    member(invitation.state, ['scheduled', 'delivered', 'shown', 'settled_answered', 'settled_unanswered', 'cancelled'])
    if (invitation.shownAt != null) timestamp(invitation.shownAt)
    if (invitation.settledAt != null) timestamp(invitation.settledAt)
  }
  for (const event of state.changeEvents) {
    member(event.reason, ['manual_choice', 'two_shown_rounds_unanswered', 'pause', 'resume', 'response_correction'])
    cadence(event.previousCadence); cadence(event.nextCadence); timestamp(event.decidedAt)
    date(event.effectiveDate); date(event.anchorDate); check(Array.isArray(event.triggeringInvitationIds))
    for (const reference of event.triggeringInvitationIds) { id(reference); check(invitationIds.has(reference)) }
    if (event.retractedAt != null) timestamp(event.retractedAt)
    if (event.retractionDisposition !== undefined) member(event.retractionDisposition, ['cancelled_pending', 'annotated_effective'])
  }
  if (state.pendingChange !== null) {
    object(state.pendingChange)
    check(state.changeEvents.some((event) => canonicalFingerprint(event) === canonicalFingerprint(state.pendingChange)))
  }
  for (const grant of space.sourceGrants) {
    member(grant.source, ['watch_steps', 'phone_spending', 'app_usage', 'photo', 'calendar', 'note', 'office'])
    member(grant.purpose, ['import_daily_summary', 'use_in_journal'])
    member(grant.status, ['active', 'revoked', 'provider_permission_missing'])
    integer(grant.grantVersion, 1); timestamp(grant.approvedAt); check(Array.isArray(grant.scope))
    grant.scope.forEach(text)
    if (grant.revokedAt != null) timestamp(grant.revokedAt)
    if (grant.providerPermissionRef != null) text(grant.providerPermissionRef)
  }
}

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

  /** Restores internal state only. Operation receipts intentionally do not survive a browser session. */
  restoreSpace(snapshot: SpaceSnapshot): SpaceSnapshot {
    let restored: SpaceSnapshot
    try {
      restored = structuredClone(snapshot)
      validateSnapshot(restored)
    } catch {
      throw new LocalDomainError('invalid_input')
    }
    if (this.spaces.has(restored.id)) throw new LocalDomainError('revision_conflict')
    this.spaces.set(restored.id, restored)
    this.operations.set(restored.id, new Map())
    return structuredClone(restored)
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
