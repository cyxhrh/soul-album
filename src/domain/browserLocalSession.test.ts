import { describe, expect, it } from 'vitest'
import { createBrowserLocalSession } from './browserLocalSession'

it('keeps the displayed opening question as the actual local prompt, never a journal entry', () => {
  const session = createBrowserLocalSession({ openingId: 'morning' })
  expect(session.read().questions[0].text).toBe('今天有什么让你期待的安排？')
  expect(session.read().entries).toHaveLength(0)
  session.sendMessage(1, '去散步', session.firstQuestionId)
  expect(session.read().entries.map((entry) => entry.text)).toEqual(['去散步'])
})
import { selectAlbum } from './selectors'

describe('browser local session', () => {
  it('keeps records from separate demonstration days on separate day pages', () => {
    const session = createBrowserLocalSession({
      dayOneDate: '2026-09-29', timezone: 'UTC',
      now: () => new Date('2026-09-29T09:15:00.000Z'),
    })

    session.sendMessage(1, '第一天的原话。', session.firstQuestionId)
    session.sendMessage(2, '第二天的原话。')

    expect(session.dateForDay(1)).toBe('2026-09-29')
    expect(session.dateForDay(2)).toBe('2026-09-30')
    expect(session.dateForDay(8)).toBe('2026-10-06')
    expect(session.listDays()).toEqual([2, 1])
    expect(session.getDay(1)?.entries.map((entry) => entry.text)).toEqual(['第一天的原话。'])
    expect(session.getDay(2)?.entries.map((entry) => entry.text)).toEqual(['第二天的原话。'])
  })

  it('asks about the record without repeating an entire punctuated message', () => {
    const session = createBrowserLocalSession({
      dayOneDate: '2026-09-29', timezone: 'UTC',
      now: () => new Date('2026-09-29T09:15:00.000Z'),
    })
    const saved = session.sendMessage(1, '今天去了河边，看到夕阳，很开心。', session.firstQuestionId)
    const followup = session.displayNextQuestion(1)

    expect(followup.text).toBe('关于这段记录，还有什么想补充的吗？')
    expect(followup.text).not.toContain(saved.entry!.text)
    expect(followup.citations).toEqual([{ kind: 'entry', id: saved.entry!.id, revision: 1 }])

    session.sendMessage(1, '还看见了晚风里的树叶。', followup.id)
    const tomorrowFirst = session.displayNextQuestion(2)
    session.sendMessage(2, '今天走了一段路。', tomorrowFirst.id)
    const tomorrowSecond = session.displayNextQuestion(2)
    expect(new Set([followup.text, tomorrowFirst.text, tomorrowSecond.text]).size).toBe(3)
    expect(tomorrowFirst.citations).toHaveLength(1)
    expect(tomorrowSecond.citations).toHaveLength(1)
    expect([followup.text, tomorrowFirst.text, tomorrowSecond.text].join('')).not.toContain(saved.entry!.text)
  })

  it('adopts a proposal tied to the exact sent excerpt and exposes its provenance in history', () => {
    const session = createBrowserLocalSession({
      dayOneDate: '2026-09-29', timezone: 'UTC',
      now: () => new Date('2026-09-29T09:15:00.000Z'),
    })
    const saved = session.sendMessage(1, '今天在河边散步，想起一位朋友。', session.firstQuestionId)
    const question = session.displayNextQuestion(1)
    const proposal = {
      expectedSpaceRevision: session.read().revision,
      questionId: question.id, expectedQuestionRevision: question.revision,
      entryCitation: { id: saved.entry!.id, revision: saved.entry!.revision },
      entryQuote: '今天在河边散步',
      text: '河边的那段路，让你想起了朋友的什么？',
    }
    expect(() => session.adoptCloudQuestion({ ...proposal, entryQuote: '这段原话里没有的内容' }))
      .toThrow('cloud question source is no longer current')
    const adopted = session.adoptCloudQuestion(proposal)
    expect(adopted).toMatchObject({
      id: question.id, revision: 2, provenance: 'cloud_model', text: proposal.text,
      approvedExcerpt: proposal.entryQuote,
    })
    const answer = session.sendMessage(1, '想起上次一起拍照的傍晚。', question.id)
    expect(answer.answeredQuestion?.provenance).toBe('cloud_model')
    const history = session.projectJournal(session.read()).questions[1]
    expect(history.find((item) => item.answerEntryId === answer.entry?.id)?.provenance)
      .toBe('cloud_model')
    expect(history.find((item) => item.answerEntryId === answer.entry?.id)?.approvedExcerpt)
      .toBe(proposal.entryQuote)
    session.editEntry(saved.entry!.id, '后来重新表述了这一天。')
    const afterEdit = session.projectJournal(session.read())
    expect(afterEdit.questions[1].find((item) => item.answerEntryId === answer.entry?.id)?.approvedExcerpt)
      .toBeUndefined()
    expect(JSON.stringify(afterEdit)).not.toContain(proposal.entryQuote)
  })

  it('replaces a mistaken model question with a source-linked user correction for the next question', () => {
    const session = createBrowserLocalSession({
      dayOneDate: '2026-09-29', timezone: 'UTC',
      now: () => new Date('2026-09-29T09:15:00.000Z'),
    })
    const saved = session.sendMessage(1, '傍晚在河边停留了一会儿。', session.firstQuestionId)
    const question = session.displayNextQuestion(1)
    const adopted = session.adoptCloudQuestion({
      expectedSpaceRevision: session.read().revision,
      questionId: question.id, expectedQuestionRevision: question.revision,
      entryCitation: { id: saved.entry!.id, revision: 1 },
      entryQuote: '傍晚在河边停留', text: '独自散步时你在想什么？',
    })
    const corrected = session.recordQuestionCorrection({
      day: 1,
      questionId: adopted.id, expectedQuestionRevision: adopted.revision,
      entryCitation: { id: saved.entry!.id, revision: 1 },
      text: '我当时是在等朋友，不是独自散步。',
    })
    expect(session.projectJournal(session.read()).observations).toEqual([{
      id: corrected.id, day: 1, text: '我当时是在等朋友，不是独自散步。',
      entryIds: [saved.entry!.id], status: 'corrected', source: 'user-correction',
      revision: 1,
    }])
    expect(session.read().questions.find((item) => item.id === question.id))
      .toMatchObject({ status: 'user_corrected', text: '理解已更正' })
    const next = session.displayNextQuestion(1)
    expect(next.text).toBe('关于你补充的内容，还有什么想说的吗？')
    expect(next.citations).toEqual([{ kind: 'observation', id: corrected.id, revision: 1 }])
    const later = session.displayNextQuestion(1)
    expect(later.citations).toEqual([{ kind: 'entry', id: saved.entry!.id, revision: 1 }])

    session.deleteEntry(saved.entry!.id)
    const afterDeletion = JSON.stringify(session.read())
    expect(session.projectJournal(session.read()).observations).toEqual([])
    expect(afterDeletion).not.toContain('我当时是在等朋友')
    expect(afterDeletion).not.toContain('独自散步时你在想什么')
  })

  it('cannot adopt an old response after its source is deleted or the session is reset', () => {
    const options = {
      dayOneDate: '2026-09-29', timezone: 'UTC',
      now: () => new Date('2026-09-29T09:15:00.000Z'),
    }
    const session = createBrowserLocalSession(options)
    const saved = session.sendMessage(1, '只在这一轮存在的原话。', session.firstQuestionId)
    const question = session.displayNextQuestion(1)
    const proposal = {
      expectedSpaceRevision: session.read().revision,
      questionId: question.id, expectedQuestionRevision: question.revision,
      entryCitation: { id: saved.entry!.id, revision: 1 },
      entryQuote: '只在这一轮存在', text: '这一轮的记录里，你想多说哪一点？',
    }
    session.deleteEntry(saved.entry!.id)
    expect(() => session.adoptCloudQuestion(proposal))
      .toThrow('cloud question source is no longer current')
    expect(JSON.stringify(session.read())).not.toContain('这一轮的记录里')

    const replacement = createBrowserLocalSession(options)
    expect(replacement.read().id).not.toBe(session.read().id)
    expect(() => replacement.adoptCloudQuestion(proposal))
      .toThrow('cloud question source is no longer current')
  })

  it('shows a later correction on its own album day even without a new entry that day', () => {
    const session = createBrowserLocalSession({
      dayOneDate: '2026-09-29', timezone: 'UTC',
      now: () => new Date('2026-09-29T09:15:00.000Z'),
    })
    const saved = session.sendMessage(1, '第一天在河边等朋友。', session.firstQuestionId)
    const question = session.displayNextQuestion(1)
    const adopted = session.adoptCloudQuestion({
      expectedSpaceRevision: session.read().revision,
      questionId: question.id, expectedQuestionRevision: question.revision,
      entryCitation: { id: saved.entry!.id, revision: 1 },
      entryQuote: '第一天在河边等朋友', text: '独自散步时，你想到什么？',
    })
    const correction = session.recordQuestionCorrection({
      day: 2, questionId: adopted.id, expectedQuestionRevision: adopted.revision,
      entryCitation: { id: saved.entry!.id, revision: 1 },
      text: '我当时是在等朋友，不是独自散步。',
    })
    expect(correction.journalDate).toBe('2026-09-30')
    expect(session.listDays()).toEqual([2, 1])
    expect(session.getDay(2)).toMatchObject({ entries: [], observations: [correction] })
    const journal = session.projectJournal(session.read())
    expect(journal.observations).toMatchObject([{ day: 2, id: correction.id }])
    expect(selectAlbum(journal, 2)).toMatchObject({
      day: 2, entries: [], observation: { id: correction.id, text: correction.text },
    })
    expect(selectAlbum(journal, 1)?.observation).toBeNull()

    const next = session.displayNextQuestion(2)
    expect(next.citations).toEqual([{ kind: 'observation', id: correction.id, revision: 1 }])
    session.deleteEntry(saved.entry!.id)
    expect(session.listDays()).toEqual([])
    expect(selectAlbum(session.projectJournal(session.read()), 2)).toBeNull()
    expect(session.getDay(2)).toBeNull()
  })

  it('keeps control words in messages without making a day page', () => {
    const session = createBrowserLocalSession({
      dayOneDate: '2026-09-29', timezone: 'UTC',
      now: () => new Date('2026-09-29T09:15:00.000Z'),
    })

    session.sendMessage(1, '换个问题', session.firstQuestionId)
    const snapshot = session.read()

    expect(session.projectMessages(snapshot).map((message) => message.text)).toEqual(['换个问题'])
    expect(session.listDays()).toEqual([])
    expect(session.getDay(1)).toBeNull()
  })

  it('redacts revised and deleted cited words in every active projection', () => {
    const session = createBrowserLocalSession({
      dayOneDate: '2026-09-29', timezone: 'UTC',
      now: () => new Date('2026-09-29T09:15:00.000Z'),
    })
    const first = session.sendMessage(1, '旧的秘密原话', session.firstQuestionId)
    const followup = session.displayNextQuestion(2)
    session.sendMessage(2, '第二天的回答', followup.id)
    session.setDayTitle(2, '旧的秘密原话')

    session.editEntry(first.entry!.id, '新的表述')
    let snapshot = session.read()
    expect(JSON.stringify(session.projectJournal(snapshot))).not.toContain('旧的秘密原话')
    expect(JSON.stringify(session.projectMessages(snapshot))).not.toContain('旧的秘密原话')
    expect(session.getDay(2)?.title).toBeNull()
    expect(snapshot.questions.find((question) => question.id === followup.id)?.text).toBe('引用已修订')

    session.deleteEntry(first.entry!.id)
    snapshot = session.read()
    expect(session.listDays()).toEqual([2])
    expect(JSON.stringify(session.projectJournal(snapshot))).not.toContain('旧的秘密原话')
    expect(JSON.stringify(session.projectMessages(snapshot))).not.toContain('旧的秘密原话')
  })

  it('refuses to render an entry-backed message when its only current entry is missing', () => {
    const session = createBrowserLocalSession({
      dayOneDate: '2026-09-29', timezone: 'UTC',
      now: () => new Date('2026-09-29T09:15:00.000Z'),
    })
    session.sendMessage(1, '一条原话', session.firstQuestionId)
    const damagedSnapshot = session.read()
    damagedSnapshot.entries = []

    expect(() => session.projectMessages(damagedSnapshot)).toThrow('message has no current text')
  })
})
