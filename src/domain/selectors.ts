import { currentRuleQuestion, type JournalState, type Observation, type QuestionRecord, type SourceFact } from './journal'

export interface AlbumEntry {
  id: string
  day: number
  topicId: string
  text: string
  occurredAt: string
  recordedAt: string
  source: string
  revision: number
}

export interface AlbumView {
  spaceId: string
  day: number
  title: string
  titleRevision: number
  entries: AlbumEntry[]
  sources: (SourceFact & { consentUpdatedAt: string })[]
  observations: Observation[]
  /** Compatibility for the guided story, which presents one current observation. */
  observation: Observation | null
}

export interface ComparisonView {
  spaceId: string
  firstDay: number
  secondDay: number
  topicId: string
  entries: [AlbumEntry, AlbumEntry]
}

export interface QuestionView extends QuestionRecord {
  mode: 'rule' | 'cloud'
  status: 'ready' | 'reference-revised' | 'reference-deleted'
}

function viewEntry(entry: JournalState['entries'][number]): AlbumEntry {
  const { id, day, topicId, text, occurredAt, recordedAt, source, revision } = entry
  return { id, day, topicId, text, occurredAt, recordedAt, source, revision }
}

/** This view is also the source for current-day printing; it contains no old revisions. */
export function selectAlbum(state: JournalState, day: number): AlbumView | null {
  const entries = state.entries.filter((entry) => entry.day === day)
  const validObservations = state.observations.filter((item) =>
    item.day === day && item.entryIds.length > 0 &&
    item.entryIds.every((id) => state.entries.some((entry) => entry.id === id)),
  )
  const observation = validObservations.at(-1) ?? null
  const observations = validObservations.filter((item) =>
    item.status === 'corrected' || item.id === observation?.id)
  if (entries.length === 0 && !observation) return null
  return {
    spaceId: state.spaceId,
    day,
    title: state.titles[day]?.title ?? `第 ${day} 天`,
    titleRevision: state.titles[day]?.revision ?? 0,
    entries: entries.map(viewEntry),
    sources: state.sourceFacts.filter((fact) => fact.day === day && state.sourceConsents[fact.sourceId]?.granted)
      .map((fact) => ({ ...fact, consentUpdatedAt: state.sourceConsents[fact.sourceId].updatedAt })),
    observations,
    observation,
  }
}

export function selectComparison(state: JournalState, firstDay: number, secondDay: number): ComparisonView | null {
  if (firstDay === secondDay) return null
  const first = state.entries.filter((entry) => entry.day === firstDay)
  const second = state.entries.filter((entry) => entry.day === secondDay)
  const firstEntry = [...first].reverse().find((entry) => second.some((other) => other.topicId === entry.topicId))
  if (!firstEntry) return null
  const secondEntry = [...second].reverse().find((entry) => entry.topicId === firstEntry.topicId)
  if (!secondEntry) return null
  return {
    spaceId: state.spaceId, firstDay, secondDay, topicId: firstEntry.topicId,
    entries: [viewEntry(firstEntry), viewEntry(secondEntry)],
  }
}

function questionView(state: JournalState, question: QuestionRecord): QuestionView {
  let status: QuestionView['status'] = 'ready'
  if (question.referenceDeleted) status = 'reference-deleted'
  else if (question.citationEntryId) {
    const entry = state.entries.find((item) => item.id === question.citationEntryId)
    if (!entry) status = 'reference-deleted'
    else if (entry.revision !== question.citationEntryRevision) status = 'reference-revised'
  } else if (question.citationObservationId) {
    const observation = state.observations.find((item) => item.id === question.citationObservationId)
    if (!observation) status = 'reference-revised'
    else if (observation.revision !== question.citationObservationRevision) status = 'reference-revised'
  }
  return { ...question, mode: question.provenance === 'cloud_model' ? 'cloud' : 'rule', status }
}

/** Always returns the next rule prompt from current facts, including earlier answers today. */
export function selectRuleQuestion(state: JournalState, day: number, citationEntryId?: string): QuestionView {
  return questionView(state, currentRuleQuestion(state, day, citationEntryId))
}

/** Historical prompts are separate so a pending same-day question is never masked by an answered one. */
export function selectAnsweredQuestions(state: JournalState, day: number): QuestionView[] {
  return (state.questions[day] ?? []).map((question) => questionView(state, question))
}
