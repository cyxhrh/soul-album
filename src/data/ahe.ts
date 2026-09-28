import { createJournalState, journalReducer, type JournalState, type SourceFact } from '../domain/journal'
import { selectRuleQuestion } from '../domain/selectors'

export const AHE_TODAY = 23
export const AHE_TOMORROW = 24
export const AHE_DAYS = [15, 19, AHE_TODAY, AHE_TOMORROW] as const

export function aheDate(day: number): string {
  return `2026年9月${day}日`
}

export const aheTodayAnswers = [
  {
    prompt: '今天最想记住什么？',
    entry: {
      id: 'ahe-today-joy', day: AHE_TODAY, topicId: 'friends',
      text: '昨晚见了朋友，聊天很开心。', occurredAt: '2026-09-22T19:30:00+08:00',
      recordedAt: '2026-09-23T20:14:00+08:00', source: '阿禾的合成回答',
    },
  },
  {
    prompt: '什么时候开始觉得累？',
    entry: {
      id: 'ahe-today-return', day: AHE_TODAY, topicId: 'late-return',
      text: '返程过零点，今天起床才觉得累。', occurredAt: '2026-09-23T00:30:00+08:00',
      recordedAt: '2026-09-23T20:15:00+08:00', source: '阿禾的合成回答',
    },
  },
] as const

export const aheTomorrowAnswer = {
  id: 'ahe-next-day', day: AHE_TOMORROW, topicId: 'late-return',
  text: '今天没有晚归，早上精神比昨天好一些。',
  occurredAt: '2026-09-24T09:00:00+08:00',
  recordedAt: '2026-09-24T20:14:00+08:00', source: '阿禾的合成回答',
} as const

export const AHE_OBSERVATION_ID = 'ahe-social-reading'
export const AHE_TENTATIVE_READING = '也许聚会让你耗力'
export const AHE_CORRECTION = '和朋友相处让我开心，可能是返程太晚'
const AHE_DERIVED_READING = '两次晚归后，次日提到疲惫；原因仍需更多记录。'
export const AHE_OBSERVATION_ENTRY_IDS = ['ahe-past-friends', 'ahe-past-return', 'ahe-today-joy', 'ahe-today-return']

export const AHE_SOURCE_FACTS: SourceFact[] = [
  {
    id: 'ahe-photo-street', sourceId: 'photo', day: AHE_TODAY, kind: 'photo',
    title: '雨后街角', detail: '一张雨后街角的合成示例照片', imageSrc: `${import.meta.env.BASE_URL}synthetic-street-2026-09-29.png`,
    source: '合成照片', device: '演示相册',
    occurredAt: '2026-09-23T18:10:00+08:00', recordedAt: '2026-09-23T20:20:00+08:00', simulated: true,
  },
  {
    id: 'ahe-steps', sourceId: 'steps', day: AHE_TODAY, kind: 'steps',
    title: '当天步数', detail: '4,200 步', source: '模拟步数', device: '模拟手表',
    occurredAt: '2026-09-23T18:00:00+08:00', recordedAt: '2026-09-23T20:21:00+08:00', simulated: true,
  },
]

/** Labels are presentation metadata for this synthetic script, not inferred from an ID prefix. */
export const AHE_ENTRY_LABELS: Readonly<Record<string, readonly string[]>> = {
  'ahe-past-friends': ['用户感受'],
  'ahe-past-return': ['自述事实', '用户感受'],
  'ahe-today-joy': ['用户感受'],
  'ahe-today-return': ['自述事实', '用户感受'],
  'ahe-next-day': ['自述事实', '用户感受'],
}

function activeAheCorrection(journal: JournalState) {
  return journal.observations.find((observation) =>
    observation.id === AHE_OBSERVATION_ID && observation.status === 'corrected' &&
    observation.source === 'user-correction' &&
    observation.entryIds.every((id) => journal.entries.some((entry) => entry.id === id)))
}

/** The question quotes only 阿禾's current correction; removing its evidence removes this wording. */
export function selectAheTomorrowQuestion(journal: JournalState): string {
  const correction = activeAheCorrection(journal)
  return correction
    ? `你补充说“${correction.text}”。今天的作息有什么不同？`
    : selectRuleQuestion(journal, AHE_TOMORROW).text
}

/** Scripted Agent language appears only while the corrected evidence is still active. */
export function selectAheDerivedReading(journal: JournalState): string | null {
  const correction = activeAheCorrection(journal)
  if (!correction) return null
  const lateDays = new Set(journal.entries
    .filter((entry) => correction.entryIds.includes(entry.id) && entry.topicId === 'late-return')
    .map((entry) => entry.day))
  return lateDays.size >= 2 ? AHE_DERIVED_READING : null
}

/** Past answers are seeded through the same reducer as the live guided answers. */
export function createAheJournal(): JournalState {
  let journal = createJournalState('ahe')
  for (const fact of AHE_SOURCE_FACTS) journal = journalReducer(journal, { type: 'addSourceFact', fact })
  journal = journalReducer(journal, {
    type: 'answer', fixedPrompt: '那天想记住什么？',
    entry: {
      id: 'ahe-past-friends', day: 15, topicId: 'friends',
      text: '和朋友吃饭很开心，回家后休息得早。',
      occurredAt: '2026-09-15T21:00:00+08:00',
      recordedAt: '2026-09-15T21:18:00+08:00', source: '阿禾的合成回答',
    },
  })
  journal = journalReducer(journal, {
    type: 'answer', fixedPrompt: '那天想记住什么？',
    entry: {
      id: 'ahe-past-return', day: 19, topicId: 'late-return',
      text: '活动结束后返程过零点，第二天起床很累。',
      occurredAt: '2026-09-19T00:35:00+08:00',
      recordedAt: '2026-09-19T20:22:00+08:00', source: '阿禾的合成回答',
    },
  })
  return journal
}
