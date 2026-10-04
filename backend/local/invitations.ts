import { LocalDomainError } from './errors.js'
import type { Cadence, CadenceChangeEvent, InvitationState } from './types.js'

function assertCalendarDate(date: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new LocalDomainError('invalid_input')
  const parsed = new Date(`${date}T00:00:00.000Z`)
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
    throw new LocalDomainError('invalid_input')
  }
}

function addCalendarDays(date: string, days: number): string {
  assertCalendarDate(date)
  const value = new Date(`${date}T00:00:00.000Z`)
  value.setUTCDate(value.getUTCDate() + days)
  return value.toISOString().slice(0, 10)
}

function dayDistance(first: string, second: string): number {
  return (Date.parse(`${second}T00:00:00.000Z`) - Date.parse(`${first}T00:00:00.000Z`)) / 86_400_000
}

function effectiveCadence(state: InvitationState, date: string): { cadence: Cadence; anchor: string } {
  const pending = state.pendingChange
  return pending && date >= pending.effectiveDate
    ? { cadence: pending.nextCadence, anchor: pending.anchorDate }
    : { cadence: state.cadence, anchor: state.cadenceAnchorDate }
}

function applyPending(state: InvitationState, date: string): InvitationState {
  const pending = state.pendingChange
  return pending && date >= pending.effectiveDate
    ? { ...state, cadence: pending.nextCadence, cadenceAnchorDate: pending.anchorDate, pendingChange: null }
    : state
}

function hasNewerShownRound(state: InvitationState, date: string): boolean {
  return state.invitations.some((item) => item.date > date &&
    ['shown', 'settled_answered', 'settled_unanswered'].includes(item.state))
}

export function createInvitationState(anchorDate: string): InvitationState {
  assertCalendarDate(anchorDate)
  return {
    cadence: 'daily', cadenceAnchorDate: anchorDate, paused: false,
    unansweredShownRounds: 0, pendingChange: null, changeEvents: [], invitations: [],
  }
}

export function isInvitationDue(state: InvitationState, date: string): boolean {
  assertCalendarDate(date)
  if (state.paused || state.invitations.some((item) => item.date >= date)) return false
  const { cadence, anchor } = effectiveCadence(state, date)
  if (date < anchor) return false
  return cadence === 'daily' || (cadence === 'weekly' && dayDistance(anchor, date) % 7 === 0)
}

export function scheduleInvitation(state: InvitationState, id: string, date: string): InvitationState {
  if (!isInvitationDue(state, date) || state.invitations.some((item) => item.id === id)) return state
  const active = applyPending(state, date)
  const questionTarget = active.cadence === 'weekly' ? 1 : 2
  return {
    ...active,
    invitations: [...active.invitations, { id, date, state: 'scheduled', revision: 1, questionTarget }],
  }
}

export function markInvitationShown(state: InvitationState, id: string, shownAt: string): InvitationState {
  if (state.paused) return state
  const invitation = state.invitations.find((item) => item.id === id)
  if (!invitation || !['scheduled', 'delivered'].includes(invitation.state) ||
    state.invitations.some((item) => item.id !== id && item.state === 'shown') ||
    hasNewerShownRound(state, invitation.date)) return state
  const active = applyPending(state, invitation.date)
  return {
    ...active,
    invitations: active.invitations.map((item) => item.id === id
      ? { ...item, state: 'shown', shownAt, revision: item.revision + 1 } as const : item),
  }
}

export function settleInvitation(
  state: InvitationState, id: string, answered: boolean, settledAt: string, eventId: string,
): InvitationState {
  if (state.paused) return state
  const invitation = state.invitations.find((item) => item.id === id)
  if (!invitation || invitation.state !== 'shown' || hasNewerShownRound(state, invitation.date)) return state
  const active = applyPending(state, invitation.date)
  const invitations = active.invitations.map((item) => item.id === id ? {
    ...item, state: answered ? 'settled_answered' : 'settled_unanswered',
    settledAt, revision: item.revision + 1,
  } as const : item)
  if (answered) return { ...active, invitations, unansweredShownRounds: 0 }
  if (active.unansweredShownRounds === 0) {
    return { ...active, invitations, unansweredShownRounds: 1 }
  }
  const nextCadence: Cadence = active.cadence === 'daily' ? 'weekly' : 'manual'
  const priorUnanswered = [...active.invitations].reverse().find((item) => item.state === 'settled_unanswered')
  const change: CadenceChangeEvent = {
    id: eventId, reason: 'two_shown_rounds_unanswered',
    previousCadence: active.cadence, nextCadence, decidedAt: settledAt,
    effectiveDate: addCalendarDays(invitation.date, 1), anchorDate: invitation.date,
    triggeringInvitationIds: priorUnanswered ? [priorUnanswered.id, id] : [id],
  }
  return {
    ...active, invitations, unansweredShownRounds: 0,
    pendingChange: change, changeEvents: [...active.changeEvents, change],
  }
}

function unansweredTail(state: InvitationState): string[] {
  const settled = state.invitations
    .filter((item) => ['settled_answered', 'settled_unanswered'].includes(item.state))
    .sort((first, second) => first.date.localeCompare(second.date))
  let afterIndex = -1
  for (const event of state.changeEvents) {
    if (event.reason === 'two_shown_rounds_unanswered' &&
      event.retractionDisposition !== 'cancelled_pending') {
      for (const id of event.triggeringInvitationIds) {
        afterIndex = Math.max(afterIndex, settled.findIndex((item) => item.id === id))
      }
    } else if (['manual_choice', 'pause', 'resume'].includes(event.reason)) {
      const decidedAt = Date.parse(event.decidedAt)
      for (let index = 0; index < settled.length; index += 1) {
        const settledAt = Date.parse(settled[index].settledAt ?? '')
        if (Number.isFinite(settledAt) && settledAt <= decidedAt) {
          afterIndex = Math.max(afterIndex, index)
        }
      }
    }
  }
  const tail: string[] = []
  for (let index = settled.length - 1; index > afterIndex; index -= 1) {
    if (settled[index].state === 'settled_answered') break
    tail.unshift(settled[index].id)
  }
  return tail
}

/** Reconcile a settled round after the user corrects its effective response. */
export function correctSettledInvitation(
  state: InvitationState, invitationId: string, answered: boolean,
  correctedAt: string, correctedDate: string, correctionEventId: string, downgradeEventId: string,
): InvitationState {
  const invitation = state.invitations.find((item) => item.id === invitationId)
  if (!invitation || !['settled_answered', 'settled_unanswered'].includes(invitation.state)) return state
  if (invitation.state === (answered ? 'settled_answered' : 'settled_unanswered')) return state
  assertCalendarDate(correctedDate)
  const active = applyPending(state, correctedDate)
  const changeEvents = active.changeEvents.map((event) =>
    event.reason === 'two_shown_rounds_unanswered' &&
    event.triggeringInvitationIds.includes(invitationId) && !event.retractedAt
      ? {
          ...event, retractedAt: correctedAt,
          retractionDisposition: event.effectiveDate > correctedDate
            ? 'cancelled_pending' as const : 'annotated_effective' as const,
        } : event)
  const pending = active.pendingChange
  const retractPending = pending?.reason === 'two_shown_rounds_unanswered' &&
    pending.triggeringInvitationIds.includes(invitationId)
  const correction: CadenceChangeEvent = {
    id: correctionEventId, reason: 'response_correction',
    previousCadence: active.cadence, nextCadence: active.cadence,
    decidedAt: correctedAt, effectiveDate: correctedDate,
    anchorDate: active.cadenceAnchorDate, triggeringInvitationIds: [invitationId],
  }
  const corrected: InvitationState = {
    ...active,
    invitations: active.invitations.map((item) => item.id === invitationId ? {
      ...item, state: answered ? 'settled_answered' : 'settled_unanswered',
      revision: item.revision + 1,
    } as const : item),
    pendingChange: retractPending ? null : pending,
    changeEvents: [...changeEvents, correction],
  }
  const tail = unansweredTail(corrected)
  if (tail.length < 2 || corrected.cadence === 'manual') {
    return { ...corrected, unansweredShownRounds: Math.min(tail.length, 1) }
  }
  const change: CadenceChangeEvent = {
    id: downgradeEventId, reason: 'two_shown_rounds_unanswered',
    previousCadence: corrected.cadence,
    nextCadence: corrected.cadence === 'daily' ? 'weekly' : 'manual',
    decidedAt: correctedAt, effectiveDate: addCalendarDays(correctedDate, 1),
    anchorDate: correctedDate, triggeringInvitationIds: tail.slice(-2),
  }
  return {
    ...corrected, unansweredShownRounds: 0,
    pendingChange: change, changeEvents: [...corrected.changeEvents, change],
  }
}

export function setCadence(
  state: InvitationState, next: Cadence, today: string, decidedAt: string, eventId: string,
): InvitationState {
  assertCalendarDate(today)
  const active = applyPending(state, today)
  if (active.cadence === next && active.pendingChange === null) return active
  const effectiveDate = addCalendarDays(today, 1)
  const change: CadenceChangeEvent = {
    id: eventId, reason: 'manual_choice', previousCadence: active.cadence,
    nextCadence: next, decidedAt, effectiveDate, anchorDate: effectiveDate,
    triggeringInvitationIds: [],
  }
  return {
    ...active, unansweredShownRounds: 0, pendingChange: change,
    changeEvents: [...active.changeEvents, change],
  }
}

export function pauseInvitations(
  state: InvitationState, today: string, decidedAt: string, eventId: string,
): InvitationState {
  if (state.paused) return state
  const active = applyPending(state, today)
  const change: CadenceChangeEvent = {
    id: eventId, reason: 'pause', previousCadence: active.cadence,
    nextCadence: active.cadence, decidedAt, effectiveDate: today,
    anchorDate: active.cadenceAnchorDate, triggeringInvitationIds: [],
  }
  return {
    ...active, paused: true, unansweredShownRounds: 0,
    invitations: active.invitations.map((item) =>
      ['scheduled', 'delivered', 'shown'].includes(item.state)
        ? { ...item, state: 'cancelled', revision: item.revision + 1 } as const : item),
    changeEvents: [...active.changeEvents, change],
  }
}

export function resumeInvitations(
  state: InvitationState, today: string, decidedAt: string, eventId: string,
): InvitationState {
  if (!state.paused) return state
  const active = applyPending(state, today)
  const effectiveDate = addCalendarDays(today, 1)
  const resumedCadence = active.pendingChange?.nextCadence ?? active.cadence
  const change: CadenceChangeEvent = {
    id: eventId, reason: 'resume', previousCadence: active.cadence,
    nextCadence: resumedCadence, decidedAt, effectiveDate,
    anchorDate: effectiveDate, triggeringInvitationIds: [],
  }
  return {
    ...active, paused: false, unansweredShownRounds: 0,
    cadenceAnchorDate: effectiveDate, pendingChange: change,
    changeEvents: [...active.changeEvents, change],
  }
}
