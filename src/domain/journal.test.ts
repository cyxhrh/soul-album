import { describe, expect, it } from 'vitest'
import { createJournalState, journalReducer, titleDaysAffectedByEntryChange } from './journal'

describe('journalReducer', () => {
  it('keeps synthetic source consent off by default and revokes each source independently', () => {
    let state = createJournalState('ahe')
    state = journalReducer(state, { type: 'addSourceFact', fact: {
      id: 'photo-1', sourceId: 'photo', day: 1, kind: 'photo',
      title: '雨后街角', detail: '一张雨后街角的合成示例照片',
      imageSrc: '/synthetic-street-2026-09-29.png', device: '演示相册', source: '合成照片',
      occurredAt: '2026-09-01T18:00:00+08:00', recordedAt: '2026-09-01T20:00:00+08:00', simulated: true,
    } })
    state = journalReducer(state, { type: 'addSourceFact', fact: {
      id: 'steps-1', sourceId: 'steps', day: 1, kind: 'steps',
      title: '当天步数', detail: '4,200 步', device: '模拟手表', source: '模拟步数',
      occurredAt: '2026-09-01T22:00:00+08:00', recordedAt: '2026-09-01T22:05:00+08:00', simulated: true,
    } })
    expect(state.sourceConsents).toEqual({})
    state = journalReducer(state, { type: 'setSourceConsent', sourceId: 'photo', granted: true, updatedAt: '21:00' })
    state = journalReducer(state, { type: 'setSourceConsent', sourceId: 'steps', granted: true, updatedAt: '21:01' })
    state = journalReducer(state, { type: 'setSourceConsent', sourceId: 'photo', granted: false, updatedAt: '21:02' })
    expect(state.sourceConsents.photo).toMatchObject({ granted: false, updatedAt: '21:02' })
    expect(state.sourceConsents.steps).toMatchObject({ granted: true, updatedAt: '21:01' })
    expect(state.sourceFacts).toHaveLength(2)
  })
  it('keeps answer, event time, record time, and source distinct', () => {
    const state = journalReducer(createJournalState('free'), {
      type: 'answer',
      entry: {
        id: 'e1', day: 1, topicId: 'daily', text: '今天和朋友吃饭',
        occurredAt: '2026-09-23T20:00:00+08:00',
        recordedAt: '2026-09-24T09:00:00+08:00', source: 'user-answer',
      },
    })

    expect(state.entries[0]).toMatchObject({
      day: 1, text: '今天和朋友吃饭',
      occurredAt: '2026-09-23T20:00:00+08:00',
      recordedAt: '2026-09-24T09:00:00+08:00', source: 'user-answer',
      revision: 1,
    })
    expect(state.spaceId).toBe('free')
  })

  it('preserves revisions when an answer or title is edited', () => {
    let state = journalReducer(createJournalState('story'), {
      type: 'answer',
      entry: { id: 'e1', day: 1, topicId: 'daily', text: '原话', occurredAt: '10:00', recordedAt: '10:10', source: 'user-answer' },
    })
    state = journalReducer(state, { type: 'editEntry', id: 'e1', text: '改过的原话', recordedAt: '11:00' })
    state = journalReducer(state, { type: 'setTitle', day: 1, title: '第一页', recordedAt: '11:10' })
    state = journalReducer(state, { type: 'setTitle', day: 1, title: '新的标题', recordedAt: '11:20' })

    expect(state.entries[0].revision).toBe(2)
    expect(state.entries[0].revisions).toEqual([{ text: '原话', recordedAt: '10:10', revision: 1 }])
    expect(state.titles[1]).toMatchObject({ title: '新的标题', revision: 2 })
    expect(state.titles[1].revisions).toEqual([{ title: '第一页', recordedAt: '11:10', revision: 1 }])
  })

  it('removes a later title and its revisions when an earlier possible source is deleted', () => {
    let state = journalReducer(createJournalState('free'), {
      type: 'answer', entry: {
        id: 'day-one', day: 1, topicId: 'daily', text: 'PRIVATE_TITLE_LINEAGE_山茶花',
        occurredAt: '10:00', recordedAt: '10:01', source: 'user-answer',
      },
    })
    state = journalReducer(state, {
      type: 'answer', entry: {
        id: 'day-two', day: 2, topicId: 'daily', text: '今天留下另一句。',
        occurredAt: '11:00', recordedAt: '11:01', source: 'user-answer',
      },
    })
    state = journalReducer(state, { type: 'setTitle', day: 2, title: '平常的一天', recordedAt: '11:02' })
    state = journalReducer(state, { type: 'setTitle', day: 2, title: '回想 PRIVATE_TITLE_LINEAGE_山茶花', recordedAt: '11:03' })
    state = journalReducer(state, { type: 'deleteEntry', id: 'day-one' })

    expect(state.titles[2]).toBeUndefined()
    expect(JSON.stringify(state)).not.toContain('PRIVATE_TITLE_LINEAGE_山茶花')
  })

  it('withdraws a dependent title when its earlier answer is revised', () => {
    let state = journalReducer(createJournalState('free'), {
      type: 'answer', entry: {
        id: 'old-day-one', day: 1, topicId: 'daily', text: '第一天的旧说法',
        occurredAt: '10:00', recordedAt: '10:01', source: 'user-answer',
      },
    })
    state = journalReducer(state, { type: 'setTitle', day: 2, title: '第一天的旧说法', recordedAt: '11:00' })
    state = journalReducer(state, { type: 'editEntry', id: 'old-day-one', text: '第一天的新说法', recordedAt: '12:00' })

    expect(state.titles[2]).toBeUndefined()
  })

  it('withdraws a revisited earlier title that copied a later answer', () => {
    let state = journalReducer(createJournalState('free'), {
      type: 'answer', entry: {
        id: 'day-two', day: 2, topicId: 'daily', text: 'PRIVATE_LATER_ANSWER',
        occurredAt: '11:00', recordedAt: '11:01', source: 'user-answer',
      },
    })
    state = journalReducer(state, { type: 'setTitle', day: 1, title: 'PRIVATE_LATER_ANSWER', recordedAt: '11:02' })
    state = journalReducer(state, { type: 'deleteEntry', id: 'day-two' })

    expect(state.titles[1]).toBeUndefined()
    expect(JSON.stringify(state)).not.toContain('PRIVATE_LATER_ANSWER')
  })

  it('reports exactly which title histories an entry edit or deletion would withdraw', () => {
    let state = journalReducer(createJournalState('free'), {
      type: 'answer', entry: {
        id: 'day-one', day: 1, topicId: 'daily', text: '第一天的原话',
        occurredAt: '10:00', recordedAt: '10:01', source: 'user-answer',
      },
    })
    expect(titleDaysAffectedByEntryChange(state, 'day-one', 'editEntry')).toEqual([])
    state = journalReducer(state, { type: 'setTitle', day: 2, title: '独立的第二天', recordedAt: '11:00' })
    state = journalReducer(state, { type: 'setTitle', day: 2, title: '仍是第二天', recordedAt: '11:01' })
    expect(titleDaysAffectedByEntryChange(state, 'day-one', 'editEntry')).toEqual([2])
    expect(titleDaysAffectedByEntryChange(state, 'day-one', 'deleteEntry')).toEqual([2])
    expect(titleDaysAffectedByEntryChange(state, 'missing', 'deleteEntry')).toEqual([])
    state = journalReducer(state, { type: 'setTitle', day: 1, title: '第一天的标题', recordedAt: '11:02' })
    expect(titleDaysAffectedByEntryChange(state, 'day-one', 'editEntry')).toEqual([1, 2])
  })

  it('replaces a rejected tentative explanation and keeps its correction sourced to the user', () => {
    let state = journalReducer(createJournalState('story'), {
      type: 'answer',
      entry: { id: 'e1', day: 1, topicId: 'daily', text: '原话', occurredAt: '10:00', recordedAt: '10:10', source: 'synthetic-answer' },
    })
    state = journalReducer(state, {
      type: 'addObservation',
      observation: { id: 'o1', day: 1, text: '也许朋友让你疲惫', entryIds: ['e1'], status: 'tentative' },
    })
    state = journalReducer(state, { type: 'correctObservation', id: 'o1', text: '返程太晚，原因还不确定' })

    expect(state.observations[0]).toMatchObject({
      text: '返程太晚，原因还不确定', status: 'corrected', source: 'user-correction',
    })
    expect(JSON.stringify(state.observations)).not.toContain('朋友让你疲惫')
  })

  it('rejects observations without a nonempty set of existing evidence entries', () => {
    let state = createJournalState('story')
    state = journalReducer(state, {
      type: 'addObservation', observation: {
        id: 'empty', day: 1, text: '没有证据的判断', entryIds: [], status: 'tentative',
      },
    })
    state = journalReducer(state, {
      type: 'addObservation', observation: {
        id: 'missing', day: 1, text: '找不到证据的判断', entryIds: ['absent'], status: 'tentative',
      },
    })
    expect(state.observations).toEqual([])
  })

  it('removes dependent observations and scrubs answered question history on deletion', () => {
    let state = journalReducer(createJournalState('free'), {
      type: 'answer',
      entry: { id: 'e1', day: 1, topicId: 'daily', text: '私密旧句', occurredAt: '10:00', recordedAt: '10:10', source: 'user-answer' },
    })
    state = journalReducer(state, {
      type: 'addObservation',
      observation: { id: 'o1', day: 1, text: '由私密旧句推断的解释', entryIds: ['e1'], status: 'tentative' },
    })
    state = journalReducer(state, {
      type: 'answer',
      entry: { id: 'e2', day: 2, topicId: 'daily', text: '今天的回答', occurredAt: '12:00', recordedAt: '12:10', source: 'user-answer' },
    })
    state = journalReducer(state, { type: 'deleteEntry', id: 'e1' })

    expect(state.entries.map((entry) => entry.id)).toEqual(['e2'])
    expect(state.observations).toEqual([])
    expect(state.questions[2][0]).toMatchObject({ text: '引用已删除', referenceDeleted: true })
    expect(JSON.stringify(state)).not.toContain('私密旧句')
  })

  it('preserves both fixed synthetic questions answered on one day', () => {
    let state = journalReducer(createJournalState('story'), {
      type: 'answer',
      entry: { id: 'e1', day: 1, topicId: 'memory', text: '见朋友', occurredAt: '10:00', recordedAt: '10:10', source: 'synthetic-answer' },
      fixedPrompt: '今天最想记住什么？',
    })
    state = journalReducer(state, {
      type: 'answer',
      entry: { id: 'e2', day: 1, topicId: 'rest', text: '返程很晚', occurredAt: '23:00', recordedAt: '23:10', source: 'synthetic-answer' },
      fixedPrompt: '什么时候开始觉得累？',
    })

    expect(state.questions[1].map((question) => question.text)).toEqual([
      '今天最想记住什么？', '什么时候开始觉得累？',
    ])
    expect(state.questions[1].map((question) => question.answerEntryId)).toEqual(['e1', 'e2'])
  })
})
