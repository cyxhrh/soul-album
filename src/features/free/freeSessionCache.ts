import type { BrowserLocalSessionState } from '../../domain/browserLocalSession'
import type { Cadence, InvitationState } from '../../domain/invitations'
import { isChatOpeningId, type ChatOpeningId } from '../../../shared/chatOpening'
import type { DailyMessage } from '../../../shared/dailyAlbum'
import { parseDailyRecord, serializeDailyRecord, type DailyRecord } from '../album/dailyRecord'
import { validChatRequest, type PrivateChatTurn } from './privateChat'
import { readSavedSession } from './sessionPersistence'

export interface SavedFreeSession {
  session: BrowserLocalSessionState
  openingId: ChatOpeningId
  openingDismissed: boolean
  chatTurns: PrivateChatTurn[]
  controlExchanges: { id: string; reply: string; promptQuestionId?: string }[]
  invitation: InvitationState
  day: number
  viewedDay: number
  questionIndex: number
  answeredInRound: boolean
  extraQuestion: boolean
  thirdUsed: boolean
  activeQuestionId: string | null
  draft: string
  choice: Cadence
  dailyRecords: Record<string, DailyRecord>
  dailySources: Record<string, DailyMessage[]>
}

function check(condition: unknown): asserts condition {
  if (!condition) throw new Error('invalid saved session')
}
function object(value: unknown): void { check(value !== null && typeof value === 'object' && !Array.isArray(value)) }
function string(value: unknown): void { check(typeof value === 'string') }
function nonempty(value: unknown): void { check(typeof value === 'string' && value.length > 0) }
function boolean(value: unknown): void { check(typeof value === 'boolean') }
function integer(value: unknown, minimum = 0): void { check(Number.isSafeInteger(value) && Number(value) >= minimum) }
function cadence(value: unknown): void { check(['daily', 'weekly', 'manual'].includes(value as string)) }
function calendarDate(value: string): void {
  string(value)
  check(/^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00Z`)))
  check(new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value)
}
function timestamp(value: unknown): void {
  check(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value))
  check(Number.isFinite(Date.parse(value)))
  calendarDate(value.slice(0, 10))
}
function messages(value: DailyMessage[]): void {
  check(Array.isArray(value))
  const ids = new Set<string>()
  for (const message of value) {
    object(message); nonempty(message.id); string(message.text); timestamp(message.recordedAt)
    check(['user', 'assistant', 'system'].includes(message.role))
    if (message.revised !== undefined) boolean(message.revised)
    check(!ids.has(message.id)); ids.add(message.id)
  }
}
function chatTurn(turn: PrivateChatTurn): void {
  object(turn); nonempty(turn.messageId); object(turn.request); object(turn.response)
  if (turn.precedingMessageId !== undefined) nonempty(turn.precedingMessageId)
  check(Array.isArray(turn.request.context))
  if (turn.request.precedingAssistant !== undefined) {
    object(turn.request.precedingAssistant); string(turn.request.precedingAssistant.reply)
    if (turn.request.precedingAssistant.nextQuestion !== null) string(turn.request.precedingAssistant.nextQuestion)
  }
  check(validChatRequest(turn.request))
  const response = turn.response
  check(response.status === 'generated'); nonempty(response.reply)
  check(response.reply === response.reply.trim() && Array.from(response.reply).length <= 280)
  if (response.nextQuestion !== null) {
    string(response.nextQuestion)
    check(Array.from(response.nextQuestion).length >= 6 && Array.from(response.nextQuestion).length <= 100 &&
      response.nextQuestion === response.nextQuestion.trim() && /[？?]$/.test(response.nextQuestion) &&
      (response.nextQuestion.match(/[？?]/g)?.length ?? 0) === 1 && !/[\r\n]/.test(response.nextQuestion))
  }
  object(response.model); check(response.model.provider === 'qwen'); nonempty(response.model.id)
  timestamp(response.generatedAt); check(Array.isArray(response.citations) && response.citations.length <= 3)
  const ids = new Set<string>()
  for (const citation of response.citations) {
    object(citation); nonempty(citation.id); nonempty(citation.quote)
    check(!ids.has(citation.id)); ids.add(citation.id)
    check([turn.request.turn, ...turn.request.context].some(source =>
      source.id === citation.id && source.quote.includes(citation.quote)))
  }
}

function validateSaved(value: unknown): asserts value is SavedFreeSession {
  object(value)
  const saved = value as SavedFreeSession
  object(saved.session); calendarDate(saved.session.dayOneDate); nonempty(saved.session.firstQuestionId)
  // Full snapshot identity/reference validation happens in BrowserLocalSession's restore constructor.
  object(saved.session.snapshot)
  nonempty(saved.session.snapshot.id); nonempty(saved.session.snapshot.timezone); integer(saved.session.snapshot.revision)
  for (const key of ['messages', 'entries', 'questions', 'observations', 'sourceGrants', 'tombstones'] as const) {
    check(Array.isArray(saved.session.snapshot[key]))
  }
  object(saved.session.snapshot.titles); object(saved.session.snapshot.invitations)
  check(isChatOpeningId(saved.openingId)); boolean(saved.openingDismissed)
  check(Array.isArray(saved.chatTurns)); saved.chatTurns.forEach(chatTurn)
  check(new Set(saved.chatTurns.map(turn => turn.messageId)).size === saved.chatTurns.length)
  check(Array.isArray(saved.controlExchanges))
  for (const exchange of saved.controlExchanges) {
    object(exchange); nonempty(exchange.id); string(exchange.reply)
    if (exchange.promptQuestionId !== undefined) nonempty(exchange.promptQuestionId)
  }
  object(saved.invitation)
  const invitation = saved.invitation
  cadence(invitation.cadence); integer(invitation.anchorDay, 1); integer(invitation.unansweredStreak); boolean(invitation.paused)
  for (const days of [invitation.shownDays, invitation.settledDays, invitation.cancelledDays]) {
    check(Array.isArray(days)); days.forEach(day => integer(day, 1)); check(new Set(days).size === days.length)
  }
  if (invitation.pendingChange !== null) {
    object(invitation.pendingChange); cadence(invitation.pendingChange.cadence); integer(invitation.pendingChange.effectiveDay, 1)
  }
  integer(saved.day, 1); integer(saved.viewedDay, 1); integer(saved.questionIndex)
  for (const day of [saved.day, saved.viewedDay]) {
    const date = new Date(Date.parse(`${saved.session.dayOneDate}T00:00:00Z`) + (day - 1) * 86_400_000)
    check(Number.isFinite(date.getTime()) && date.toISOString().length === 24)
  }
  boolean(saved.answeredInRound); boolean(saved.extraQuestion); boolean(saved.thirdUsed)
  if (saved.activeQuestionId !== null) {
    nonempty(saved.activeQuestionId)
    check(saved.session.snapshot.questions.some(question => question.id === saved.activeQuestionId))
  }
  string(saved.draft); cadence(saved.choice)
  object(saved.dailySources)
  for (const [date, sources] of Object.entries(saved.dailySources)) { calendarDate(date); messages(sources) }
  object(saved.dailyRecords)
  for (const [date, record] of Object.entries(saved.dailyRecords)) {
    calendarDate(date); object(record); check(record.date === date && record.version === 1)
    integer(record.revision); boolean(record.userEdited); string(record.title); string(record.diary)
    check(typeof record.sourceFingerprint === 'string' && /^[a-f0-9]{64}$/.test(record.sourceFingerprint))
    messages(record.messages)
    if (record.generatedAt !== undefined) timestamp(record.generatedAt)
    if (record.model !== undefined) { object(record.model); nonempty(record.model.provider); nonempty(record.model.id) }
    // The archive parser validates portrait structure and every observation's user-message evidence.
    parseDailyRecord(serializeDailyRecord(record), record)
  }
}

/** Never writes, repairs or clears corrupted private data. The component owns explicit recovery. */
export function loadFreeSession(): { saved: SavedFreeSession | null; error: string | null } {
  const loaded = readSavedSession<unknown>()
  if (loaded.error || loaded.value === null) return { saved: null, error: loaded.error }
  try {
    validateSaved(loaded.value)
    return { saved: loaded.value, error: null }
  } catch {
    return { saved: null, error: '本机记录内容不完整或已损坏，暂未恢复；原缓存已保留，请先备份或明确清除后重新开始。' }
  }
}
