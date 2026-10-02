import { journalDate, type SpaceSnapshot } from '../../../backend/local/index'
import { chatOpenings, type ChatOpeningId } from '../../../shared/chatOpening'
import type { DailyMessage } from '../../../shared/dailyAlbum'
import { currentChatTurns, type PrivateChatTurn } from '../free/privateChat'
import { createDailyRecord, fingerprintMessages, type DailyRecord } from './dailyRecord'

/** Build archive data from complete stored text, never the 800-character chat request excerpt. */
export function collectDailyMessages(
  snapshot: SpaceSnapshot,
  turns: PrivateChatTurn[],
  date: string,
  openingId: ChatOpeningId,
  firstQuestionId: string,
  controls: { id: string; reply: string }[],
): DailyMessage[] {
  const messages: DailyMessage[] = []
  const entries = new Map(snapshot.entries.map(entry => [entry.id, entry]))
  const questions = new Map(snapshot.questions.map(question => [question.id, question]))
  const replies = new Map(currentChatTurns(snapshot, turns).map(turn => [turn.messageId, turn.response]))
  const localReplies = new Map(controls.map(control => [control.id, control.reply]))
  const includedQuestions = new Set<string>()
  const onDate = (timestamp: string) => journalDate(timestamp, snapshot.timezone) === date

  function addQuestion(id: string): void {
    if (includedQuestions.has(id)) return
    const question = questions.get(id)
    if (!question || !onDate(question.displayedAt) ||
      question.status === 'citation_deleted' || question.status === 'citation_revised') return
    includedQuestions.add(id)
    const opening = chatOpenings[openingId]
    messages.push({
      id: `question-${id}`, role: 'system', recordedAt: question.displayedAt,
      text: id === firstQuestionId ? `${opening.greeting}\n\n${opening.question}` : question.text,
    })
  }

  addQuestion(firstQuestionId)
  for (const message of [...snapshot.messages].sort((a, b) => a.sequence - b.sequence)) {
    if (!onDate(message.occurredAt)) continue
    const entry = message.entryId ? entries.get(message.entryId) : undefined
    const text = message.entryId ? entry?.text : message.controlText
    if (typeof text !== 'string') continue
    if (message.replyToQuestionId) addQuestion(message.replyToQuestionId)
    messages.push({
      id: `user-${message.id}`, role: 'user', text, recordedAt: message.recordedAt,
      ...((entry?.revision ?? message.revision) > 1 ? { revised: true } : {}),
    })
    const localReply = localReplies.get(message.id)
    if (!message.entryId && localReply) messages.push({
      id: `local-${message.id}`, role: 'system', text: localReply, recordedAt: message.recordedAt,
    })
    const reply = replies.get(message.id)
    if (reply) messages.push({
      id: `assistant-${message.id}`, role: 'assistant', recordedAt: reply.generatedAt,
      text: reply.nextQuestion === null ? reply.reply : `${reply.reply}\n\n${reply.nextQuestion}`,
    })
  }

  // User corrections are independent user evidence, provided their cited sources still exist.
  for (const correction of snapshot.observations) {
    if (correction.status !== 'user_corrected' || correction.provenance !== 'user_correction' ||
      correction.citations.length === 0 || !correction.citations.every(citation => entries.get(citation.id)?.revision === citation.revision)) continue
    const source = entries.get(correction.citations[0].id)!
    const correctionDate = correction.journalDate ??
      (correction.recordedAt ? journalDate(correction.recordedAt, snapshot.timezone) : source.journalDate)
    if (correctionDate !== date) continue
    messages.push({
      id: `correction-${correction.id}`, role: 'user', text: correction.text,
      recordedAt: correction.recordedAt ?? source.recordedAt, revised: true,
    })
  }
  return messages
}

export function collectDailySources(
  snapshot: SpaceSnapshot, turns: PrivateChatTurn[], openingId: ChatOpeningId,
  firstQuestionId: string, controls: { id: string; reply: string }[],
): Record<string, DailyMessage[]> {
  const dates = new Set([
    ...snapshot.messages.map(message => journalDate(message.occurredAt, snapshot.timezone)),
    ...snapshot.observations.flatMap(observation => observation.journalDate ? [observation.journalDate] : []),
  ])
  return Object.fromEntries([...dates].map(date => [date,
    collectDailyMessages(snapshot, turns, date, openingId, firstQuestionId, controls)] as const)
    .filter(([, messages]) => messages.some(message => message.role === 'user')))
}

/** Sync original sources separately from the user's editable archive copy. */
export function syncDailyRecord(
  record: DailyRecord | undefined,
  previousSources: DailyMessage[] | undefined,
  incoming: DailyMessage[],
  date: string,
): DailyRecord {
  if (!record || record.date !== date) return createDailyRecord(date, incoming)
  const sourceFingerprint = fingerprintMessages(incoming)
  if (record.sourceFingerprint === sourceFingerprint) return record

  // An absent/stale baseline cannot establish that a deletion or revision did not happen.
  if (!previousSources || fingerprintMessages(previousSources) !== record.sourceFingerprint ||
    new Set(incoming.map(message => message.id)).size !== incoming.length) return createDailyRecord(date, incoming)
  const previous = new Map(previousSources.map(message => [message.id, message]))
  const incomingIds = new Set(incoming.map(message => message.id))
  const userDeleted = previousSources.some(message => message.role === 'user' && !incomingIds.has(message.id))
  const preserveFront = record.userEdited && !userDeleted

  const priorMessages = new Map(record.messages.map(message => [message.id, message]))
  const next: DailyRecord = {
    ...record, sourceFingerprint, revision: record.revision + 1,
    title: preserveFront ? record.title : '今天留下的事',
    diary: preserveFront ? record.diary : '',
    portrait: { facts: [], feelings: [], observations: [], uncertainties: [] },
    messages: incoming.map(message => {
      const prior = priorMessages.get(message.id)
      const source = previous.get(message.id)
      return prior?.revised && source && fingerprintMessages([source]) === fingerprintMessages([message])
        ? { ...message, text: prior.text, revised: true }
        : { ...message }
    }),
  }
  delete next.generatedAt
  delete next.model
  next.userEdited = preserveFront || next.messages.some(message => message.revised)
  return next
}
