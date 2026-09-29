import { describe, expect, it } from 'vitest'
import { InMemorySpaceRepository } from './store'
import { LocalJournalService } from './journal'
import { markInvitationShown, scheduleInvitation, setCadence } from './invitations'

const spaceId = '11111111-1111-4111-8111-111111111111'

function id(number: number): string {
  return `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`
}

function setup() {
  const repository = new InMemorySpaceRepository({ now: () => '2026-09-29T01:00:00.000Z' })
  repository.createSpace(spaceId, 'Asia/Shanghai')
  let nextId = 100
  const service = new LocalJournalService(repository, {
    now: () => '2026-09-29T09:00:00.000Z',
    newId: () => id(nextId++),
  })
  return { repository, service }
}

function sendRequest(operation: number, revision: number, text: string) {
  return {
    clientOperationId: id(operation),
    expectedSpaceRevision: revision,
    text,
    occurredAt: '2026-09-29T08:00:00+08:00',
    timezone: 'Asia/Shanghai',
  }
}

describe('local journal service', () => {
  it('saves a reply, its visible question and the day page in one space revision', () => {
    const { repository, service } = setup()
    const question = service.displayQuestion(spaceId, {
      clientOperationId: id(1), expectedSpaceRevision: 0,
      kind: 'open', displayedAt: '2026-09-29T08:00:00+08:00', citations: [],
    })

    const result = service.sendMessage(spaceId, {
      ...sendRequest(2, 1, '傍晚散步时看见一朵云。'), visibleQuestionId: question.id,
    })

    expect(result.spaceRevision).toBe(2)
    expect(result.message.interpretation.kind).toBe('answer')
    expect(result.message.entryId).toBe(result.entry?.id)
    expect(result.answeredQuestion?.id).toBe(question.id)
    expect(result.answeredQuestion?.answeredByMessageId).toBe(result.message.id)
    expect(result.answeredQuestion?.revision).toBe(2)
    expect(service.listMessages(spaceId)[0].text).toBe('傍晚散步时看见一朵云。')
    expect(service.listDays(spaceId).dates).toEqual(['2026-09-29'])
    expect(service.getDay(spaceId, '2026-09-29')?.entries).toEqual([result.entry])
    expect(repository.read(spaceId).revision).toBe(2)
  })

  it('replays the same operation exactly once and rejects changed content under its ID', () => {
    const { repository, service } = setup()
    const firstRequest = sendRequest(3, 0, '这是第一句。')
    const first = service.sendMessage(spaceId, firstRequest)
    service.sendMessage(spaceId, sendRequest(4, 1, '这是第二句。'))

    expect(service.sendMessage(spaceId, firstRequest)).toEqual(first)
    expect(repository.read(spaceId).entries).toHaveLength(2)
    expect(() => service.sendMessage(spaceId, { ...firstRequest, text: '偷换内容。' }))
      .toThrowError(/idempotency_conflict/)
    expect(repository.read(spaceId).revision).toBe(2)
  })

  it('keeps control words out of the album but records a longer ordinary sentence', () => {
    const { service } = setup()
    const control = service.sendMessage(spaceId, sendRequest(5, 0, '跳过这一题'))
    expect(control.message.controlEvent).toBe('skip')
    expect(control.entry).toBeNull()
    expect(service.listDays(spaceId).dates).toEqual([])

    const ordinary = service.sendMessage(spaceId, sendRequest(6, 1, '我路过时想起“跳过这一题”这句话。'))
    expect(ordinary.message.controlEvent).toBeNull()
    expect(ordinary.entry?.text).toContain('跳过这一题')
    expect(service.listDays(spaceId).dates).toEqual(['2026-09-29'])
  })

  it('uses the chosen IANA timezone when the event crosses a date boundary', () => {
    const { service } = setup()
    const result = service.sendMessage(spaceId, {
      ...sendRequest(7, 0, '午夜之后的记录。'),
      occurredAt: '2026-09-28T16:30:00Z',
    })
    expect(result.entry?.journalDate).toBe('2026-09-29')
    expect(service.getDay(spaceId, '2026-09-28')).toBeNull()
  })

  it('asks a gentle follow-up without echoing a punctuated entry', () => {
    const { service } = setup()
    const saved = service.sendMessage(spaceId, sendRequest(97, 0, '今天去了河边，看到夕阳，很开心。'))
    const question = service.displayQuestion(spaceId, {
      clientOperationId: id(98), expectedSpaceRevision: 1,
      kind: 'reflection', displayedAt: '2026-09-29T08:01:00+08:00',
      citations: [{ kind: 'entry', id: saved.entry!.id, revision: 1 }],
    })
    expect(question.text).toBe('关于这段记录，还有什么想补充的吗？')
    expect(question.text).not.toContain(saved.entry!.text)
    expect(question.citations).toEqual([{ kind: 'entry', id: saved.entry!.id, revision: 1 }])
  })

  it('atomically adopts a cloud proposal only for the current cited unanswered rule question', () => {
    const { repository, service } = setup()
    const saved = service.sendMessage(spaceId, sendRequest(650, 0, '傍晚经过河边，停了一会儿。'))
    const question = service.displayQuestion(spaceId, {
      clientOperationId: id(651), expectedSpaceRevision: 1, kind: 'reflection',
      displayedAt: '2026-09-29T08:01:00+08:00',
      citations: [{ kind: 'entry', id: saved.entry!.id, revision: 1 }],
    })
    const request = {
      clientOperationId: id(652), expectedSpaceRevision: 2,
      questionId: question.id, expectedQuestionRevision: question.revision,
      entryCitation: { id: saved.entry!.id, revision: 1 },
      entryQuote: '傍晚经过河边',
      text: '在河边停下来的那一刻，你留意到了什么？',
    }
    const adopted = service.adoptCloudQuestion(spaceId, request)
    expect(adopted).toMatchObject({
      id: question.id, revision: 2, status: 'ready', provenance: 'cloud_model',
      text: request.text, citations: question.citations,
      approvedExcerpt: request.entryQuote,
    })
    expect(repository.read(spaceId).questions).toHaveLength(1)
    expect(repository.read(spaceId).revision).toBe(3)
    expect(service.adoptCloudQuestion(spaceId, request)).toEqual(adopted)
    expect(() => service.adoptCloudQuestion(spaceId, { ...request, entryQuote: '经过河边，停了' }))
      .toThrowError(/idempotency_conflict/)
    expect(() => service.adoptCloudQuestion(spaceId, { ...request, clientOperationId: id(653), expectedSpaceRevision: 3, expectedQuestionRevision: 2 }))
      .toThrowError(/revision_conflict/)

    const correction = service.recordQuestionCorrection(spaceId, {
      clientOperationId: id(654), expectedSpaceRevision: 3,
      questionId: question.id, expectedQuestionRevision: adopted.revision,
      entryCitation: { id: saved.entry!.id, revision: 1 },
      text: '那时我在等一位朋友，不是在独自散心。',
      correctedAt: '2026-09-29T08:02:00+08:00',
    })
    expect(correction).toMatchObject({
      text: '那时我在等一位朋友，不是在独自散心。',
      status: 'user_corrected', provenance: 'user_correction',
      citations: [{ kind: 'entry', id: saved.entry!.id, revision: 1 }],
    })
    expect(repository.read(spaceId).questions[0]).toMatchObject({
      id: question.id, text: '理解已更正', status: 'user_corrected', revision: 3,
    })
    expect(() => service.sendMessage(spaceId, {
      ...sendRequest(655, 4, '我继续回答旧问题。'), visibleQuestionId: question.id,
    })).toThrowError(/revision_conflict/)

    service.editEntry(spaceId, {
      clientOperationId: id(656), entryId: saved.entry!.id, expectedRevision: 1,
      text: '更改后的原话。',
    })
    const afterEdit = repository.read(spaceId)
    expect(afterEdit.observations).toEqual([])
    expect(afterEdit.questions[0].text).toBe('引用已修订')
    expect(afterEdit.questions[0].approvedExcerpt).toBeUndefined()
    expect(JSON.stringify(afterEdit)).not.toContain(request.entryQuote)
    expect(JSON.stringify(afterEdit)).not.toContain('那时我在等一位朋友')
    expect(JSON.stringify(afterEdit)).not.toContain('在河边停下来的那一刻')
  })

  it('rejects late cloud responses after source, question, or space state changes', () => {
    const { repository, service } = setup()
    const saved = service.sendMessage(spaceId, sendRequest(660, 0, '今天走了很远。'))
    const question = service.displayQuestion(spaceId, {
      clientOperationId: id(661), expectedSpaceRevision: 1, kind: 'reflection',
      displayedAt: '2026-09-29T08:01:00+08:00',
      citations: [{ kind: 'entry', id: saved.entry!.id, revision: 1 }],
    })
    const request = {
      clientOperationId: id(662), expectedSpaceRevision: 2,
      questionId: question.id, expectedQuestionRevision: question.revision,
      entryCitation: { id: saved.entry!.id, revision: 1 },
      entryQuote: saved.entry!.text,
      text: '走了很远以后，你最想记住哪个片段？',
    }
    expect(() => service.adoptCloudQuestion(spaceId, { ...request, entryCitation: { id: id(999), revision: 1 } }))
      .toThrowError(/revision_conflict/)
    expect(() => service.adoptCloudQuestion(spaceId, { ...request, entryQuote: '不存在的长片段' }))
      .toThrowError(/revision_conflict/)
    expect(() => service.adoptCloudQuestion(spaceId, { ...request, text: '\n不合适的问题' }))
      .toThrowError(/invalid_input/)
    expect(repository.read(spaceId).revision).toBe(2)

    service.sendMessage(spaceId, {
      ...sendRequest(663, 2, '继续记下一句。'), visibleQuestionId: question.id,
    })
    expect(() => service.adoptCloudQuestion(spaceId, request)).toThrowError(/revision_conflict/)
    expect(repository.read(spaceId).questions[0].provenance).toBe('local_rule')
  })

  it('does not restore an edited source when a delayed cloud proposal arrives', () => {
    const { repository, service } = setup()
    const saved = service.sendMessage(spaceId, sendRequest(670, 0, '旧的私人记录。'))
    const question = service.displayQuestion(spaceId, {
      clientOperationId: id(671), expectedSpaceRevision: 1, kind: 'reflection',
      displayedAt: '2026-09-29T08:01:00+08:00',
      citations: [{ kind: 'entry', id: saved.entry!.id, revision: 1 }],
    })
    service.editEntry(spaceId, {
      clientOperationId: id(672), entryId: saved.entry!.id, expectedRevision: 1,
      text: '重新表述的记录。',
    })
    expect(() => service.adoptCloudQuestion(spaceId, {
      clientOperationId: id(673), expectedSpaceRevision: 2,
      questionId: question.id, expectedQuestionRevision: 1,
      entryCitation: { id: saved.entry!.id, revision: 1 },
      entryQuote: saved.entry!.text,
      text: '关于旧的私人记录，你还想说什么？',
    })).toThrowError(/revision_conflict/)
    expect(JSON.stringify(repository.read(spaceId))).not.toContain('旧的私人记录')
  })

  it('files a later correction on its actual day and removes that page with its source', () => {
    const { repository, service } = setup()
    const saved = service.sendMessage(spaceId, sendRequest(680, 0, '第一天经过河边，记下了晚风。'))
    const question = service.displayQuestion(spaceId, {
      clientOperationId: id(681), expectedSpaceRevision: 1, kind: 'reflection',
      displayedAt: '2026-09-29T08:01:00+08:00',
      citations: [{ kind: 'entry', id: saved.entry!.id, revision: 1 }],
    })
    const adopted = service.adoptCloudQuestion(spaceId, {
      clientOperationId: id(682), expectedSpaceRevision: 2,
      questionId: question.id, expectedQuestionRevision: 1,
      entryCitation: { id: saved.entry!.id, revision: 1 },
      entryQuote: '第一天经过河边', text: '那天独自散步时，晚风让你想起什么？',
    })
    const correction = service.recordQuestionCorrection(spaceId, {
      clientOperationId: id(683), expectedSpaceRevision: 3,
      questionId: question.id, expectedQuestionRevision: adopted.revision,
      entryCitation: { id: saved.entry!.id, revision: 1 },
      text: '其实我是在等朋友。', correctedAt: '2026-09-30T09:00:00+08:00',
    })
    expect(correction).toMatchObject({
      journalDate: '2026-09-30', recordedAt: '2026-09-29T09:00:00.000Z',
    })
    expect(service.listDays(spaceId).dates).toEqual(['2026-09-30', '2026-09-29'])
    expect(service.getDay(spaceId, '2026-09-29')?.observations).toEqual([])
    expect(service.getDay(spaceId, '2026-09-30')).toMatchObject({
      entries: [], observations: [correction],
    })
    service.setDayTitle(spaceId, {
      clientOperationId: id(684), date: '2026-09-30', text: '更正那天的记忆',
      expectedRevision: 0, expectedSpaceRevision: 4,
    })
    expect(service.getDay(spaceId, '2026-09-30')?.title?.text).toBe('更正那天的记忆')

    service.deleteEntry(spaceId, {
      clientOperationId: id(685), entryId: saved.entry!.id, expectedRevision: 1,
    })
    expect(service.listDays(spaceId).dates).toEqual([])
    expect(service.getDay(spaceId, '2026-09-30')).toBeNull()
    const serialized = JSON.stringify(repository.read(spaceId))
    expect(serialized).not.toContain('第一天经过河边')
    expect(serialized).not.toContain('其实我是在等朋友')
    expect(serialized).not.toContain('更正那天的记忆')
  })

  it('redacts dependent questions and titles when an entry changes, then scrubs deletion', () => {
    const { repository, service } = setup()
    const first = service.sendMessage(spaceId, sendRequest(8, 0, '秘密旧句。'))
    const entry = first.entry!
    const question = service.displayQuestion(spaceId, {
      clientOperationId: id(9), expectedSpaceRevision: 1,
      kind: 'reflection',
      displayedAt: '2026-09-29T08:05:00+08:00',
      citations: [{ kind: 'entry', id: entry.id, revision: entry.revision }],
    })
    expect(question.text).toBe('关于这段记录，还有什么想补充的吗？')
    expect(question.citations).toEqual([{ kind: 'entry', id: entry.id, revision: entry.revision }])
    service.setDayTitle(spaceId, {
      clientOperationId: id(10), date: '2026-09-29', text: '秘密旧句。',
      expectedRevision: 0, expectedSpaceRevision: 2,
    })

    const edited = service.editEntry(spaceId, {
      clientOperationId: id(11), entryId: entry.id, expectedRevision: 1, text: '新的说法。',
    })
    expect(edited.invalidatedQuestionIds).toContain(question.id)
    expect(edited.withdrawnTitleDates).toEqual(['2026-09-29'])
    expect(service.listMessages(spaceId)[0].text).toBe('新的说法。')
    expect(service.listMessages(spaceId)[0].revision).toBe(2)
    expect(service.getDay(spaceId, '2026-09-29')?.questions[0]).toMatchObject({
      status: 'citation_revised', text: '引用已修订',
    })
    expect(JSON.stringify(repository.read(spaceId))).not.toContain('秘密旧句')

    service.deleteEntry(spaceId, {
      clientOperationId: id(12), entryId: entry.id, expectedRevision: 2,
    })
    expect(service.listMessages(spaceId)).toEqual([])
    expect(service.listDays(spaceId).dates).toEqual([])
    expect(JSON.stringify(repository.read(spaceId))).not.toContain('新的说法')
    expect(repository.read(spaceId).tombstones).toEqual(expect.arrayContaining([
      expect.objectContaining({ entityId: entry.id, entityKind: 'entry' }),
    ]))
  })

  it('rejects stale writes without changing another space', () => {
    const { repository, service } = setup()
    const other = id(999)
    repository.createSpace(other, 'UTC')
    service.sendMessage(spaceId, sendRequest(13, 0, '只在第一个空间。'))
    expect(() => service.sendMessage(spaceId, sendRequest(14, 0, '过时写入。')))
      .toThrowError(/revision_conflict/)
    expect(service.listDays(other).dates).toEqual([])
    expect(repository.read(spaceId).entries).toHaveLength(1)
  })

  it('never reuses a message sequence after deletion', () => {
    const { service } = setup()
    const first = service.sendMessage(spaceId, sendRequest(15, 0, '待删除的一句。'))
    service.deleteEntry(spaceId, {
      clientOperationId: id(16), entryId: first.entry!.id, expectedRevision: 1,
    })
    const second = service.sendMessage(spaceId, sendRequest(17, 2, '后写的一句。'))
    expect(second.message.sequence).toBe(first.message.sequence + 1)
  })

  it('replays an entry change even after a different later write', () => {
    const { repository, service } = setup()
    const first = service.sendMessage(spaceId, sendRequest(18, 0, '旧句。'))
    const change = {
      clientOperationId: id(19), entryId: first.entry!.id, expectedRevision: 1, text: '新句。',
    }
    const edited = service.editEntry(spaceId, change)
    service.sendMessage(spaceId, sendRequest(20, 2, '另一句。'))
    expect(service.editEntry(spaceId, change)).toEqual(edited)
    expect(repository.read(spaceId).entries).toHaveLength(2)
  })

  it('links a shown invitation and closes the whole round when the user declines', () => {
    const { repository, service } = setup()
    repository.transact(spaceId, {
      clientOperationId: id(21), fingerprint: 'synthetic invitation', expectedSpaceRevision: 0,
    }, (draft) => {
      draft.invitations = markInvitationShown(
        scheduleInvitation(draft.invitations, id(22), draft.invitations.cadenceAnchorDate),
        id(22), '2026-09-29T08:00:00+08:00',
      )
    })
    const declined = service.sendMessage(spaceId, {
      ...sendRequest(23, 1, '今天不想回答'), visibleInvitationId: id(22),
    })
    expect(declined.message.invitationId).toBe(id(22))
    expect(declined.invitation.invitations[0].state).toBe('settled_unanswered')
    expect(declined.invitation.unansweredShownRounds).toBe(1)
    expect(repository.read(spaceId).invitations).toEqual(declined.invitation)
  })

  it('can atomically close a final answer without treating an earlier answer as a finished round', () => {
    const { repository, service } = setup()
    repository.transact(spaceId, {
      clientOperationId: id(52), fingerprint: 'synthetic invitation', expectedSpaceRevision: 0,
    }, (draft) => {
      draft.invitations = markInvitationShown(
        scheduleInvitation(draft.invitations, id(53), draft.invitations.cadenceAnchorDate),
        id(53), '2026-09-29T08:00:00+08:00',
      )
    })
    const question = service.displayQuestion(spaceId, {
      clientOperationId: id(54), expectedSpaceRevision: 1,
      kind: 'open', displayedAt: '2026-09-29T08:00:00+08:00', citations: [],
      invitationId: id(53),
    })
    const answer = service.sendMessage(spaceId, {
      ...sendRequest(55, 2, '今天看见雨后的树。'), visibleQuestionId: question.id,
      visibleInvitationId: id(53),
    })
    expect(answer.invitation.invitations[0].state).toBe('shown')
    const secondQuestion = service.displayQuestion(spaceId, {
      clientOperationId: id(63), expectedSpaceRevision: 3,
      kind: 'moment', displayedAt: '2026-09-29T08:06:00+08:00', citations: [],
      invitationId: id(53),
    })
    expect(() => service.displayQuestion(spaceId, {
      clientOperationId: id(59), expectedSpaceRevision: 4,
      kind: 'open', displayedAt: '2026-09-29T08:07:00+08:00', citations: [],
      invitationId: id(53),
    })).toThrowError(/revision_conflict/)
    expect(() => service.sendMessage(spaceId, {
      ...sendRequest(57, 4, '我仍在回答第一题。'), visibleInvitationId: id(53),
      visibleQuestionId: question.id, closeRound: true,
    })).toThrowError(/revision_conflict/)
    expect(() => service.sendMessage(spaceId, {
      ...sendRequest(58, 4, '这是一句主动分享。'), visibleInvitationId: id(53),
      closeRound: true,
    })).toThrowError(/revision_conflict/)
    expect(repository.read(spaceId).revision).toBe(4)
    const final = service.sendMessage(spaceId, {
      ...sendRequest(56, 4, '还记下了一朵云。'), visibleInvitationId: id(53),
      visibleQuestionId: secondQuestion.id, closeRound: true,
    })
    expect(final.invitation.invitations[0].state).toBe('settled_answered')
    expect(final.spaceRevision).toBe(5)
    expect(repository.read(spaceId).invitations).toEqual(final.invitation)
  })

  it('rejects a premature close and a question from outside the shown invitation', () => {
    const { repository, service } = setup()
    repository.transact(spaceId, {
      clientOperationId: id(64), fingerprint: 'synthetic invitation', expectedSpaceRevision: 0,
    }, (draft) => {
      draft.invitations = markInvitationShown(
        scheduleInvitation(draft.invitations, id(65), draft.invitations.cadenceAnchorDate),
        id(65), '2026-09-29T08:00:00+08:00',
      )
    })
    const invited = service.displayQuestion(spaceId, {
      clientOperationId: id(66), expectedSpaceRevision: 1,
      kind: 'open', displayedAt: '2026-09-29T08:00:00+08:00', citations: [],
      invitationId: id(65),
    })
    expect(() => service.displayQuestion(spaceId, {
      clientOperationId: id(83), expectedSpaceRevision: 2,
      kind: 'moment', displayedAt: '2026-09-29T08:01:00+08:00', citations: [],
      invitationId: id(65),
    })).toThrowError(/revision_conflict/)
    expect(() => service.displayQuestion(spaceId, {
      clientOperationId: id(84), expectedSpaceRevision: 2,
      kind: 'moment', displayedAt: '2026-09-30T08:01:00+08:00', citations: [],
      invitationId: id(65),
    })).toThrowError(/revision_conflict/)
    expect(() => service.sendMessage(spaceId, {
      ...sendRequest(67, 2, '第一题的回答。'), visibleQuestionId: invited.id,
      visibleInvitationId: id(65), closeRound: true,
    })).toThrowError(/revision_conflict/)
    const free = service.displayQuestion(spaceId, {
      clientOperationId: id(68), expectedSpaceRevision: 2,
      kind: 'moment', displayedAt: '2026-09-29T08:01:00+08:00', citations: [],
    })
    expect(() => service.sendMessage(spaceId, {
      ...sendRequest(69, 3, '不属于本轮的答案。'), visibleQuestionId: free.id,
      visibleInvitationId: id(65),
    })).toThrowError(/revision_conflict/)
    expect(repository.read(spaceId).revision).toBe(3)
  })

  it('keeps the question target of a shown daily invitation after cadence changes', () => {
    const { repository, service } = setup()
    repository.transact(spaceId, {
      clientOperationId: id(76), fingerprint: 'synthetic daily invitation', expectedSpaceRevision: 0,
    }, (draft) => {
      draft.invitations = markInvitationShown(
        scheduleInvitation(draft.invitations, id(77), '2026-09-29'),
        id(77), '2026-09-29T08:00:00+08:00',
      )
    })
    const firstQuestion = service.displayQuestion(spaceId, {
      clientOperationId: id(78), expectedSpaceRevision: 1,
      kind: 'open', displayedAt: '2026-09-29T08:00:00+08:00', citations: [],
      invitationId: id(77),
    })
    repository.transact(spaceId, {
      clientOperationId: id(79), fingerprint: 'next-day weekly cadence', expectedSpaceRevision: 2,
    }, (draft) => {
      draft.invitations = scheduleInvitation(setCadence(
        draft.invitations, 'weekly', '2026-09-29', '2026-09-29T08:30:00+08:00', id(80),
      ), id(81), '2026-09-30')
    })
    expect(repository.read(spaceId).invitations.cadence).toBe('weekly')
    expect(repository.read(spaceId).invitations.invitations[0].questionTarget).toBe(2)
    expect(() => service.sendMessage(spaceId, {
      ...sendRequest(82, 3, '只答了旧邀请的第一题。'),
      visibleQuestionId: firstQuestion.id, visibleInvitationId: id(77), closeRound: true,
    })).toThrowError(/revision_conflict/)
    expect(repository.read(spaceId).revision).toBe(3)
  })

  it('can finish a shown round after deleting the first answer without retaining its text', () => {
    const { repository, service } = setup()
    repository.transact(spaceId, {
      clientOperationId: id(85), fingerprint: 'synthetic invitation', expectedSpaceRevision: 0,
    }, (draft) => {
      draft.invitations = markInvitationShown(
        scheduleInvitation(draft.invitations, id(86), '2026-09-29'),
        id(86), '2026-09-29T08:00:00+08:00',
      )
    })
    const firstQuestion = service.displayQuestion(spaceId, {
      clientOperationId: id(87), expectedSpaceRevision: 1,
      kind: 'open', displayedAt: '2026-09-29T08:00:00+08:00', citations: [],
      invitationId: id(86),
    })
    const firstAnswer = service.sendMessage(spaceId, {
      ...sendRequest(88, 2, '这一句稍后要彻底删除。'),
      visibleQuestionId: firstQuestion.id, visibleInvitationId: id(86),
    })
    const lastQuestion = service.displayQuestion(spaceId, {
      clientOperationId: id(89), expectedSpaceRevision: 3,
      kind: 'moment', displayedAt: '2026-09-29T08:05:00+08:00', citations: [],
      invitationId: id(86),
    })
    service.deleteEntry(spaceId, {
      clientOperationId: id(90), entryId: firstAnswer.entry!.id, expectedRevision: 1,
    })
    const afterDeletion = repository.read(spaceId)
    expect(afterDeletion.questions).toHaveLength(2)
    expect(afterDeletion.questions[0]).toMatchObject({
      id: firstQuestion.id, answeredByMessageId: null, status: 'skipped',
    })
    expect(JSON.stringify(afterDeletion)).not.toContain('这一句稍后要彻底删除。')
    const final = service.sendMessage(spaceId, {
      ...sendRequest(91, 5, '今天想记住窗边的光。'),
      visibleQuestionId: lastQuestion.id, visibleInvitationId: id(86), closeRound: true,
    })
    expect(final.invitation.invitations[0].state).toBe('settled_answered')
    expect(service.getDay(spaceId, '2026-09-29')?.entries).toHaveLength(1)
  })

  it('rejects a fabricated or unshown invitation context atomically', () => {
    const { repository, service } = setup()
    expect(() => service.sendMessage(spaceId, {
      ...sendRequest(24, 0, '今天的一句。'), visibleInvitationId: id(25),
    })).toThrowError(/not_found|revision_conflict/)
    expect(repository.read(spaceId).revision).toBe(0)
    expect(repository.read(spaceId).entries).toEqual([])
  })

  it('rejects a stale shown invitation when a newer round is already shown', () => {
    const { repository, service } = setup()
    repository.transact(spaceId, {
      clientOperationId: id(92), fingerprint: 'stale invitation fixture', expectedSpaceRevision: 0,
    }, (draft) => {
      let state = markInvitationShown(
        scheduleInvitation(draft.invitations, id(93), '2026-09-29'),
        id(93), '2026-09-29T08:00:00+08:00',
      )
      state = scheduleInvitation(state, id(94), '2026-09-30')
      state.invitations[1] = {
        ...state.invitations[1], state: 'shown', revision: 2,
        shownAt: '2026-09-30T08:00:00+08:00',
      }
      draft.invitations = state
    })
    expect(() => service.sendMessage(spaceId, {
      ...sendRequest(95, 1, '今天先到这里'), visibleInvitationId: id(93),
    })).toThrowError(/revision_conflict/)
    expect(() => service.displayQuestion(spaceId, {
      clientOperationId: id(96), expectedSpaceRevision: 1,
      kind: 'open', displayedAt: '2026-09-29T08:00:00+08:00', citations: [],
      invitationId: id(93),
    })).toThrowError(/revision_conflict/)
    expect(repository.read(spaceId).revision).toBe(1)
    expect(repository.read(spaceId).messages).toEqual([])
  })

  it('rejects empty or overlong text without saving it', () => {
    const { repository, service } = setup()
    expect(() => service.sendMessage(spaceId, sendRequest(26, 0, '  '))).toThrowError(/invalid_input/)
    expect(() => service.sendMessage(spaceId, sendRequest(27, 0, 'x'.repeat(10_001))))
      .toThrowError(/invalid_input/)
    expect(repository.read(spaceId).revision).toBe(0)
  })

  it('withdraws a later title and observation-derived question when an earlier entry changes', () => {
    const { repository, service } = setup()
    const first = service.sendMessage(spaceId, sendRequest(28, 0, '那天看见晚霞。'))
    const firstEntry = first.entry!
    const observationId = id(29)
    repository.transact(spaceId, {
      clientOperationId: id(30), fingerprint: 'synthetic observation', expectedSpaceRevision: 1,
    }, (draft) => {
      draft.observations.push({
        id: observationId, text: '曾经留意晚霞', status: 'user_corrected',
        provenance: 'local_rule', revision: 1,
        citations: [{ kind: 'entry', id: firstEntry.id, revision: 1 }],
      })
    })
    service.sendMessage(spaceId, {
      ...sendRequest(31, 2, '第二天的事。'), occurredAt: '2026-09-30T08:00:00+08:00',
    })
    service.setDayTitle(spaceId, {
      clientOperationId: id(32), date: '2026-09-30', text: '记得那天晚霞',
      expectedRevision: 0, expectedSpaceRevision: 3,
    })
    const question = service.displayQuestion(spaceId, {
      clientOperationId: id(33), expectedSpaceRevision: 4,
      kind: 'reflection', displayedAt: '2026-09-30T09:00:00+08:00',
      citations: [{ kind: 'observation', id: observationId, revision: 1 }],
    })

    const changed = service.editEntry(spaceId, {
      clientOperationId: id(34), entryId: firstEntry.id, expectedRevision: 1,
      text: '那天看见树影。',
    })
    expect(changed.invalidatedObservationIds).toEqual([observationId])
    expect(changed.invalidatedQuestionIds).toEqual([question.id])
    expect(changed.withdrawnTitleDates).toEqual(['2026-09-30'])
    expect(service.getDay(spaceId, '2026-09-30')?.title).toBeNull()
    expect(JSON.stringify(repository.read(spaceId))).not.toContain('晚霞')
    expect(repository.read(spaceId).tombstones).toEqual(expect.arrayContaining([
      expect.objectContaining({ entityKind: 'observation', entityId: observationId }),
    ]))
  })

  it('keeps an entry and its day page in the space timezone', () => {
    const { repository, service } = setup()
    expect(() => service.sendMessage(spaceId, {
      ...sendRequest(38, 0, '时区不匹配。'), timezone: 'America/Los_Angeles',
    })).toThrowError(/invalid_input/)
    expect(repository.read(spaceId).entries).toEqual([])
  })

  it('does not withdraw dependent text for a no-op edit', () => {
    const { repository, service } = setup()
    const first = service.sendMessage(spaceId, sendRequest(46, 0, '同一句。'))
    service.setDayTitle(spaceId, {
      clientOperationId: id(47), date: '2026-09-29', text: '同一句。',
      expectedRevision: 0, expectedSpaceRevision: 1,
    })
    expect(() => service.editEntry(spaceId, {
      clientOperationId: id(48), entryId: first.entry!.id,
      expectedRevision: 1, text: '同一句。',
    })).toThrowError(/invalid_input/)
    expect(repository.read(spaceId).revision).toBe(2)
    expect(service.getDay(spaceId, '2026-09-29')?.title?.text).toBe('同一句。')
  })

  it('never stores caller-supplied question prose without a complete trusted citation path', () => {
    const { repository, service } = setup()
    service.sendMessage(spaceId, sendRequest(35, 0, '只属于这条记录的旧话。'))
    const forged = {
      clientOperationId: id(36), expectedSpaceRevision: 1,
      kind: 'open' as const, displayedAt: '2026-09-29T08:05:00+08:00', citations: [],
      text: '你之前说“只属于这条记录的旧话。”',
    }
    expect(() => service.displayQuestion(spaceId, forged)).toThrowError(/invalid_input/)
    expect(() => service.displayQuestion(spaceId, {
      clientOperationId: id(37), expectedSpaceRevision: 1,
      kind: 'reflection', displayedAt: '2026-09-29T08:05:00+08:00', citations: [],
    })).toThrowError(/invalid_input/)
    expect(repository.read(spaceId).questions).toEqual([])
  })

  it('lets a user correct a skip into a recorded answer in one revision', () => {
    const { repository, service } = setup()
    const question = service.displayQuestion(spaceId, {
      clientOperationId: id(39), expectedSpaceRevision: 0,
      kind: 'open', displayedAt: '2026-09-29T08:00:00+08:00', citations: [],
    })
    const skipped = service.sendMessage(spaceId, {
      ...sendRequest(40, 1, '跳过这一题'), visibleQuestionId: question.id,
    })
    expect(skipped.entry).toBeNull()
    expect(repository.read(spaceId).questions[0]).toMatchObject({
      status: 'skipped', skippedByMessageId: skipped.message.id,
    })
    const corrected = service.correctInterpretation(spaceId, {
      clientOperationId: id(41), messageId: skipped.message.id,
      expectedMessageRevision: 1, correctedKind: 'answer',
    })
    expect(corrected.spaceRevision).toBe(3)
    expect(corrected.message).toMatchObject({
      id: skipped.message.id, revision: 2,
      interpretation: { kind: 'answer', status: 'user_corrected', provenance: 'user_correction' },
      controlEvent: null,
    })
    expect(corrected.entry?.text).toBe('跳过这一题')
    expect(corrected.answeredQuestion?.answeredByMessageId).toBe(skipped.message.id)
    expect(corrected.answeredQuestion?.status).toBe('ready')
    expect(service.getDay(spaceId, '2026-09-29')?.entries).toHaveLength(1)
    expect(repository.read(spaceId).messages[0].controlText).toBeNull()
  })

  it('does not let a later ordinary message answer a skipped question', () => {
    const { repository, service } = setup()
    const question = service.displayQuestion(spaceId, {
      clientOperationId: id(49), expectedSpaceRevision: 0,
      kind: 'open', displayedAt: '2026-09-29T08:00:00+08:00', citations: [],
    })
    service.sendMessage(spaceId, {
      ...sendRequest(50, 1, '换个问题'), visibleQuestionId: question.id,
    })
    expect(() => service.sendMessage(spaceId, {
      ...sendRequest(51, 2, '这应当是下一题的回答。'), visibleQuestionId: question.id,
    })).toThrowError(/revision_conflict/)
    expect(repository.read(spaceId).revision).toBe(2)
  })

  it('keeps a historical skipped question closed after its control message is removed', () => {
    const { repository, service } = setup()
    const first = service.displayQuestion(spaceId, {
      clientOperationId: id(57), expectedSpaceRevision: 0,
      kind: 'open', displayedAt: '2026-09-29T08:00:00+08:00', citations: [],
    })
    const skip = service.sendMessage(spaceId, {
      ...sendRequest(58, 1, '换个问题'), visibleQuestionId: first.id,
    })
    const second = service.displayQuestion(spaceId, {
      clientOperationId: id(59), expectedSpaceRevision: 2,
      kind: 'moment', displayedAt: '2026-09-29T08:01:00+08:00', citations: [],
    })
    service.sendMessage(spaceId, {
      ...sendRequest(60, 3, '看见了蓝色纸船。'), visibleQuestionId: second.id,
    })
    service.deleteControlMessage(spaceId, {
      clientOperationId: id(61), messageId: skip.message.id, expectedMessageRevision: 1,
    })
    expect(repository.read(spaceId).questions.find((item) => item.id === first.id)?.status).toBe('skipped')
    expect(() => service.sendMessage(spaceId, {
      ...sendRequest(62, 5, '不应误答旧题。'), visibleQuestionId: first.id,
    })).toThrowError(/revision_conflict/)
  })

  it('settles a shown invitation when an earlier answer is corrected to decline', () => {
    const { repository, service } = setup()
    repository.transact(spaceId, {
      clientOperationId: id(70), fingerprint: 'synthetic invitation', expectedSpaceRevision: 0,
    }, (draft) => {
      draft.invitations = markInvitationShown(
        scheduleInvitation(draft.invitations, id(71), draft.invitations.cadenceAnchorDate),
        id(71), '2026-09-29T08:00:00+08:00',
      )
    })
    const question = service.displayQuestion(spaceId, {
      clientOperationId: id(72), expectedSpaceRevision: 1,
      kind: 'open', displayedAt: '2026-09-29T08:00:00+08:00', citations: [],
      invitationId: id(71),
    })
    const answer = service.sendMessage(spaceId, {
      ...sendRequest(73, 2, '实际上想先停下。'), visibleQuestionId: question.id,
      visibleInvitationId: id(71),
    })
    expect(answer.invitation.invitations[0].state).toBe('shown')
    const corrected = service.correctInterpretation(spaceId, {
      clientOperationId: id(74), messageId: answer.message.id,
      expectedMessageRevision: 1, correctedKind: 'decline',
    })
    expect(corrected.invitation.invitations[0].state).toBe('settled_unanswered')
    expect(corrected.invitation.unansweredShownRounds).toBe(1)
    expect(corrected.entry).toBeNull()
    expect(repository.read(spaceId).questions[0].status).toBe('skipped')
  })

  it('can correct a settled decline to an answer without reusing an old receipt', () => {
    const { repository, service } = setup()
    repository.transact(spaceId, {
      clientOperationId: id(75), fingerprint: 'synthetic invitation', expectedSpaceRevision: 0,
    }, (draft) => {
      draft.invitations = markInvitationShown(
        scheduleInvitation(draft.invitations, id(76), draft.invitations.cadenceAnchorDate),
        id(76), '2026-09-29T08:00:00+08:00',
      )
    })
    const question = service.displayQuestion(spaceId, {
      clientOperationId: id(77), expectedSpaceRevision: 1,
      kind: 'open', displayedAt: '2026-09-29T08:00:00+08:00', citations: [],
      invitationId: id(76),
    })
    const decline = service.sendMessage(spaceId, {
      ...sendRequest(78, 2, '今天先到这里'), visibleQuestionId: question.id,
      visibleInvitationId: id(76),
    })
    expect(decline.invitation.invitations[0].state).toBe('settled_unanswered')
    const corrected = service.correctInterpretation(spaceId, {
      clientOperationId: id(79), messageId: decline.message.id,
      expectedMessageRevision: 1, correctedKind: 'answer',
    })
    expect(corrected.invitation.invitations[0].state).toBe('settled_answered')
    expect(corrected.invitation.unansweredShownRounds).toBe(0)
    expect(corrected.invitation.changeEvents.at(-1)?.reason).toBe('response_correction')
    expect(corrected.entry?.text).toBe('今天先到这里')
    expect(repository.read(spaceId).messages[0].controlText).toBeNull()
    expect(() => service.sendMessage(spaceId, {
      ...sendRequest(78, 2, '今天先到这里'), visibleQuestionId: question.id,
      visibleInvitationId: id(76),
    })).toThrowError(/revision_conflict/)
  })

  it('moves an incorrectly recorded answer into a control message and allows deleting it', () => {
    const { repository, service } = setup()
    const question = service.displayQuestion(spaceId, {
      clientOperationId: id(42), expectedSpaceRevision: 0,
      kind: 'open', displayedAt: '2026-09-29T08:00:00+08:00', citations: [],
    })
    const recorded = service.sendMessage(spaceId, {
      ...sendRequest(43, 1, '其实今天想先停一停。'), visibleQuestionId: question.id,
    })
    const changed = service.correctInterpretation(spaceId, {
      clientOperationId: id(44), messageId: recorded.message.id,
      expectedMessageRevision: 1, correctedKind: 'decline',
    })
    expect(changed.entry).toBeNull()
    expect(changed.message.text).toBe('其实今天想先停一停。')
    expect(changed.message.revision).toBe(2)
    expect(service.listDays(spaceId).dates).toEqual([])
    expect(repository.read(spaceId).tombstones).toEqual(expect.arrayContaining([
      expect.objectContaining({ entityKind: 'entry', entityId: recorded.entry!.id }),
    ]))

    service.deleteControlMessage(spaceId, {
      clientOperationId: id(45), messageId: recorded.message.id, expectedMessageRevision: 2,
    })
    expect(service.listMessages(spaceId)).toEqual([])
    expect(JSON.stringify(repository.read(spaceId))).not.toContain('其实今天想先停一停')
    expect(() => service.sendMessage(spaceId, {
      ...sendRequest(43, 1, '其实今天想先停一停。'), visibleQuestionId: question.id,
    })).toThrowError(/revision_conflict/)
  })
})
