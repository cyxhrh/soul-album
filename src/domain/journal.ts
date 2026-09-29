import { localQuestionText } from '../../shared/localQuestionCopy.js'

/** The only mutable facts in a demo space live in JournalState. No browser storage is used. */
export interface EntryRevision {
  text: string
  recordedAt: string
  revision: number
}

export interface Entry {
  id: string
  day: number
  topicId: string
  text: string
  occurredAt: string
  recordedAt: string
  source: string
  revision: number
  revisions: EntryRevision[]
}

export interface TitleRevision {
  title: string
  recordedAt: string
  revision: number
}

export interface DayTitle extends TitleRevision {
  revisions: TitleRevision[]
  /** All entries that could have informed any version of this user-written title. */
  dependencyEntryIds: string[]
}

export interface Observation {
  id: string
  day: number
  text: string
  entryIds: string[]
  status: 'tentative' | 'corrected'
  source: 'tentative-rule' | 'user-correction'
  revision: number
}

export interface SourceConsent {
  sourceId: string
  granted: boolean
  updatedAt: string
}

export interface SourceFact {
  id: string
  sourceId: string
  day: number
  kind: 'photo' | 'steps'
  title: string
  detail: string
  imageSrc?: string
  source: string
  device: string
  occurredAt: string
  recordedAt: string
  simulated: true
}

export interface QuestionRecord {
  day: number
  text: string
  provenance?: 'local_rule' | 'on_device_model' | 'cloud_model'
  approvedExcerpt?: string
  answerEntryId?: string
  citationEntryId?: string
  citationEntryRevision?: number
  citationObservationId?: string
  citationObservationRevision?: number
  dependencyEntryIds: string[]
  referenceDeleted: boolean
}

export interface JournalState {
  spaceId: string
  entries: Entry[]
  titles: Record<number, DayTitle>
  observations: Observation[]
  sourceConsents: Record<string, SourceConsent>
  sourceFacts: SourceFact[]
  /** Only answered questions are frozen as historical versions. */
  questions: Record<number, QuestionRecord[]>
}

export type JournalAction =
  | { type: 'answer'; entry: Omit<Entry, 'revision' | 'revisions'>; fixedPrompt?: string; citationEntryId?: string }
  | { type: 'editEntry'; id: string; text: string; recordedAt: string }
  | { type: 'deleteEntry'; id: string }
  | { type: 'setTitle'; day: number; title: string; recordedAt: string }
  | { type: 'addObservation'; observation: Omit<Observation, 'revision' | 'source'> }
  | { type: 'correctObservation'; id: string; text: string }
  | { type: 'keepOnlyFacts'; id: string }
  | { type: 'addSourceFact'; fact: SourceFact }
  | { type: 'setSourceConsent'; sourceId: string; granted: boolean; updatedAt: string }

export function createJournalState(spaceId: string): JournalState {
  return { spaceId, entries: [], titles: {}, observations: [], sourceConsents: {}, sourceFacts: [], questions: {} }
}

/** Match the reducer's privacy-first title withdrawal before a reader confirms an entry change. */
export function titleDaysAffectedByEntryChange(
  state: JournalState, entryId: string, change: 'editEntry' | 'deleteEntry',
): number[] {
  const entry = state.entries.find((item) => item.id === entryId)
  if (!entry) return []
  return Object.entries(state.titles)
    .filter(([day, title]) => title.dependencyEntryIds.includes(entryId) ||
      (change === 'deleteEntry' && Number(day) === entry.day))
    .map(([day]) => Number(day))
    .sort((first, second) => first - second)
}

/** Shared rule used by the reducer for answered-question history and by live selectors. */
export function currentRuleQuestion(state: JournalState, day: number, citationEntryId?: string): QuestionRecord {
  const shownTexts = Object.entries(state.questions)
    .filter(([questionDay]) => Number(questionDay) <= day)
    .sort(([first], [second]) => Number(first) - Number(second))
    .flatMap(([, questions]) => questions.map((question) => question.text))
  const selectedEntry = citationEntryId === undefined ? undefined :
    state.entries.find((entry) => entry.id === citationEntryId && entry.day <= day)
  if (citationEntryId !== undefined) return selectedEntry
    ? citedEntryQuestion(selectedEntry, day, shownTexts) : neutralQuestion(day, shownTexts)

  const correction = state.observations.reduce<Observation | undefined>((latest, observation) => {
    if (observation.day >= day || observation.status !== 'corrected' ||
      observation.entryIds.length === 0 ||
      !observation.entryIds.every((id) => state.entries.some((entry) => entry.id === id))) return latest
    return !latest || observation.day >= latest.day ? observation : latest
  }, undefined)
  if (correction) {
    return {
      day,
      text: localQuestionText('observation', shownTexts),
      citationObservationId: correction.id,
      citationObservationRevision: correction.revision,
      dependencyEntryIds: correction.entryIds,
      referenceDeleted: false,
    }
  }

  const previous = state.entries.reduce<Entry | undefined>((latest, entry) => {
    if (entry.day > day) return latest
    return !latest || entry.day > latest.day ? entry : latest
  }, undefined)
  return previous ? citedEntryQuestion(previous, day, shownTexts) : neutralQuestion(day, shownTexts)
}

function citedEntryQuestion(entry: Entry, day: number, shownTexts: readonly string[]): QuestionRecord {
  return {
    day, text: localQuestionText('entry', shownTexts),
    citationEntryId: entry.id, citationEntryRevision: entry.revision,
    dependencyEntryIds: [entry.id], referenceDeleted: false,
  }
}

function neutralQuestion(day: number, shownTexts: readonly string[]): QuestionRecord {
  return { day, text: localQuestionText('open', shownTexts), dependencyEntryIds: [], referenceDeleted: false }
}

export function journalReducer(state: JournalState, action: JournalAction): JournalState {
  switch (action.type) {
    case 'addSourceFact':
      if (state.sourceFacts.some((fact) => fact.id === action.fact.id)) return state
      return { ...state, sourceFacts: [...state.sourceFacts, action.fact] }
    case 'setSourceConsent':
      if (!action.sourceId.trim()) return state
      return { ...state, sourceConsents: {
        ...state.sourceConsents,
        [action.sourceId]: { sourceId: action.sourceId, granted: action.granted, updatedAt: action.updatedAt },
      } }
    case 'answer': {
      if (!action.entry.text.trim() || state.entries.some((entry) => entry.id === action.entry.id)) return state
      // Fixed prompts cover synthetic story lines and the free zone's neutral second prompt after a skip.
      // Neither carries a user-data citation.
      const question = action.fixedPrompt === undefined ? currentRuleQuestion(state, action.entry.day, action.citationEntryId) : {
        day: action.entry.day, text: action.fixedPrompt, dependencyEntryIds: [], referenceDeleted: false,
      }
      return {
        ...state,
        entries: [...state.entries, { ...action.entry, revision: 1, revisions: [] }],
        questions: {
          ...state.questions,
          [action.entry.day]: [...(state.questions[action.entry.day] ?? []), {
            ...question, answerEntryId: action.entry.id,
          }],
        },
      }
    }
    case 'editEntry': {
      if (!action.text.trim()) return state
      const edited = state.entries.some((entry) => entry.id === action.id && entry.text !== action.text)
      if (!edited) return state
      const affectedTitleDays = new Set(titleDaysAffectedByEntryChange(state, action.id, 'editEntry'))
      return {
        ...state,
        entries: state.entries.map((entry) => {
          if (entry.id !== action.id || entry.text === action.text) return entry
          return {
            ...entry,
            text: action.text,
            recordedAt: action.recordedAt,
            revision: entry.revision + 1,
            revisions: [...entry.revisions, {
              text: entry.text, recordedAt: entry.recordedAt, revision: entry.revision,
            }],
          }
        }),
        // Even a user correction was attached to the old evidence; withdraw it from active views.
        observations: state.observations.filter((observation) =>
          !observation.entryIds.includes(action.id)),
        // A title can retain the older phrasing after its possible source is revised.
        titles: Object.fromEntries(Object.entries(state.titles).filter(([day]) =>
          !affectedTitleDays.has(Number(day)))) as Record<number, DayTitle>,
      }
    }
    case 'deleteEntry': {
      const target = state.entries.find((entry) => entry.id === action.id)
      if (!target) return state
      const entries = state.entries.filter((entry) => entry.id !== action.id)
      const removedObservationIds = new Set(state.observations
        .filter((observation) => observation.entryIds.includes(action.id))
        .map((observation) => observation.id))
      const questions = Object.fromEntries(Object.entries(state.questions).map(([day, history]) => [day,
        history.filter((question) => question.answerEntryId !== action.id).map((question) => {
          const dependsOnDeleted = question.dependencyEntryIds.includes(action.id) ||
            (question.citationObservationId !== undefined && removedObservationIds.has(question.citationObservationId))
          return dependsOnDeleted ? {
            day: question.day, answerEntryId: question.answerEntryId,
            text: '引用已删除', dependencyEntryIds: [], referenceDeleted: true,
          } : question
        }),
      ])) as Record<number, QuestionRecord[]>
      const titles = { ...state.titles }
      // User titles can paraphrase earlier answers, including answers from another day.
      // Remove the whole title history when one possible source disappears.
      for (const day of titleDaysAffectedByEntryChange(state, action.id, 'deleteEntry')) delete titles[day]
      return {
        ...state, entries, titles, questions,
        observations: state.observations.filter((observation) => !removedObservationIds.has(observation.id)),
      }
    }
    case 'setTitle': {
      const previous = state.titles[action.day]
      if (previous?.title === action.title) return state
      // A user can revisit any day and copy or paraphrase any answer in the session.
      // Retain every currently available entry as a possible free-form title source.
      const dependencyEntryIds = [...new Set([
        ...(previous?.dependencyEntryIds ?? []),
        ...state.entries.map((entry) => entry.id),
      ])]
      const next: DayTitle = previous ? {
        title: action.title, recordedAt: action.recordedAt, revision: previous.revision + 1,
        dependencyEntryIds,
        revisions: [...previous.revisions, {
          title: previous.title, recordedAt: previous.recordedAt, revision: previous.revision,
        }],
      } : { title: action.title, recordedAt: action.recordedAt, revision: 1, revisions: [], dependencyEntryIds }
      return { ...state, titles: { ...state.titles, [action.day]: next } }
    }
    case 'addObservation':
      if (!action.observation.text.trim() || state.observations.some((item) => item.id === action.observation.id) ||
        action.observation.entryIds.length === 0 ||
        !action.observation.entryIds.every((id) => state.entries.some((entry) => entry.id === id))) return state
      return {
        ...state,
        observations: [...state.observations, {
          ...action.observation, source: 'tentative-rule', revision: 1,
        }],
      }
    case 'correctObservation':
      if (!action.text.trim()) return state
      return {
        ...state,
        observations: state.observations.map((item) => item.id === action.id ? {
          ...item, text: action.text, status: 'corrected', source: 'user-correction', revision: item.revision + 1,
        } : item),
      }
    case 'keepOnlyFacts': {
      const removed = state.observations.find((item) => item.id === action.id)
      if (!removed) return state
      return {
        ...state,
        observations: state.observations.filter((item) => item.id !== action.id),
        questions: Object.fromEntries(Object.entries(state.questions).map(([day, history]) => [day,
          history.map((question) => question.citationObservationId === action.id ? {
            day: question.day, answerEntryId: question.answerEntryId,
            text: '引用已删除', dependencyEntryIds: [], referenceDeleted: true,
          } : question),
        ])) as Record<number, QuestionRecord[]>,
      }
    }
  }
}
