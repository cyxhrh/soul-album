import {
  InMemorySpaceRepository, LocalJournalService, journalDate,
  type CitationRef, type DayPage, type JournalEntry, type MessageView,
  type Question, type SpaceSnapshot,
} from '../../backend/local/index.js'
import type { JournalState, QuestionRecord } from './journal'

type Clock = () => Date

export interface BrowserLocalSessionOptions {
  dayOneDate?: string
  timezone?: string
  now?: Clock
}

function uuid(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

function zonedParts(value: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(value)
  const field = (kind: string) => Number(parts.find((part) => part.type === kind)?.value)
  return {
    year: field('year'), month: field('month'), day: field('day'),
    hour: field('hour'), minute: field('minute'), second: field('second'),
  }
}

function calendarDate(value: Date, timezone: string): string {
  const parts = zonedParts(value, timezone)
  return `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`
}

function timezoneOffsetMinutes(value: Date, timezone: string): number {
  const parts = zonedParts(value, timezone)
  const localAsUtc = Date.UTC(parts.year, parts.month - 1, parts.day,
    parts.hour, parts.minute, parts.second)
  return Math.round((localAsUtc - Math.floor(value.getTime() / 1000) * 1000) / 60_000)
}

function wallTimestamp(date: string, clock: Date, timezone: string): string {
  const [year, month, day] = date.split('-').map(Number)
  const time = zonedParts(clock, timezone)
  const desiredWall = Date.UTC(year, month - 1, day, time.hour, time.minute, time.second)
  let instant = desiredWall
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const next = desiredWall - timezoneOffsetMinutes(new Date(instant), timezone) * 60_000
    if (next === instant) break
    instant = next
  }
  return new Date(instant).toISOString()
}

function localIso(value: string, timezone: string): string {
  const instant = new Date(value)
  const parts = zonedParts(instant, timezone)
  const offset = timezoneOffsetMinutes(instant, timezone)
  const sign = offset >= 0 ? '+' : '-'
  const hours = String(Math.floor(Math.abs(offset) / 60)).padStart(2, '0')
  const minutes = String(Math.abs(offset) % 60).padStart(2, '0')
  const two = (number: number) => String(number).padStart(2, '0')
  return `${parts.year}-${two(parts.month)}-${two(parts.day)}T${two(parts.hour)}:${two(parts.minute)}:${two(parts.second)}${sign}${hours}:${minutes}`
}

/** One page-memory space for the default web demo. It never writes browser storage or makes requests. */
export class BrowserLocalSession {
  readonly timezone: string
  readonly dayOneDate: string
  readonly firstQuestionId: string
  private readonly now: Clock
  private readonly spaceId: string
  private readonly repository: InMemorySpaceRepository
  private readonly journal: LocalJournalService

  constructor(options: BrowserLocalSessionOptions = {}) {
    this.now = options.now ?? (() => new Date())
    this.timezone = options.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone
    this.dayOneDate = options.dayOneDate ?? calendarDate(this.now(), this.timezone)
    this.spaceId = uuid()
    this.repository = new InMemorySpaceRepository({
      now: () => this.now().toISOString(), newId: uuid,
    })
    this.repository.createSpace(this.spaceId, this.timezone)
    this.journal = new LocalJournalService(this.repository, {
      now: () => this.now().toISOString(), newId: uuid,
    })
    this.firstQuestionId = this.displayQuestion(1, 'open', []).id
  }

  read(): SpaceSnapshot {
    return this.repository.read(this.spaceId)
  }

  dateForDay(day: number): string {
    if (!Number.isInteger(day) || day < 1) throw new RangeError('invalid demonstration day')
    const [year, month, date] = this.dayOneDate.split('-').map(Number)
    return new Date(Date.UTC(year, month - 1, date + day - 1)).toISOString().slice(0, 10)
  }

  dayForDate(date: string): number {
    return Math.round((Date.parse(`${date}T00:00:00Z`) -
      Date.parse(`${this.dayOneDate}T00:00:00Z`)) / 86_400_000) + 1
  }

  dayForTimestamp(timestamp: string): number {
    return this.dayForDate(journalDate(timestamp, this.timezone))
  }

  listDays(): number[] {
    return this.journal.listDays(this.spaceId).dates.map((date) => this.dayForDate(date))
  }

  getDay(day: number): DayPage | null {
    return this.journal.getDay(this.spaceId, this.dateForDay(day))
  }

  displayQuestion(day: number, kind: 'open' | 'moment' | 'reflection', citations: CitationRef[]): Question {
    return this.journal.displayQuestion(this.spaceId, {
      clientOperationId: uuid(), expectedSpaceRevision: this.read().revision,
      kind, citations, displayedAt: wallTimestamp(this.dateForDay(day), this.now(), this.timezone),
    })
  }

  displayNextQuestion(day: number, moment = false): Question {
    if (moment) return this.displayQuestion(day, 'moment', [])
    const entry = [...this.read().entries].reverse().find((item) =>
      this.dayForDate(item.journalDate) <= day)
    return entry
      ? this.displayQuestion(day, 'reflection', [{ kind: 'entry', id: entry.id, revision: entry.revision }])
      : this.displayQuestion(day, 'open', [])
  }

  sendMessage(day: number, text: string, visibleQuestionId?: string | null) {
    return this.journal.sendMessage(this.spaceId, {
      clientOperationId: uuid(), expectedSpaceRevision: this.read().revision,
      text, occurredAt: wallTimestamp(this.dateForDay(day), this.now(), this.timezone),
      timezone: this.timezone, visibleQuestionId: visibleQuestionId ?? null,
    })
  }

  setDayTitle(day: number, text: string): void {
    const snapshot = this.read()
    this.journal.setDayTitle(this.spaceId, {
      clientOperationId: uuid(), date: this.dateForDay(day), text,
      expectedRevision: snapshot.titles[this.dateForDay(day)]?.revision ?? 0,
      expectedSpaceRevision: snapshot.revision,
    })
  }

  editEntry(id: string, text: string): void {
    const entry = this.read().entries.find((item) => item.id === id)
    if (!entry) throw new Error('entry no longer exists')
    this.journal.editEntry(this.spaceId, {
      clientOperationId: uuid(), entryId: id, expectedRevision: entry.revision, text,
    })
  }

  deleteEntry(id: string): void {
    const entry = this.read().entries.find((item) => item.id === id)
    if (!entry) throw new Error('entry no longer exists')
    this.journal.deleteEntry(this.spaceId, {
      clientOperationId: uuid(), entryId: id, expectedRevision: entry.revision,
    })
  }

  /** A read-only compatibility projection for the existing album and comparison selectors. */
  projectJournal(snapshot: SpaceSnapshot): JournalState {
    const messageById = new Map(snapshot.messages.map((message) => [message.id, message]))
    const entries = snapshot.entries.map((entry) => {
      const day = this.dayForDate(entry.journalDate)
      const kind = messageById.get(entry.messageId)?.interpretation.kind
      return {
        id: entry.id, day, topicId: kind === 'answer' ? 'daily-note' : `proactive-day-${day}`,
        text: entry.text, occurredAt: localIso(entry.occurredAt, this.timezone),
        recordedAt: localIso(entry.recordedAt, this.timezone), source: '本次页面对话',
        revision: entry.revision, revisions: [],
      }
    })
    const questions: Record<number, QuestionRecord[]> = {}
    for (const question of snapshot.questions) {
      const message = snapshot.messages.find((item) => item.id === question.answeredByMessageId)
      if (!message?.entryId || !snapshot.entries.some((entry) => entry.id === message.entryId)) continue
      const day = this.dayForDate(journalDate(question.displayedAt, this.timezone))
      const citationEntry = question.citations.find((item) => item.kind === 'entry')
      const citationObservation = question.citations.find((item) => item.kind === 'observation')
      questions[day] ??= []
      questions[day].push({
        day, text: question.text, answerEntryId: message.entryId,
        citationEntryId: citationEntry?.id, citationEntryRevision: citationEntry?.revision,
        citationObservationId: citationObservation?.id,
        citationObservationRevision: citationObservation?.revision,
        dependencyEntryIds: question.citations.filter((item) => item.kind === 'entry').map((item) => item.id),
        referenceDeleted: question.status === 'citation_deleted',
      })
    }
    const titles: JournalState['titles'] = {}
    for (const [date, title] of Object.entries(snapshot.titles)) {
      titles[this.dayForDate(date)] = {
        title: title.text, revision: title.revision, recordedAt: '', revisions: [],
        dependencyEntryIds: title.dependencyEntryIds,
      }
    }
    return {
      spaceId: snapshot.id, entries, titles, questions, observations: [],
      sourceConsents: {}, sourceFacts: [],
    }
  }

  projectMessages(snapshot: SpaceSnapshot): MessageView[] {
    const entryById = new Map<string, JournalEntry>(snapshot.entries.map((entry) => [entry.id, entry]))
    return snapshot.messages.map((message) => {
      const text = message.entryId ? entryById.get(message.entryId)?.text : message.controlText
      if (text === undefined || text === null) throw new Error('message has no current text')
      return {
        id: message.id, clientOperationId: message.clientOperationId,
        sequence: message.sequence, occurredAt: message.occurredAt,
        recordedAt: message.recordedAt, revision: message.revision,
        interpretation: message.interpretation, replyToQuestionId: message.replyToQuestionId,
        invitationId: message.invitationId, entryId: message.entryId,
        controlEvent: message.controlEvent, text,
      }
    }).sort((first, second) => first.sequence - second.sequence)
  }
}

export function createBrowserLocalSession(options?: BrowserLocalSessionOptions): BrowserLocalSession {
  return new BrowserLocalSession(options)
}
