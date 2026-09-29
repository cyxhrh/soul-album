import { describe, expect, it } from 'vitest'
import { createJournalState, journalReducer, type JournalState } from './journal'
import { selectAlbum, selectAnsweredQuestions, selectComparison, selectRuleQuestion } from './selectors'

const answer = (state: JournalState, id: string, day: number, text: string, topicId = 'daily') =>
  journalReducer(state, {
    type: 'answer',
    entry: { id, day, topicId, text, occurredAt: `day-${day}-event`, recordedAt: `day-${day}-record`, source: 'user-answer' },
  })

describe('derived album views', () => {
  it('shows only authorized source facts on an answered page, with distinct times and no invented mood', () => {
    let state = createJournalState('ahe')
    state = journalReducer(state, { type: 'addSourceFact', fact: {
      id: 'steps-1', sourceId: 'steps', day: 1, kind: 'steps', title: '当天步数',
      detail: '4,200 步', device: '模拟手表', source: '模拟步数',
      occurredAt: '2026-09-01T22:00:00+08:00', recordedAt: '2026-09-01T22:05:00+08:00', simulated: true,
    } })
    expect(selectAlbum(answer(state, 'e0', 1, '只答一问'), 1)?.sources).toEqual([])
    state = journalReducer(state, { type: 'setSourceConsent', sourceId: 'steps', granted: true, updatedAt: '23:00' })
    expect(selectAlbum(state, 1)).toBeNull()
    state = answer(state, 'e1', 1, '今天出门了')
    expect(selectAlbum(state, 1)?.sources).toMatchObject([{
      detail: '4,200 步', device: '模拟手表', source: '模拟步数',
      occurredAt: '2026-09-01T22:00:00+08:00', recordedAt: '2026-09-01T22:05:00+08:00',
      consentUpdatedAt: '23:00', simulated: true,
    }])
    expect(JSON.stringify(selectAlbum(state, 1))).not.toMatch(/开心|难过|健康/)
    state = journalReducer(state, { type: 'setSourceConsent', sourceId: 'steps', granted: false, updatedAt: '23:01' })
    expect(JSON.stringify(selectAlbum(state, 1))).not.toContain('4,200 步')
  })
  it('creates a printable day after one answer and no page without an answer', () => {
    const empty = createJournalState('free')
    expect(selectAlbum(empty, 1)).toBeNull()
    const state = answer(empty, 'e1', 1, '今天走了一段路')

    expect(selectAlbum(state, 1)).toMatchObject({
      day: 1, spaceId: 'free', entries: [{
        id: 'e1', text: '今天走了一段路', occurredAt: 'day-1-event',
        recordedAt: 'day-1-record', source: 'user-answer',
      }],
    })
    expect(selectAlbum(state, 2)).toBeNull()
  })

  it('offers a pending second question from the first same-day answer and keeps the answered snapshot separate', () => {
    let state = answer(createJournalState('free'), 'e1', 1, '今天见了朋友', 'memory')
    expect(selectRuleQuestion(state, 1)).toMatchObject({ citationEntryId: 'e1', status: 'ready' })
    expect(selectRuleQuestion(state, 1).text).toBe('关于这段记录，还有什么想补充的吗？')
    expect(selectRuleQuestion(state, 1).text).not.toContain('今天见了朋友')
    expect(selectAnsweredQuestions(state, 1)).toHaveLength(1)
    expect(selectAnsweredQuestions(state, 1)[0].text).toBe('今天有什么想记下的？')

    state = answer(state, 'e2', 1, '返程很晚', 'rest')
    expect(selectAnsweredQuestions(state, 1)).toHaveLength(2)
    expect(selectAnsweredQuestions(state, 1)[1].text).toBe('关于这段记录，还有什么想补充的吗？')
  })

  it('varies cited rule questions across consecutive prompts and days', () => {
    let state = answer(createJournalState('free'), 'e1', 1, '今天去了河边，看到夕阳，很开心。')
    const dayOneSecond = selectRuleQuestion(state, 1)
    state = answer(state, 'e2', 1, '还看见了晚风里的树叶。')
    const dayTwoFirst = selectRuleQuestion(state, 2)
    state = answer(state, 'e3', 2, '今天走了一段路。')
    const dayTwoSecond = selectRuleQuestion(state, 2)

    expect(new Set([dayOneSecond.text, dayTwoFirst.text, dayTwoSecond.text]).size).toBe(3)
    expect([dayOneSecond, dayTwoFirst, dayTwoSecond].every((question) => question.citationEntryId)).toBe(true)
    expect([dayOneSecond.text, dayTwoFirst.text, dayTwoSecond.text].join('')).not.toContain('今天去了河边')
  })

  it('shows only one current tentative observation with its evidence and no inferred mood', () => {
    let state = answer(createJournalState('story'), 'e1', 1, '今天走了 8000 步')
    state = journalReducer(state, {
      type: 'addObservation', observation: {
        id: 'o1', day: 1, text: '也许晚归影响休息', entryIds: ['e1'], status: 'tentative',
      },
    })
    const album = selectAlbum(state, 1)

    expect(album?.observation).toMatchObject({ text: '也许晚归影响休息', status: 'tentative', entryIds: ['e1'] })
    expect(JSON.stringify(album)).not.toContain('心情')
  })

  it('keeps every valid same-day correction in order while preserving the latest single-observation view', () => {
    let state = answer(createJournalState('free'), 'e1', 1, '先记下晨间散步')
    state = answer(state, 'e2', 1, '再记下晚间阅读')
    for (const [id, entryId, text] of [
      ['o1', 'e1', '第一次准确补充'],
      ['o2', 'e2', '第二次准确补充'],
    ]) {
      state = journalReducer(state, {
        type: 'addObservation', observation: { id, day: 1, text: '待确认解释', entryIds: [entryId], status: 'tentative' },
      })
      state = journalReducer(state, { type: 'correctObservation', id, text })
    }

    expect(selectAlbum(state, 1)?.observations.map((item) => item.text))
      .toEqual(['第一次准确补充', '第二次准确补充'])
    expect(selectAlbum(state, 1)?.observation?.text).toBe('第二次准确补充')

    state = journalReducer(state, { type: 'editEntry', id: 'e1', text: '重新写过晨间散步', recordedAt: 'later' })
    expect(selectAlbum(state, 1)?.observations.map((item) => item.text)).toEqual(['第二次准确补充'])
    state = journalReducer(state, { type: 'deleteEntry', id: 'e2' })
    expect(selectAlbum(state, 1)?.observations).toEqual([])
    expect(JSON.stringify(selectAlbum(state, 1))).not.toMatch(/第一次准确补充|第二次准确补充/)
  })

  it('does not render an unsupported observation even if malformed state is supplied', () => {
    const state = answer(createJournalState('story'), 'e1', 1, '当天事实')
    const malformed: JournalState = {
      ...state,
      observations: [{
        id: 'o1', day: 1, text: '无证据的解释', entryIds: [],
        status: 'tentative', source: 'tentative-rule', revision: 1,
      }],
    }
    expect(selectAlbum(malformed, 1)?.observation).toBeNull()
    expect(JSON.stringify(selectAlbum(malformed, 1))).not.toContain('无证据的解释')
  })

  it('withdraws a tentative explanation when its source answer is rewritten', () => {
    let state = answer(createJournalState('story'), 'e1', 1, '原来觉得累')
    state = journalReducer(state, {
      type: 'addObservation', observation: {
        id: 'o1', day: 1, text: '也许出门让你疲惫', entryIds: ['e1'], status: 'tentative',
      },
    })
    state = journalReducer(state, { type: 'editEntry', id: 'e1', text: '后来确认是晚睡', recordedAt: 'later' })

    expect(selectAlbum(state, 1)?.observation).toBeNull()
    expect(JSON.stringify(selectAlbum(state, 1))).not.toContain('出门让你疲惫')
  })

  it('withdraws a corrected observation when its cited answer is rewritten', () => {
    let state = answer(createJournalState('story'), 'e1', 1, '朋友让我累')
    state = journalReducer(state, {
      type: 'addObservation', observation: {
        id: 'o1', day: 1, text: '朋友耗力', entryIds: ['e1'], status: 'tentative',
      },
    })
    state = journalReducer(state, { type: 'correctObservation', id: 'o1', text: '其实是返程太晚' })
    expect(selectRuleQuestion(state, 2)).toMatchObject({
      citationObservationId: 'o1', citationObservationRevision: 2,
      text: '关于你补充的内容，还有什么想说的吗？',
    })
    state = journalReducer(state, { type: 'editEntry', id: 'e1', text: '当天只是睡得晚', recordedAt: 'later' })

    expect(selectAlbum(state, 1)?.observation).toBeNull()
    expect(selectRuleQuestion(state, 2).citationObservationId).toBeUndefined()
    expect(selectRuleQuestion(state, 2).text).not.toContain('其实是返程太晚')
  })

  it('updates an unanswered question when an old answer is edited, but marks an answered version revised', () => {
    let state = answer(createJournalState('free'), 'e1', 1, '旧原话')
    expect(selectRuleQuestion(state, 2)).toMatchObject({ citationEntryId: 'e1', citationEntryRevision: 1 })
    expect(selectRuleQuestion(state, 2).text).not.toContain('旧原话')
    state = journalReducer(state, { type: 'editEntry', id: 'e1', text: '新原话', recordedAt: 'later' })
    expect(selectRuleQuestion(state, 2)).toMatchObject({ citationEntryId: 'e1', citationEntryRevision: 2 })
    expect(selectRuleQuestion(state, 2).text).not.toContain('新原话')
    expect(selectRuleQuestion(state, 2).text).not.toContain('旧原话')

    state = answer(state, 'e2', 2, '第二天的回答')
    state = journalReducer(state, { type: 'editEntry', id: 'e1', text: '再改一次', recordedAt: 'latest' })
    expect(selectAnsweredQuestions(state, 2)[0]).toMatchObject({ status: 'reference-revised' })
    expect(selectAnsweredQuestions(state, 2)[0].text).toBe('关于这段记录，还有什么想补充的吗？')
    expect(selectAnsweredQuestions(state, 2)[0].text).not.toContain('新原话')
  })

  it('uses the latest earlier day rather than insertion order for a new question', () => {
    let state = answer(createJournalState('story'), 'e3', 3, '第三天记录')
    state = answer(state, 'e1', 1, '第一天补录')

    expect(selectRuleQuestion(state, 4)).toMatchObject({ citationEntryId: 'e3', citationEntryRevision: 1 })
    expect(selectRuleQuestion(state, 4).text).not.toContain('第三天记录')
    expect(selectRuleQuestion(state, 4).text).not.toContain('第一天补录')
  })

  it('exposes a stable main citation and lets a caller select another exact answer', () => {
    let state = answer(createJournalState('free'), 'main', 1, '第一题原话', 'memory')
    state = answer(state, 'other', 1, '第二题原话', 'rest')
    expect(selectRuleQuestion(state, 2)).toMatchObject({ citationEntryId: 'main' })
    state = journalReducer(state, { type: 'editEntry', id: 'other', text: '第二题改写', recordedAt: 'later' })
    expect(selectRuleQuestion(state, 2)).toMatchObject({ citationEntryId: 'main', citationEntryRevision: 1 })
    state = journalReducer(state, { type: 'editEntry', id: 'main', text: '第一题改写', recordedAt: 'later' })
    expect(selectRuleQuestion(state, 2)).toMatchObject({ citationEntryId: 'main' })
    expect(selectRuleQuestion(state, 2)).toMatchObject({ citationEntryId: 'main', citationEntryRevision: 2 })
    expect(selectRuleQuestion(state, 2).text).not.toContain('第一题改写')

    expect(selectRuleQuestion(state, 2, 'other')).toMatchObject({ citationEntryId: 'other' })
    expect(selectRuleQuestion(state, 2, 'other')).toMatchObject({ citationEntryId: 'other', citationEntryRevision: 2 })
    expect(selectRuleQuestion(state, 2, 'other').text).not.toContain('第二题改写')
  })

  it('compares only answers to the same topic and tracks active edits', () => {
    let state = answer(createJournalState('free'), 'e1', 1, '第一天原话', 'rest')
    state = answer(state, 'e2', 2, '第二天原话', 'rest')
    expect(selectComparison(state, 1, 2)?.entries.map((entry) => entry.text)).toEqual(['第一天原话', '第二天原话'])
    state = journalReducer(state, { type: 'editEntry', id: 'e1', text: '第一天新话', recordedAt: 'later' })
    expect(selectComparison(state, 1, 2)?.entries[0].text).toBe('第一天新话')
    state = journalReducer(state, { type: 'deleteEntry', id: 'e1' })
    expect(selectComparison(state, 1, 2)).toBeNull()
  })

  it('never returns deleted words in album, comparison, question, or printable page data', () => {
    let state = answer(createJournalState('free'), 'e1', 1, '必须清除的旧文字')
    state = answer(state, 'e2', 2, '保留的文字')
    state = journalReducer(state, { type: 'deleteEntry', id: 'e1' })

    const views = [selectAlbum(state, 1), selectAlbum(state, 2), selectComparison(state, 1, 2), selectRuleQuestion(state, 2), selectRuleQuestion(state, 3), selectAnsweredQuestions(state, 2)]
    expect(JSON.stringify(views)).not.toContain('必须清除的旧文字')
    expect(selectAnsweredQuestions(state, 2)[0]).toMatchObject({ text: '引用已删除', referenceDeleted: true })
  })
})
