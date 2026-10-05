import { describe, expect, it } from 'vitest'
import { createBrowserLocalSession } from './browserLocalSession'
import { InMemorySpaceRepository } from '../../backend/local/store'
import { LocalPreferencesService } from '../../backend/local/preferences'

const options = { dayOneDate: '2026-09-29', timezone: 'Asia/Shanghai', now: () => new Date('2026-09-29T19:00:00Z') }
const refresh = (session: ReturnType<typeof createBrowserLocalSession>) => createBrowserLocalSession({
  restore: JSON.parse(JSON.stringify(session.exportState())), now: options.now,
})

describe('local session refresh', () => {
  it('restores messages, questions, IDs, timezone and revisions without another opening', () => {
    const session = createBrowserLocalSession(options)
    session.sendMessage(1, '今天去看花。', session.firstQuestionId)
    session.displayNextQuestion(1)
    session.setDayTitle(1, '花园')
    const restored = refresh(session)
    expect(restored.exportState()).toEqual(session.exportState())
    expect(restored.timezone).toBe('Asia/Shanghai')
    const revision = restored.read().revision
    restored.sendMessage(2, '第二天的补充。')
    expect(restored.read().revision).toBe(revision + 1)
    expect(restored.read().messages.map((item) => item.sequence)).toEqual([1, 2])
    expect(session.read().messages).toHaveLength(1)
  })

  it('restores revisions and deletion tombstones without resurrecting withdrawn sources', () => {
    let session = createBrowserLocalSession(options)
    const saved = session.sendMessage(1, '已经撤回的旧原话。', session.firstQuestionId)
    session.displayNextQuestion(1)
    session.editEntry(saved.entry!.id, '新的表述。')
    session = refresh(session)
    expect(session.read().entries[0].revision).toBe(2)
    expect(JSON.stringify(session.read())).not.toContain('已经撤回的旧原话')
    session.deleteEntry(saved.entry!.id)
    session = refresh(session)
    expect(session.read().entries).toEqual([])
    expect(session.read().tombstones).toHaveLength(2)
    session.sendMessage(1, '删除以后继续记录。')
    expect(session.projectMessages(session.read())[0].sequence).toBe(2)
  })

  it.each(['id', 'timezone', 'revision', 'messages', 'entry-reference', 'question-reference', 'sequence', 'interpretation', 'title-reference'])('rejects damaged %s without loading a partial space', (damage) => {
    const session = createBrowserLocalSession(options)
    session.sendMessage(1, '完整记录', session.firstQuestionId)
    const snapshot = session.read()
    if (damage === 'id') snapshot.id = 'private-words'
    if (damage === 'timezone') snapshot.timezone = 'not/a-zone'
    if (damage === 'revision') snapshot.revision = -1
    if (damage === 'messages') snapshot.messages = null as never
    if (damage === 'entry-reference') snapshot.entries = []
    if (damage === 'question-reference') snapshot.messages[0].replyToQuestionId = crypto.randomUUID()
    if (damage === 'sequence') snapshot.nextMessageSequence = 1
    if (damage === 'interpretation') snapshot.messages[0].interpretation = null as never
    if (damage === 'title-reference') snapshot.titles['2026-09-29'] = { text: '标题', revision: 1, dependencyEntryIds: [crypto.randomUUID()] }
    const repository = new InMemorySpaceRepository()
    expect(() => repository.restoreSpace(snapshot)).toThrow('invalid_input')
    expect(() => repository.read(session.read().id)).toThrow('not_found')
  })

  it('rejects bad restore metadata and refuses to replace an existing space', () => {
    const session = createBrowserLocalSession(options)
    expect(() => createBrowserLocalSession({ restore: { ...session.exportState(), dayOneDate: '2026-02-30' } })).toThrow()
    expect(() => createBrowserLocalSession({ restore: { ...session.exportState(), dayOneDate: undefined as never } })).toThrow()
    expect(() => createBrowserLocalSession({ restore: { ...session.exportState(), firstQuestionId: crypto.randomUUID() } })).toThrow()
    const repository = new InMemorySpaceRepository()
    repository.restoreSpace(session.read())
    expect(() => repository.restoreSpace(session.read())).toThrow('revision_conflict')
    expect(() => repository.transact(session.read().id, {
      clientOperationId: crypto.randomUUID(), fingerprint: 'stale', expectedSpaceRevision: 0,
    }, () => null)).toThrow('revision_conflict')
  })

  it('restores a complete snapshot with invitation changes, source grants and user corrections', () => {
    const session = createBrowserLocalSession(options)
    const entry = session.sendMessage(1, '今天在河边等待朋友。', session.firstQuestionId).entry!
    const question = session.displayNextQuestion(1)
    const cloud = session.adoptCloudQuestion({
      expectedSpaceRevision: session.read().revision, questionId: question.id,
      expectedQuestionRevision: question.revision, entryCitation: { id: entry.id, revision: 1 },
      entryQuote: '今天在河边等待朋友', text: '独自散步有什么感受？',
    })
    session.recordQuestionCorrection({ day: 1, questionId: cloud.id, expectedQuestionRevision: cloud.revision,
      entryCitation: { id: entry.id, revision: 1 }, text: '我在等朋友，不是独自散步。' })
    session.displayNextQuestion(1)
    const repository = new InMemorySpaceRepository({ now: () => options.now().toISOString() })
    const snapshot = repository.restoreSpace(session.read())
    const preferences = new LocalPreferencesService(repository)
    preferences.scheduleInvitation(snapshot.id, { clientOperationId: crypto.randomUUID(),
      expectedSpaceRevision: snapshot.revision, date: '2026-09-30' })
    preferences.setCadence(snapshot.id, { clientOperationId: crypto.randomUUID(),
      expectedSpaceRevision: repository.read(snapshot.id).revision, requestedCadence: 'weekly',
      requestedAt: options.now().toISOString(), timezone: options.timezone })
    preferences.grantSource(snapshot.id, { clientOperationId: crypto.randomUUID(), source: 'note',
      purpose: 'use_in_journal', scope: ['one-note'], approvedAt: options.now().toISOString() })
    const complete = repository.read(snapshot.id)
    const restored = new InMemorySpaceRepository().restoreSpace(JSON.parse(JSON.stringify(complete)))
    expect(restored).toEqual(complete)
    restored.entries[0].text = 'mutation outside repository'
    expect(repository.read(snapshot.id).entries[0].text).toBe(entry.text)
  })
})
