import { InMemorySpaceRepository, LocalJournalService, LocalPreferencesService } from './local/index.js'

const spaceId = '11111111-1111-4111-8111-111111111111'
let nextId = 1
const newId = () => `00000000-0000-4000-8000-${String(nextId++).padStart(12, '0')}`
const now = () => '2026-09-29T09:00:00.000Z'

const repository = new InMemorySpaceRepository({ now, newId })
repository.createSpace(spaceId, 'Asia/Shanghai')
const journal = new LocalJournalService(repository, { now, newId })
const preferences = new LocalPreferencesService(repository)

const question = journal.displayQuestion(spaceId, {
  clientOperationId: newId(), expectedSpaceRevision: 0,
  kind: 'open', displayedAt: '2026-09-29T18:00:00+08:00',
  citations: [],
})
const first = journal.sendMessage(spaceId, {
  clientOperationId: newId(), expectedSpaceRevision: 1,
  text: '演示人物在回家路上看见了一棵开花的树。',
  occurredAt: '2026-09-29T18:05:00+08:00', timezone: 'Asia/Shanghai',
  visibleQuestionId: question.id,
})
const revised = journal.editEntry(spaceId, {
  clientOperationId: newId(), entryId: first.entry!.id, expectedRevision: 1,
  text: '演示人物在回家路上看见了一朵云。',
})
const dayAfterRevision = journal.getDay(spaceId, '2026-09-29')
const deleted = journal.deleteEntry(spaceId, {
  clientOperationId: newId(), entryId: first.entry!.id, expectedRevision: 2,
})
const scheduled = preferences.scheduleInvitation(spaceId, {
  clientOperationId: newId(), expectedSpaceRevision: 4, date: '2026-09-29',
})
const invitationId = scheduled.invitations.at(-1)!.id
preferences.markInvitationShown(spaceId, {
  clientOperationId: newId(), invitationId, event: 'shown',
  occurredAt: '2026-09-29T18:10:00+08:00', expectedRevision: 1,
})
const invitedQuestion = journal.displayQuestion(spaceId, {
  clientOperationId: newId(), expectedSpaceRevision: 6,
  kind: 'open', displayedAt: '2026-09-29T18:10:00+08:00',
  citations: [], invitationId,
})
const declined = journal.sendMessage(spaceId, {
  clientOperationId: newId(), expectedSpaceRevision: 7,
  text: '今天先到这里', occurredAt: '2026-09-29T18:11:00+08:00',
  timezone: 'Asia/Shanghai', visibleInvitationId: invitationId,
  visibleQuestionId: invitedQuestion.id,
})
const grant = preferences.grantSource(spaceId, {
  clientOperationId: newId(), source: 'watch_steps', purpose: 'import_daily_summary',
  scope: ['daily_total'], approvedAt: '2026-09-29T18:12:00+08:00',
})
const appGrantWasActive = preferences.hasActiveGrant(
  spaceId, 'watch_steps', 'import_daily_summary', ['daily_total'],
)
preferences.revokeSource(spaceId, {
  clientOperationId: newId(), grantId: grant.id, expectedGrantVersion: 1,
  revokedAt: '2026-09-29T18:13:00+08:00',
})

console.log(JSON.stringify({
  mode: 'synthetic in-memory local domain demo',
  firstMessage: { id: first.message.id, kind: first.message.interpretation.kind },
  dayAfterRevision,
  revisionEffects: {
    invalidatedQuestionIds: revised.invalidatedQuestionIds,
    withdrawnTitleDates: revised.withdrawnTitleDates,
  },
  deletion: {
    spaceRevision: deleted.spaceRevision,
    remainingDays: journal.listDays(spaceId).dates,
    tombstones: repository.read(spaceId).tombstones,
  },
  invitation: {
    stateAfterDecline: declined.invitation.invitations.at(-1)?.state,
    unansweredShownRounds: declined.invitation.unansweredShownRounds,
  },
  sourcePermission: {
    appGrantWasActive,
    appGrantAfterRevoke: preferences.hasActiveGrant(
      spaceId, 'watch_steps', 'import_daily_summary', ['daily_total'],
    ),
    providerConnected: false,
  },
}, null, 2))
