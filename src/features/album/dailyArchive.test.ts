import { describe, expect, it } from 'vitest'
import { createBrowserLocalSession } from '../../domain/browserLocalSession'
import { sourceForMessage, type PrivateChatTurn } from '../free/privateChat'
import { chatOpenings } from '../../../shared/chatOpening'
import type { DailyMessage } from '../../../shared/dailyAlbum'
import { collectDailyMessages, collectDailySources, syncDailyRecord } from './dailyArchive'
import { createDailyRecord, fingerprintMessages } from './dailyRecord'

const setup = () => createBrowserLocalSession({
  dayOneDate: '2026-09-30', timezone: 'Asia/Shanghai', openingId: 'morning',
  now: () => new Date('2026-09-30T01:00:00Z'),
})

describe('collect daily archive sources', () => {
  it('includes a control-only day without treating an empty opening as a recorded day', () => {
    const session = setup()
    expect(collectDailySources(session.read(), [], 'morning', session.firstQuestionId, [])).toEqual({})
    const sent = session.sendMessage(1, '今天先不聊了', session.firstQuestionId)
    const sources = collectDailySources(session.read(), [], 'morning', session.firstQuestionId, [{ id: sent.message.id, reply: '好，先休息吧。' }])
    expect(sources['2026-09-30'].map(message => message.role)).toEqual(['system', 'user', 'system'])
  })
  it('collects the full user tail and model follow-up after the full opening in conversation order', () => {
    const session = setup()
    const text = `${'完整原文'.repeat(350)}\n最后决定休息 🌙`
    const sent = session.sendMessage(1, text, session.firstQuestionId)
    const source = sourceForMessage(session.read(), sent.message, 1)!
    const turns: PrivateChatTurn[] = [{ messageId: sent.message.id, request: { turn: source, context: [] }, response: {
      status: 'generated', reply: '听起来有点累。', nextQuestion: '你想怎么休息一下？', citations: [],
      model: { provider: 'qwen', id: 'test-model' }, generatedAt: '2026-09-30T01:00:02Z',
    } }]
    const result = collectDailyMessages(session.read(), turns, '2026-09-30', 'morning', session.firstQuestionId, [])
    expect(result.map(message => message.role)).toEqual(['system', 'user', 'assistant'])
    expect(result[0].text).toBe(`${chatOpenings.morning.greeting}\n\n${chatOpenings.morning.question}`)
    expect(result[1].text).toBe(text)
    expect(result[2].text).toBe('听起来有点累。\n\n你想怎么休息一下？')
    session.editEntry(sent.entry!.id, '更正后的原文')
    expect(collectDailyMessages(session.read(), turns, '2026-09-30', 'morning', session.firstQuestionId, []).some(message => message.role === 'assistant')).toBe(false)
  })

  it('uses the space timezone and keeps other days out, even for questions from another day', () => {
    const session = setup()
    const first = session.sendMessage(1, '当天的完整原话', session.firstQuestionId)
    const second = session.sendMessage(2, '明天的私人原话', null)
    const snapshot = session.read()
    snapshot.messages.find(message => message.id === first.message.id)!.occurredAt = '2026-09-29T16:30:00Z'
    snapshot.messages.find(message => message.id === second.message.id)!.replyToQuestionId = session.firstQuestionId
    const today = collectDailyMessages(snapshot, [], '2026-09-30', 'morning', session.firstQuestionId, [])
    const tomorrow = collectDailyMessages(snapshot, [], '2026-10-01', 'morning', session.firstQuestionId, [])
    expect(today.filter(message => message.role === 'user').map(message => message.text)).toEqual(['当天的完整原话'])
    expect(tomorrow.map(message => message.text)).toEqual(['明天的私人原话'])
  })

  it('keeps control text and local replies with honest roles and sequence ordering', () => {
    const session = setup()
    const first = session.sendMessage(1, '今天想散步', session.firstQuestionId)
    const question = session.displayNextQuestion(1)
    const control = session.sendMessage(1, '今天先不聊了', question.id)
    const snapshot = session.read()
    snapshot.messages.reverse()
    const result = collectDailyMessages(snapshot, [], '2026-09-30', 'morning', session.firstQuestionId, [{ id: control.message.id, reply: '那就先歇一歇。' }])
    expect(result.map(message => message.id)).toEqual([
      `question-${session.firstQuestionId}`, `user-${first.message.id}`, `question-${question.id}`,
      `user-${control.message.id}`, `local-${control.message.id}`,
    ])
    expect(result.at(-2)?.text).toBe('今天先不聊了')
    expect(result.at(-1)?.role).toBe('system')
  })

  it('includes only valid user corrections belonging to the selected day', () => {
    const session = setup()
    const sent = session.sendMessage(1, '记录了今天的一点小事', session.firstQuestionId)
    const snapshot = session.read()
    snapshot.observations.push({
      id: 'correction1', text: '准确说，我是和姐姐去的。', status: 'user_corrected', provenance: 'user_correction',
      citations: [{ kind: 'entry', id: sent.entry!.id, revision: sent.entry!.revision }], revision: 1,
      journalDate: '2026-09-30', recordedAt: '2026-09-30T01:00:01Z',
    })
    expect(collectDailyMessages(snapshot, [], '2026-09-30', 'morning', session.firstQuestionId, []).at(-1))
      .toMatchObject({ id: 'correction-correction1', role: 'user', text: '准确说，我是和姐姐去的。', revised: true })
    expect(collectDailyMessages(snapshot, [], '2026-10-01', 'morning', session.firstQuestionId, [])).toEqual([])
    snapshot.entries = []
    expect(collectDailyMessages(snapshot, [], '2026-09-30', 'morning', session.firstQuestionId, []).some(message => message.id === 'correction-correction1')).toBe(false)
  })
})

const original: DailyMessage[] = [{ id: 'u1', role: 'user', text: '原始私密内容', recordedAt: '2026-09-30T01:00:00Z' }]
const added: DailyMessage = { id: 'u2', role: 'user', text: '后来去了公园', recordedAt: '2026-09-30T02:00:00Z' }
const handwritten = () => ({ ...createDailyRecord('2026-09-30', original),
  title: '我写的标题', diary: '我亲手写的日记', userEdited: true,
  messages: [{ ...original[0], text: '档案里修订后的原文', revised: true }],
  portrait: { facts: ['原始私密内容'], feelings: [], observations: [], uncertainties: [] },
  generatedAt: '2026-09-30T01:00:02Z', model: { provider: 'qwen' as const, id: 'test-model' },
})

describe('sync daily archive', () => {
  it('returns the same record for an unchanged chat source despite archive revisions', () => {
    const record = handwritten()
    expect(syncDailyRecord(record, original, original, '2026-09-30')).toBe(record)
  })

  it('preserves handwritten content and revised messages on additions, while withdrawing the old portrait', () => {
    const record = handwritten()
    const next = syncDailyRecord(record, original, [...original, added], '2026-09-30')
    expect(next.messages).toEqual([record.messages[0], added])
    expect(next.diary).toBe('我亲手写的日记')
    expect(next.title).toBe('我写的标题')
    expect(next.portrait.facts).toEqual([])
    expect(next.model).toBeUndefined()
    expect(next.generatedAt).toBeUndefined()
    expect(next.revision).toBe(record.revision + 1)
    expect(next.sourceFingerprint).toBe(fingerprintMessages([...original, added]))
    expect(record.portrait.facts).toEqual(['原始私密内容'])
  })

  it('withdraws unedited generated diary and title when new chat arrives', () => {
    const record = { ...handwritten(), userEdited: false }
    const next = syncDailyRecord(record, original, [...original, added], '2026-09-30')
    expect(next.diary).toBe('')
    expect(next.title).toBe('今天留下的事')
  })

  it('preserves the handwritten diary on source edits but uses the new original and withdraws the portrait', () => {
    const record = handwritten()
    const incoming = [{ ...original[0], text: '新版本' }]
    const next = syncDailyRecord(record, original, incoming, '2026-09-30')
    expect(next.diary).toBe(record.diary)
    expect(next.messages).toEqual(incoming)
    expect(next.portrait.facts).toEqual([])
    expect(next.revision).toBe(record.revision + 1)
  })

  it('withdraws the diary after deletion but preserves independent archive corrections', () => {
    const sources = [...original, added]
    const record = { ...handwritten(), sourceFingerprint: fingerprintMessages(sources), messages: [...handwritten().messages, { ...added, text: '我自己补正的散步记录', revised: true }] }
    const next = syncDailyRecord(record, sources, [added], '2026-09-30')
    expect(next.diary).toBe('')
    expect(next.messages).toEqual([record.messages[1]])
    expect(JSON.stringify(next)).not.toContain('原始私密内容')
  })

  it.each(['delete', 'missing baseline', 'wrong baseline', 'other date'] as const)('fully clears derived content on %s', mode => {
    const record = handwritten()
    const incoming = mode === 'delete' ? [] : [...original, added]
    const previous = mode === 'missing baseline' ? undefined : mode === 'wrong baseline' ? [] : original
    const next = syncDailyRecord(record, previous, incoming, mode === 'other date' ? '2026-10-01' : '2026-09-30')
    expect(next.messages).toEqual(incoming)
    expect(next.diary).toBe('')
    expect(next.title).toBe('今天留下的事')
    expect(next.portrait.facts).toEqual([])
    expect(next.model).toBeUndefined()
    expect(next.userEdited).toBe(false)
  })

  it('creates an independent record when none existed', () => {
    const next = syncDailyRecord(undefined, undefined, original, '2026-09-30')
    expect(next.messages).toEqual(original)
    expect(next.messages[0]).not.toBe(original[0])
  })
})
