import { classifyChatIntent } from '../../src/domain/chatIntent.js'
import { journalDate } from './date.js'
import { LocalDomainError } from './errors.js'
import { correctSettledInvitation, settleInvitation } from './invitations.js'
import { canonicalFingerprint } from './store.js'
import type { SpaceRepository } from './store.js'
import type {
  CitationRef, DayTitle, InterpretationKind, InvitationState, JournalEntry, Observation, Question,
  SpaceSnapshot, StoredMessage,
} from './types.js'

type NewId = () => string
type Now = () => string

interface Dependencies {
  now?: Now
  newId?: NewId
}

export interface SendMessageRequest {
  clientOperationId: string
  expectedSpaceRevision: number
  text: string
  occurredAt: string
  timezone: string
  visibleQuestionId?: string | null
  visibleInvitationId?: string | null
  /** UI says this was the last prompt in the shown round; it is not a user-facing mode choice. */
  closeRound?: boolean
}

export interface MessageView extends Omit<StoredMessage, 'controlText'> {
  text: string
}

export interface SendMessageResult {
  spaceRevision: number
  message: MessageView
  entry: JournalEntry | null
  answeredQuestion: Question | null
  nextQuestion: Question | null
  invitation: InvitationState
}

export interface DisplayQuestionRequest {
  clientOperationId: string
  expectedSpaceRevision: number
  kind: 'open' | 'moment' | 'reflection'
  displayedAt: string
  citations: CitationRef[]
  invitationId?: string | null
}

export interface SetDayTitleRequest {
  clientOperationId: string
  date: string
  text: string
  expectedRevision: number
  expectedSpaceRevision: number
}

export interface EntryChangeRequest {
  clientOperationId: string
  entryId: string
  expectedRevision: number
}

export interface EditEntryRequest extends EntryChangeRequest {
  text: string
}

export interface EntryChangeResult {
  spaceRevision: number
  entry: JournalEntry | null
  invalidatedObservationIds: string[]
  invalidatedQuestionIds: string[]
  withdrawnTitleDates: string[]
}

export interface CorrectInterpretationRequest {
  clientOperationId: string
  messageId: string
  expectedMessageRevision: number
  correctedKind: InterpretationKind
}

export interface DeleteControlMessageRequest {
  clientOperationId: string
  messageId: string
  expectedMessageRevision: number
}

export interface DayPage {
  spaceId: string
  spaceRevision: number
  date: string
  timezone: string
  title: DayTitle | null
  entries: JournalEntry[]
  questions: Question[]
  observations: Observation[]
}

function requireText(text: string): void {
  if (typeof text !== 'string' || !text.trim() || text.length > 10_000) {
    throw new LocalDomainError('invalid_input')
  }
}

function commandFingerprint(kind: string, ...fields: unknown[]): string {
  return canonicalFingerprint([kind, ...fields])
}

function entryById(draft: SpaceSnapshot, id: string): JournalEntry {
  const entry = draft.entries.find((item) => item.id === id)
  if (!entry) throw new LocalDomainError('not_found')
  return entry
}

function hasLaterQuestion(draft: SpaceSnapshot, question: Question): boolean {
  const index = draft.questions.findIndex((item) => item.id === question.id)
  return index >= 0 && draft.questions.slice(index + 1).length > 0
}

function hasNewerShownRound(draft: SpaceSnapshot, invitationDate: string): boolean {
  return draft.invitations.invitations.some((item) => item.date > invitationDate &&
    ['shown', 'settled_answered', 'settled_unanswered'].includes(item.state))
}

function releaseSkippedQuestion(draft: SpaceSnapshot, question: Question): void {
  question.skippedByMessageId = null
  if (!hasLaterQuestion(draft, question)) question.status = 'ready'
  question.revision += 1
}

function messageView(message: StoredMessage, snapshot: SpaceSnapshot): MessageView {
  const text = message.entryId === null
    ? message.controlText
    : snapshot.entries.find((entry) => entry.id === message.entryId)?.text
  if (text == null) throw new LocalDomainError('not_found')
  return {
    id: message.id,
    clientOperationId: message.clientOperationId,
    sequence: message.sequence,
    occurredAt: message.occurredAt,
    recordedAt: message.recordedAt,
    revision: message.revision,
    interpretation: { ...message.interpretation },
    replyToQuestionId: message.replyToQuestionId,
    invitationId: message.invitationId,
    entryId: message.entryId,
    controlEvent: message.controlEvent,
    text,
  }
}

function affectedByEntry(draft: SpaceSnapshot, entryId: string): Set<string> {
  return new Set(draft.observations
    .filter((observation) => observation.citations.some((citation) => citation.id === entryId))
    .map((observation) => observation.id))
}

function invalidateDependencies(
  draft: SpaceSnapshot, entryId: string, replacement: '引用已修订' | '引用已删除',
  nextRevision: number, changedAt: string,
): Pick<EntryChangeResult, 'invalidatedObservationIds' | 'invalidatedQuestionIds' | 'withdrawnTitleDates'> {
  const affectedObservations = affectedByEntry(draft, entryId)
  draft.observations = draft.observations.filter((observation) => !affectedObservations.has(observation.id))
  for (const observationId of affectedObservations) {
    draft.tombstones.push({
      entityId: observationId, entityKind: 'observation', deletedAt: changedAt,
      spaceRevision: nextRevision,
    })
  }
  const invalidatedQuestionIds: string[] = []
  for (const question of draft.questions) {
    const affected = question.citations.some((citation) =>
      (citation.kind === 'entry' && citation.id === entryId) ||
      (citation.kind === 'observation' && affectedObservations.has(citation.id)))
    if (!affected || question.status === 'citation_revised' || question.status === 'citation_deleted') continue
    question.text = replacement
    question.status = replacement === '引用已删除' ? 'citation_deleted' : 'citation_revised'
    question.revision += 1
    invalidatedQuestionIds.push(question.id)
  }
  const withdrawnTitleDates = Object.entries(draft.titles)
    .filter(([, title]) => title.dependencyEntryIds.includes(entryId))
    .map(([date]) => date).sort()
  for (const date of withdrawnTitleDates) delete draft.titles[date]
  return {
    invalidatedObservationIds: [...affectedObservations], invalidatedQuestionIds, withdrawnTitleDates,
  }
}

/** Transport-independent local core. This memory adapter is not encrypted persistence. */
export class LocalJournalService {
  private readonly repository: SpaceRepository
  private readonly now: Now
  private readonly newId: NewId

  constructor(repository: SpaceRepository, dependencies: Dependencies = {}) {
    this.repository = repository
    this.now = dependencies.now ?? (() => new Date().toISOString())
    this.newId = dependencies.newId ?? (() => globalThis.crypto.randomUUID())
  }

  displayQuestion(spaceId: string, request: DisplayQuestionRequest): Question {
    if ('text' in request || !Array.isArray(request.citations) || request.citations.length > 3 ||
      !['open', 'moment', 'reflection'].includes(request.kind) ||
      (request.kind === 'reflection') !== (request.citations.length > 0)) {
      throw new LocalDomainError('invalid_input')
    }
    const citationIds = request.citations.map((citation) => `${citation.kind}:${citation.id}`)
    if (new Set(citationIds).size !== citationIds.length) throw new LocalDomainError('invalid_input')
    const fingerprint = commandFingerprint(
      'displayQuestion', request.expectedSpaceRevision, request.kind, request.displayedAt,
      request.citations, request.invitationId ?? null,
    )
    return this.repository.transact(spaceId, {
      clientOperationId: request.clientOperationId, fingerprint,
      expectedSpaceRevision: request.expectedSpaceRevision,
    }, (draft) => {
      journalDate(request.displayedAt, draft.timezone)
      if (request.invitationId) {
        const invitation = draft.invitations.invitations.find((item) => item.id === request.invitationId)
        if (!invitation) throw new LocalDomainError('not_found')
        const roundQuestions = draft.questions.filter((item) => item.invitationId === invitation.id)
        const previous = roundQuestions.at(-1)
        if (invitation.state !== 'shown' || hasNewerShownRound(draft, invitation.date) ||
          journalDate(request.displayedAt, draft.timezone) !== invitation.date ||
          roundQuestions.length >= invitation.questionTarget ||
          (previous?.status === 'ready' && !previous.answeredByMessageId)) {
          throw new LocalDomainError('revision_conflict')
        }
      }
      const citedTexts: string[] = []
      for (const citation of request.citations) {
        if (!['entry', 'observation'].includes(citation.kind)) throw new LocalDomainError('invalid_input')
        const source = citation.kind === 'entry'
          ? draft.entries.find((entry) => entry.id === citation.id)
          : draft.observations.find((observation) => observation.id === citation.id)
        if (!source || source.revision !== citation.revision) throw new LocalDomainError('revision_conflict')
        if (citation.kind === 'observation' && 'status' in source && source.status !== 'user_corrected') {
          throw new LocalDomainError('invalid_input')
        }
        citedTexts.push(source.text.slice(0, 80))
      }
      const text = request.kind === 'open' ? '今天有什么想记下的？'
        : request.kind === 'moment' ? '今天有没有一个小瞬间想留在画册里？'
          : request.citations.length === 1 && request.citations[0].kind === 'entry'
            ? `你之前说“${citedTexts[0]}”。今天有什么想记下的？`
            : request.citations.length === 1 && request.citations[0].kind === 'observation'
              ? `你补充说“${citedTexts[0]}”。今天还有什么想记下的？`
              : `你之前提到${citedTexts.map((item) => `“${item}”`).join('、')}。今天有什么不同？`
      const question: Question = {
        id: this.newId(), revision: 1, text,
        provenance: 'local_rule', status: 'ready', displayedAt: request.displayedAt,
        answeredByMessageId: null, skippedByMessageId: null,
        invitationId: request.invitationId ?? null,
        citations: request.citations.map((citation) => ({ ...citation })),
      }
      draft.questions.push(question)
      return question
    })
  }

  sendMessage(spaceId: string, request: SendMessageRequest): SendMessageResult {
    requireText(request.text)
    if (request.closeRound && !request.visibleInvitationId) throw new LocalDomainError('invalid_input')
    const fingerprint = commandFingerprint(
      'sendMessage', request.expectedSpaceRevision, request.text, request.occurredAt, request.timezone,
      request.visibleQuestionId ?? null, request.visibleInvitationId ?? null, request.closeRound ?? false,
    )
    return this.repository.transact(spaceId, {
      clientOperationId: request.clientOperationId, fingerprint,
      expectedSpaceRevision: request.expectedSpaceRevision,
    }, (draft, nextRevision) => {
      if (request.timezone !== draft.timezone) throw new LocalDomainError('invalid_input')
      const date = journalDate(request.occurredAt, request.timezone)
      const visibleQuestion = request.visibleQuestionId
        ? draft.questions.find((question) => question.id === request.visibleQuestionId)
        : undefined
      if (request.visibleQuestionId && !visibleQuestion) throw new LocalDomainError('not_found')
      if (visibleQuestion && (visibleQuestion.status !== 'ready' || visibleQuestion.answeredByMessageId)) {
        throw new LocalDomainError('revision_conflict')
      }
      const visibleInvitation = request.visibleInvitationId
        ? draft.invitations.invitations.find((item) => item.id === request.visibleInvitationId)
        : undefined
      if (request.visibleInvitationId && !visibleInvitation) throw new LocalDomainError('not_found')
      if (visibleInvitation && (visibleInvitation.state !== 'shown' ||
        hasNewerShownRound(draft, visibleInvitation.date))) {
        throw new LocalDomainError('revision_conflict')
      }
      if (visibleQuestion && (visibleQuestion.invitationId ?? null) !==
        (request.visibleInvitationId ?? null)) {
        throw new LocalDomainError('revision_conflict')
      }
      const intent = classifyChatIntent(request.text)
      const controlEvent = intent === 'skip' || intent === 'decline' || intent === 'more'
        ? ({ more: 'request_more', skip: 'skip', decline: 'decline' } as const)[intent] : null
      const recordedAt = this.now()
      const messageId = this.newId()
      const entry: JournalEntry | null = controlEvent ? null : {
        id: this.newId(), messageId, text: request.text, journalDate: date,
        timezone: request.timezone, occurredAt: request.occurredAt,
        recordedAt, revision: 1, source: 'conversation',
      }
      const kind = controlEvent ?? (visibleQuestion && intent !== 'share' ? 'answer' : 'proactive_record')
      if (visibleInvitation && request.closeRound && kind !== 'decline') {
        const roundQuestions = draft.questions.filter((item) =>
          item.invitationId === visibleInvitation.id)
        if (kind === 'request_more' || !visibleQuestion ||
          roundQuestions.length < visibleInvitation.questionTarget ||
          roundQuestions.at(-1)?.id !== visibleQuestion.id) {
          throw new LocalDomainError('revision_conflict')
        }
      }
      const stored: StoredMessage = {
        id: messageId, clientOperationId: request.clientOperationId,
        sequence: draft.nextMessageSequence++, occurredAt: request.occurredAt,
        recordedAt, revision: 1,
        interpretation: { kind, status: 'proposed', provenance: 'local_rule' },
        replyToQuestionId: visibleQuestion?.id ?? null,
        invitationId: request.visibleInvitationId ?? null,
        entryId: entry?.id ?? null, controlEvent, controlText: controlEvent ? request.text : null,
      }
      draft.messages.push(stored)
      if (entry) draft.entries.push(entry)
      if (kind === 'answer' && visibleQuestion) {
        visibleQuestion.answeredByMessageId = messageId
        visibleQuestion.revision += 1
      } else if ((kind === 'skip' || kind === 'decline') && visibleQuestion) {
        visibleQuestion.status = 'skipped'
        visibleQuestion.skippedByMessageId = messageId
        visibleQuestion.revision += 1
      }
      if (visibleInvitation && (kind === 'decline' || request.closeRound)) {
        for (const question of draft.questions) {
          if (question.invitationId !== visibleInvitation.id || question.status !== 'ready' ||
            question.answeredByMessageId) continue
          question.status = 'skipped'
          question.skippedByMessageId = messageId
          question.revision += 1
        }
        const answeredInRound = draft.messages.some((message) =>
          message.invitationId === visibleInvitation.id && message.entryId !== null &&
          (message.interpretation.kind === 'answer' ||
            message.interpretation.kind === 'proactive_record'))
        draft.invitations = settleInvitation(
          draft.invitations, visibleInvitation.id, answeredInRound, recordedAt, this.newId(),
        )
      }
      const answeredQuestion = kind === 'answer' && visibleQuestion ? visibleQuestion : null
      return {
        spaceRevision: nextRevision, message: messageView(stored, draft), entry,
        answeredQuestion, nextQuestion: null, invitation: draft.invitations,
      }
    })
  }

  correctInterpretation(spaceId: string, request: CorrectInterpretationRequest): SendMessageResult {
    const validKinds: InterpretationKind[] = [
      'answer', 'proactive_record', 'skip', 'decline', 'request_more', 'uncertain',
    ]
    if (!validKinds.includes(request.correctedKind)) throw new LocalDomainError('invalid_input')
    const fingerprint = commandFingerprint(
      'correctInterpretation', request.messageId, request.expectedMessageRevision, request.correctedKind,
    )
    return this.repository.transact(spaceId, {
      clientOperationId: request.clientOperationId, fingerprint,
      expectedSpaceRevision: this.repository.read(spaceId).revision,
    }, (draft, nextRevision) => {
      const message = draft.messages.find((item) => item.id === request.messageId)
      if (!message) throw new LocalDomainError('not_found')
      if (message.revision !== request.expectedMessageRevision) throw new LocalDomainError('revision_conflict')
      const invitation = draft.invitations.invitations.find((item) => item.id === message.invitationId)
      if (invitation && (!['shown', 'settled_answered', 'settled_unanswered'].includes(invitation.state) ||
        (invitation.state === 'shown' && hasNewerShownRound(draft, invitation.date)))) {
        throw new LocalDomainError('revision_conflict')
      }
      const correctedKind = request.correctedKind
      const correctedControl = correctedKind === 'skip' || correctedKind === 'decline' ||
        correctedKind === 'request_more'
      const changedAt = this.now()
      const previousQuestion = draft.questions.find((item) => item.answeredByMessageId === message.id)
      if (previousQuestion && correctedKind !== 'answer') {
        previousQuestion.answeredByMessageId = null
        previousQuestion.revision += 1
      }
      const skippedQuestions = draft.questions.filter((item) => item.skippedByMessageId === message.id)
      if (correctedKind !== 'skip' && correctedKind !== 'decline') {
        for (const skippedQuestion of skippedQuestions) {
          if (correctedKind === 'answer' && skippedQuestion.id === message.replyToQuestionId) {
            skippedQuestion.status = 'ready'
            skippedQuestion.skippedByMessageId = null
            skippedQuestion.revision += 1
          } else if (invitation?.state.startsWith('settled_')) {
            skippedQuestion.skippedByMessageId = null
            skippedQuestion.revision += 1
          } else releaseSkippedQuestion(draft, skippedQuestion)
        }
      }
      let entry = message.entryId
        ? draft.entries.find((item) => item.id === message.entryId) ?? null : null
      if (correctedControl && entry) {
        const text = entry.text
        invalidateDependencies(draft, entry.id, '引用已删除', nextRevision, changedAt)
        draft.entries = draft.entries.filter((item) => item.id !== entry!.id)
        draft.tombstones.push({
          entityId: entry.id, entityKind: 'entry', deletedAt: changedAt,
          spaceRevision: nextRevision,
        })
        message.entryId = null
        message.controlText = text
        entry = null
      } else if (!correctedControl && !entry) {
        if (message.controlText === null) throw new LocalDomainError('revision_conflict')
        entry = {
          id: this.newId(), messageId: message.id, text: message.controlText,
          journalDate: journalDate(message.occurredAt, draft.timezone),
          timezone: draft.timezone, occurredAt: message.occurredAt,
          recordedAt: changedAt, revision: 1, source: 'conversation',
        }
        draft.entries.push(entry)
        message.entryId = entry.id
        message.controlText = null
      }
      if (correctedKind === 'answer') {
        const question = draft.questions.find((item) => item.id === message.replyToQuestionId)
        if (!question || question.status !== 'ready' ||
          (question.answeredByMessageId && question.answeredByMessageId !== message.id)) {
          throw new LocalDomainError('revision_conflict')
        }
        if (question.answeredByMessageId !== message.id) {
          question.answeredByMessageId = message.id
          question.revision += 1
        }
      } else if (correctedKind === 'skip' || correctedKind === 'decline') {
        const question = draft.questions.find((item) => item.id === message.replyToQuestionId)
        if (question?.status === 'ready' && !question.answeredByMessageId &&
          question.skippedByMessageId !== message.id) {
          question.status = 'skipped'
          question.skippedByMessageId = message.id
          question.revision += 1
        }
      }
      message.controlEvent = correctedControl
        ? correctedKind === 'request_more' ? 'request_more' : correctedKind : null
      message.interpretation = {
        kind: correctedKind, status: 'user_corrected', provenance: 'user_correction',
      }
      message.recordedAt = changedAt
      message.revision += 1
      if (invitation) {
        const answeredInRound = draft.messages.some((item) =>
          item.invitationId === invitation.id && item.entryId !== null &&
          (item.interpretation.kind === 'answer' || item.interpretation.kind === 'proactive_record'))
        if (invitation.state === 'shown' && correctedKind === 'decline') {
          for (const question of draft.questions) {
            if (question.invitationId !== invitation.id || question.status !== 'ready' ||
              question.answeredByMessageId) continue
            question.status = 'skipped'
            question.skippedByMessageId = message.id
            question.revision += 1
          }
          draft.invitations = settleInvitation(
            draft.invitations, invitation.id, answeredInRound, changedAt, this.newId(),
          )
        } else if (invitation.state.startsWith('settled_')) {
          draft.invitations = correctSettledInvitation(
            draft.invitations, invitation.id, answeredInRound, changedAt,
            journalDate(changedAt, draft.timezone), this.newId(), this.newId(),
          )
        }
      }
      const answeredQuestion = correctedKind === 'answer'
        ? draft.questions.find((item) => item.id === message.replyToQuestionId) ?? null : null
      return {
        spaceRevision: nextRevision, message: messageView(message, draft), entry,
        answeredQuestion, nextQuestion: null, invitation: draft.invitations,
      }
    })
  }

  deleteControlMessage(spaceId: string, request: DeleteControlMessageRequest): { spaceRevision: number } {
    const fingerprint = commandFingerprint(
      'deleteControlMessage', request.messageId, request.expectedMessageRevision,
    )
    return this.repository.transact(spaceId, {
      clientOperationId: request.clientOperationId, fingerprint,
      expectedSpaceRevision: this.repository.read(spaceId).revision,
    }, (draft, nextRevision) => {
      const message = draft.messages.find((item) => item.id === request.messageId)
      if (!message) throw new LocalDomainError('not_found')
      if (message.revision !== request.expectedMessageRevision) throw new LocalDomainError('revision_conflict')
      if (message.entryId !== null || message.controlText === null) throw new LocalDomainError('invalid_input')
      for (const skippedQuestion of draft.questions.filter((item) => item.skippedByMessageId === message.id)) {
        if (message.invitationId) {
          skippedQuestion.skippedByMessageId = null
          skippedQuestion.revision += 1
        } else releaseSkippedQuestion(draft, skippedQuestion)
      }
      draft.messages = draft.messages.filter((item) => item.id !== message.id)
      draft.tombstones.push({
        entityId: message.id, entityKind: 'message', deletedAt: this.now(),
        spaceRevision: nextRevision,
      })
      return { spaceRevision: nextRevision }
    })
  }

  listMessages(spaceId: string): MessageView[] {
    const snapshot = this.repository.read(spaceId)
    return snapshot.messages.map((message) => messageView(message, snapshot))
      .sort((left, right) => left.sequence - right.sequence)
  }

  listDays(spaceId: string): { spaceId: string; spaceRevision: number; dates: string[] } {
    const snapshot = this.repository.read(spaceId)
    return {
      spaceId: snapshot.id, spaceRevision: snapshot.revision,
      dates: [...new Set(snapshot.entries.map((entry) => entry.journalDate))].sort().reverse(),
    }
  }

  getDay(spaceId: string, date: string): DayPage | null {
    const snapshot = this.repository.read(spaceId)
    const entries = snapshot.entries.filter((entry) => entry.journalDate === date)
    if (entries.length === 0) return null
    const entryIds = new Set(entries.map((entry) => entry.id))
    const messageIds = new Set(entries.map((entry) => entry.messageId))
    return {
      spaceId: snapshot.id, spaceRevision: snapshot.revision, date, timezone: snapshot.timezone,
      title: snapshot.titles[date] ?? null, entries,
      questions: snapshot.questions.filter((question) =>
        journalDate(question.displayedAt, snapshot.timezone) === date ||
        (question.answeredByMessageId && messageIds.has(question.answeredByMessageId))),
      observations: snapshot.observations.filter((observation) =>
        observation.citations.some((citation) => entryIds.has(citation.id))),
    }
  }

  setDayTitle(spaceId: string, request: SetDayTitleRequest): DayTitle {
    requireText(request.text)
    const fingerprint = commandFingerprint(
      'setDayTitle', request.date, request.text, request.expectedRevision, request.expectedSpaceRevision,
    )
    return this.repository.transact(spaceId, {
      clientOperationId: request.clientOperationId, fingerprint,
      expectedSpaceRevision: request.expectedSpaceRevision,
    }, (draft) => {
      if (!draft.entries.some((entry) => entry.journalDate === request.date)) {
        throw new LocalDomainError('not_found')
      }
      const previous = draft.titles[request.date]
      if ((previous?.revision ?? 0) !== request.expectedRevision) {
        throw new LocalDomainError('revision_conflict')
      }
      const title: DayTitle = {
        text: request.text, revision: (previous?.revision ?? 0) + 1,
        dependencyEntryIds: [...new Set([
          ...(previous?.dependencyEntryIds ?? []), ...draft.entries.map((entry) => entry.id),
        ])],
      }
      draft.titles[request.date] = title
      return title
    })
  }

  editEntry(spaceId: string, request: EditEntryRequest): EntryChangeResult {
    requireText(request.text)
    const fingerprint = commandFingerprint(
      'editEntry', request.entryId, request.expectedRevision, request.text,
    )
    return this.repository.transact(spaceId, {
      clientOperationId: request.clientOperationId, fingerprint,
      expectedSpaceRevision: this.repository.read(spaceId).revision,
    }, (draft, nextRevision) => {
      const entry = entryById(draft, request.entryId)
      if (entry.revision !== request.expectedRevision) throw new LocalDomainError('revision_conflict')
      if (entry.text === request.text) throw new LocalDomainError('invalid_input')
      const changedAt = this.now()
      entry.text = request.text
      entry.recordedAt = changedAt
      entry.revision += 1
      const message = draft.messages.find((item) => item.id === entry.messageId)
      if (message) message.revision += 1
      return {
        spaceRevision: nextRevision, entry,
        ...invalidateDependencies(draft, entry.id, '引用已修订', nextRevision, changedAt),
      }
    })
  }

  deleteEntry(spaceId: string, request: EntryChangeRequest): EntryChangeResult {
    const fingerprint = commandFingerprint('deleteEntry', request.entryId, request.expectedRevision)
    return this.repository.transact(spaceId, {
      clientOperationId: request.clientOperationId, fingerprint,
      expectedSpaceRevision: this.repository.read(spaceId).revision,
    }, (draft, nextRevision) => {
      const entry = entryById(draft, request.entryId)
      if (entry.revision !== request.expectedRevision) throw new LocalDomainError('revision_conflict')
      const deletedAt = this.now()
      const dependent = invalidateDependencies(draft, entry.id, '引用已删除', nextRevision, deletedAt)
      draft.entries = draft.entries.filter((item) => item.id !== entry.id)
      draft.messages = draft.messages.filter((message) => message.id !== entry.messageId)
      for (const question of draft.questions) {
        if (question.answeredByMessageId !== entry.messageId) continue
        question.answeredByMessageId = null
        if (question.status === 'ready') question.status = 'skipped'
        question.revision += 1
      }
      draft.tombstones.push(
        { entityId: entry.id, entityKind: 'entry', deletedAt, spaceRevision: nextRevision },
        { entityId: entry.messageId, entityKind: 'message', deletedAt, spaceRevision: nextRevision },
      )
      return { spaceRevision: nextRevision, entry: null, ...dependent }
    })
  }
}
