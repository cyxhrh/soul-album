import { describe, expect, it } from 'vitest'
import { LocalJournalService } from './journal.js'
import { LocalPreferencesService } from './preferences.js'
import { InMemorySpaceRepository } from './store.js'

const SPACE = '00000000-0000-4000-8000-000000000001'
const operationIds = new Map<string, string>()
function operationId(label: string): string {
  if (!operationIds.has(label)) {
    operationIds.set(label, `00000000-0000-4000-8001-${String(operationIds.size + 1).padStart(12, '0')}`)
  }
  return operationIds.get(label)!
}

function setup() {
  let next = 0
  let currentTime = '2026-09-29T01:00:00Z'
  const repository = new InMemorySpaceRepository({
    now: () => currentTime,
    newId: () => `00000000-0000-4000-8002-${String(++next).padStart(12, '0')}`,
  })
  repository.createSpace(SPACE, 'Asia/Shanghai')
  return {
    repository, preferences: new LocalPreferencesService(repository),
    setNow: (value: string) => { currentTime = value },
  }
}

function displayRoundQuestions(
  repository: InMemorySpaceRepository, invitationId: string, label: string, count: number,
) {
  const journal = new LocalJournalService(repository)
  for (let index = 0; index < count; index += 1) {
    journal.displayQuestion(SPACE, {
      clientOperationId: operationId(`${label}-${index}`),
      expectedSpaceRevision: repository.read(SPACE).revision,
      kind: 'open', displayedAt: `2026-09-29T09:0${index + 1}:00+08:00`,
      citations: [], invitationId,
    })
  }
}

describe('LocalPreferencesService', () => {
  it('atomically schedules, shows and settles an invitation once', () => {
    const { repository, preferences, setNow } = setup()
    const scheduled = preferences.scheduleInvitation(SPACE, {
      clientOperationId: operationId('schedule-1'), expectedSpaceRevision: 0, date: '2026-09-29',
    })
    expect(scheduled.invitations).toMatchObject([{ state: 'scheduled', revision: 1, date: '2026-09-29' }])
    const id = scheduled.invitations[0].id
    const shown = preferences.markInvitationShown(SPACE, {
      clientOperationId: operationId('shown-1'), invitationId: id, event: 'shown',
      occurredAt: '2026-09-29T09:00:00+08:00', expectedRevision: 1,
    })
    expect(shown.invitations[0]).toMatchObject({ state: 'shown', revision: 2 })
    displayRoundQuestions(repository, id, 'settle-question', 1)
    setNow('2026-09-29T16:10:00Z')
    const settled = preferences.settleInvitation(SPACE, {
      clientOperationId: operationId('settle-1'), invitationId: id, event: 'settled_unanswered',
      occurredAt: '2026-09-30T00:05:00+08:00', expectedRevision: 2,
    })
    expect(settled).toMatchObject({ unansweredShownRounds: 1 })
    expect(settled.invitations[0]).toMatchObject({ state: 'settled_unanswered', revision: 3 })
    expect(repository.read(SPACE).revision).toBe(4)
    expect(preferences.settleInvitation(SPACE, {
      clientOperationId: operationId('settle-1'), invitationId: id, event: 'settled_unanswered',
      occurredAt: '2026-09-30T00:05:00+08:00', expectedRevision: 2,
    })).toEqual(settled)
    expect(repository.read(SPACE).revision).toBe(4)
  })

  it('changes cadence tomorrow and pauses without counting a shown round', () => {
    const { repository, preferences } = setup()
    const scheduled = preferences.scheduleInvitation(SPACE, {
      clientOperationId: operationId('schedule-1'), expectedSpaceRevision: 0, date: '2026-09-29',
    })
    const id = scheduled.invitations[0].id
    preferences.markInvitationShown(SPACE, {
      clientOperationId: operationId('shown-1'), invitationId: id, event: 'shown',
      occurredAt: '2026-09-29T09:00:00+08:00', expectedRevision: 1,
    })
    const changed = preferences.setCadence(SPACE, {
      clientOperationId: operationId('cadence-1'), expectedSpaceRevision: 2, requestedCadence: 'weekly',
      requestedAt: '2026-09-29T10:00:00+08:00', timezone: 'Asia/Shanghai',
    })
    expect(changed.pendingChange).toMatchObject({ reason: 'manual_choice', effectiveDate: '2026-09-30' })
    const paused = preferences.pauseInvitations(SPACE, {
      clientOperationId: operationId('pause-1'), expectedSpaceRevision: 3,
      requestedAt: '2026-09-29T11:00:00+08:00', timezone: 'Asia/Shanghai',
    })
    expect(paused.invitations[0].state).toBe('cancelled')
    expect(paused.unansweredShownRounds).toBe(0)
    const resumed = preferences.resumeInvitations(SPACE, {
      clientOperationId: operationId('resume-1'), expectedSpaceRevision: 4,
      requestedAt: '2026-09-29T12:00:00+08:00', timezone: 'Asia/Shanghai',
    })
    expect(resumed.pendingChange?.nextCadence).toBe('weekly')
    expect(repository.read(SPACE).revision).toBe(5)
  })

  it('grants and revokes one app-level source scope without touching another purpose', () => {
    const { repository, preferences } = setup()
    const grant = preferences.grantSource(SPACE, {
      clientOperationId: operationId('grant-1'), source: 'watch_steps', purpose: 'import_daily_summary',
      scope: ['steps'], approvedAt: '2026-09-29T09:00:00+08:00',
    })
    const other = preferences.grantSource(SPACE, {
      clientOperationId: operationId('grant-2'), source: 'watch_steps', purpose: 'use_in_journal',
      scope: ['steps'], approvedAt: '2026-09-29T09:10:00+08:00',
    })
    expect(preferences.hasActiveGrant(SPACE, 'watch_steps', 'import_daily_summary', ['steps'])).toBe(true)
    const revoked = preferences.revokeSource(SPACE, {
      clientOperationId: operationId('revoke-1'), grantId: grant.id, expectedGrantVersion: 1,
      revokedAt: '2026-09-29T12:00:00+08:00',
    })
    expect(revoked).toMatchObject({ status: 'revoked', grantVersion: 2 })
    expect(preferences.hasActiveGrant(SPACE, 'watch_steps', 'import_daily_summary', ['steps'])).toBe(false)
    expect(preferences.hasActiveGrant(SPACE, 'watch_steps', 'use_in_journal', ['steps'])).toBe(true)
    expect(repository.read(SPACE).sourceGrants.map((item) => item.id)).toEqual([grant.id, other.id])
  })

  it('rejects stale revisions, unshown settlement and date-mismatched display without half-writes', () => {
    const { repository, preferences } = setup()
    const scheduled = preferences.scheduleInvitation(SPACE, {
      clientOperationId: operationId('schedule-1'), expectedSpaceRevision: 0, date: '2026-09-29',
    })
    const id = scheduled.invitations[0].id
    expect(() => preferences.settleInvitation(SPACE, {
      clientOperationId: operationId('settle-1'), invitationId: id, event: 'settled_unanswered',
      occurredAt: '2026-09-29T20:00:00+08:00', expectedRevision: 1,
    })).toThrowError('revision_conflict')
    expect(() => preferences.markInvitationShown(SPACE, {
      clientOperationId: operationId('shown-1'), invitationId: id, event: 'shown',
      occurredAt: '2026-09-30T09:00:00+08:00', expectedRevision: 1,
    })).toThrowError('revision_conflict')
    expect(() => preferences.scheduleInvitation(SPACE, {
      clientOperationId: operationId('schedule-2'), expectedSpaceRevision: 0, date: '2026-09-30',
    })).toThrowError('revision_conflict')
    expect(repository.read(SPACE).revision).toBe(1)
    expect(repository.read(SPACE).invitations.invitations[0].state).toBe('scheduled')
  })

  it('cannot settle a round as answered without a recorded answer in that invitation', () => {
    const { repository, preferences } = setup()
    const scheduled = preferences.scheduleInvitation(SPACE, {
      clientOperationId: operationId('schedule-1'), expectedSpaceRevision: 0, date: '2026-09-29',
    })
    const id = scheduled.invitations[0].id
    preferences.markInvitationShown(SPACE, {
      clientOperationId: operationId('shown-1'), invitationId: id, event: 'shown',
      occurredAt: '2026-09-29T09:00:00+08:00', expectedRevision: 1,
    })
    expect(() => preferences.settleInvitation(SPACE, {
      clientOperationId: operationId('settle-1'), invitationId: id, event: 'settled_answered',
      occurredAt: '2026-09-29T20:00:00+08:00', expectedRevision: 2,
    })).toThrowError('revision_conflict')
    expect(repository.read(SPACE).revision).toBe(2)
    expect(repository.read(SPACE).invitations.invitations[0].state).toBe('shown')
  })

  it('counts a valid proactive record in the shown invitation as a response', () => {
    const { repository, preferences, setNow } = setup()
    const journal = new LocalJournalService(repository)
    const scheduled = preferences.scheduleInvitation(SPACE, {
      clientOperationId: operationId('share-schedule'), expectedSpaceRevision: 0, date: '2026-09-29',
    })
    const id = scheduled.invitations[0].id
    preferences.markInvitationShown(SPACE, {
      clientOperationId: operationId('share-shown'), invitationId: id, event: 'shown',
      occurredAt: '2026-09-29T09:00:00+08:00', expectedRevision: 1,
    })
    displayRoundQuestions(repository, id, 'share-question', 1)
    const sent = journal.sendMessage(SPACE, {
      clientOperationId: operationId('share-message'), expectedSpaceRevision: 3,
      text: '随手记：窗边的晚霞', occurredAt: '2026-09-29T10:00:00+08:00',
      timezone: 'Asia/Shanghai', visibleInvitationId: id,
    })
    expect(sent.message.interpretation.kind).toBe('proactive_record')
    expect(sent.entry).not.toBeNull()
    setNow('2026-09-29T16:10:00Z')
    const settled = preferences.settleInvitation(SPACE, {
      clientOperationId: operationId('share-settle'), invitationId: id,
      event: 'settled_answered', occurredAt: '2026-09-30T00:05:00+08:00', expectedRevision: 2,
    })
    expect(settled.invitations[0].state).toBe('settled_answered')
    expect(settled.unansweredShownRounds).toBe(0)
  })

  it('requires one shown question and the next local day before passive unanswered settlement', () => {
    const { repository, preferences, setNow } = setup()
    const invitation = preferences.scheduleInvitation(SPACE, {
      clientOperationId: operationId('incomplete-schedule'), expectedSpaceRevision: 0,
      date: '2026-09-29',
    }).invitations[0]
    preferences.markInvitationShown(SPACE, {
      clientOperationId: operationId('incomplete-shown'), invitationId: invitation.id,
      event: 'shown', occurredAt: '2026-09-29T09:00:00+08:00', expectedRevision: 1,
    })
    expect(() => preferences.settleInvitation(SPACE, {
      clientOperationId: operationId('incomplete-zero'), invitationId: invitation.id,
      event: 'settled_unanswered', occurredAt: '2026-09-30T00:05:00+08:00', expectedRevision: 2,
    })).toThrowError('revision_conflict')
    displayRoundQuestions(repository, invitation.id, 'incomplete-question', 1)
    expect(() => preferences.settleInvitation(SPACE, {
      clientOperationId: operationId('incomplete-one'), invitationId: invitation.id,
      event: 'settled_unanswered', occurredAt: '2026-09-29T20:00:00+08:00', expectedRevision: 2,
    })).toThrowError('revision_conflict')
    expect(() => preferences.settleInvitation(SPACE, {
      clientOperationId: operationId('incomplete-future'), invitationId: invitation.id,
      event: 'settled_unanswered', occurredAt: '2026-09-30T00:05:00+08:00', expectedRevision: 2,
    })).toThrowError('revision_conflict')
    setNow('2026-09-29T16:10:00Z')
    const settled = preferences.settleInvitation(SPACE, {
      clientOperationId: operationId('complete-settle'), invitationId: invitation.id,
      event: 'settled_unanswered', occurredAt: '2026-09-30T00:05:00+08:00', expectedRevision: 2,
    })
    expect(settled.invitations[0].state).toBe('settled_unanswered')
    expect(repository.read(SPACE).revision).toBe(4)
  })

  it('binds explicit space revision fields into operation replay identity', () => {
    const { repository, preferences } = setup()
    const scheduledRequest = {
      clientOperationId: operationId('revision-schedule'), expectedSpaceRevision: 0,
      date: '2026-09-29',
    }
    preferences.scheduleInvitation(SPACE, scheduledRequest)
    expect(() => preferences.scheduleInvitation(SPACE, {
      ...scheduledRequest, expectedSpaceRevision: 1,
    })).toThrowError('idempotency_conflict')

    const cadenceRequest = {
      clientOperationId: operationId('revision-cadence'), expectedSpaceRevision: 1,
      requestedCadence: 'weekly' as const, requestedAt: '2026-09-29T10:00:00+08:00',
      timezone: 'Asia/Shanghai',
    }
    preferences.setCadence(SPACE, cadenceRequest)
    expect(() => preferences.setCadence(SPACE, {
      ...cadenceRequest, expectedSpaceRevision: 2,
    })).toThrowError('idempotency_conflict')

    const pauseRequest = {
      clientOperationId: operationId('revision-pause'), expectedSpaceRevision: 2,
      requestedAt: '2026-09-29T11:00:00+08:00', timezone: 'Asia/Shanghai',
    }
    preferences.pauseInvitations(SPACE, pauseRequest)
    expect(() => preferences.pauseInvitations(SPACE, {
      ...pauseRequest, expectedSpaceRevision: 3,
    })).toThrowError('idempotency_conflict')
    expect(repository.read(SPACE).revision).toBe(3)
  })

  it('settles the round and skips only its still-unanswered ready questions atomically', () => {
    const { repository, preferences } = setup()
    const journal = new LocalJournalService(repository)
    const scheduled = preferences.scheduleInvitation(SPACE, {
      clientOperationId: operationId('question-schedule'), expectedSpaceRevision: 0, date: '2026-09-29',
    })
    const invitationId = scheduled.invitations[0].id
    preferences.markInvitationShown(SPACE, {
      clientOperationId: operationId('question-shown'), invitationId,
      event: 'shown', occurredAt: '2026-09-29T09:00:00+08:00', expectedRevision: 1,
    })
    const answeredQuestion = journal.displayQuestion(SPACE, {
      clientOperationId: operationId('question-first'), expectedSpaceRevision: 2,
      kind: 'open', displayedAt: '2026-09-29T09:01:00+08:00', citations: [], invitationId,
    })
    journal.sendMessage(SPACE, {
      clientOperationId: operationId('question-answer'), expectedSpaceRevision: 3,
      text: '午后散步很放松', occurredAt: '2026-09-29T10:00:00+08:00',
      timezone: 'Asia/Shanghai', visibleInvitationId: invitationId,
      visibleQuestionId: answeredQuestion.id,
    })
    const unansweredQuestion = journal.displayQuestion(SPACE, {
      clientOperationId: operationId('question-second'), expectedSpaceRevision: 4,
      kind: 'moment', displayedAt: '2026-09-29T10:01:00+08:00', citations: [], invitationId,
    })
    preferences.settleInvitation(SPACE, {
      clientOperationId: operationId('question-settle'), invitationId,
      event: 'settled_answered', occurredAt: '2026-09-29T20:00:00+08:00', expectedRevision: 2,
    })
    const snapshot = repository.read(SPACE)
    expect(snapshot.revision).toBe(6)
    expect(snapshot.invitations.invitations[0].state).toBe('settled_answered')
    expect(snapshot.questions.find((item) => item.id === answeredQuestion.id)).toMatchObject({
      status: 'ready', revision: 2,
    })
    expect(snapshot.questions.find((item) => item.id === unansweredQuestion.id)).toMatchObject({
      status: 'skipped', skippedByMessageId: null, revision: 2,
    })
  })
})
