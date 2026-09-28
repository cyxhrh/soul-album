/** Scheduling facts are deliberately separate from the journal and never used as mood evidence. */
export type Cadence = 'daily' | 'weekly' | 'manual'

export interface InvitationState {
  cadence: Cadence
  anchorDay: number
  unansweredStreak: number
  paused: boolean
  shownDays: number[]
  settledDays: number[]
  cancelledDays: number[]
  pendingChange: { cadence: Cadence; effectiveDay: number } | null
}

export function createInvitationState(): InvitationState {
  return {
    cadence: 'daily', anchorDay: 1, unansweredStreak: 0, paused: false,
    shownDays: [], settledDays: [], cancelledDays: [], pendingChange: null,
  }
}

export function cadenceForDay(state: InvitationState, day: number): Cadence {
  return state.pendingChange && day >= state.pendingChange.effectiveDay
    ? state.pendingChange.cadence : state.cadence
}

function anchorForDay(state: InvitationState, day: number): number {
  return state.pendingChange && day >= state.pendingChange.effectiveDay
    ? state.pendingChange.effectiveDay : state.anchorDay
}

/** A no-invite cadence can take effect without markInvitationShown ever being called. */
function materializeEffectiveChange(state: InvitationState, day: number): InvitationState {
  const pending = state.pendingChange
  if (!pending || day < pending.effectiveDay) return state
  return { ...state, cadence: pending.cadence, anchorDay: pending.effectiveDay, pendingChange: null }
}

export function isInvitationDue(state: InvitationState, day: number): boolean {
  if (state.paused || !Number.isInteger(day) || day < 1 ||
    state.settledDays.includes(day) || state.cancelledDays.includes(day) ||
    state.shownDays.some((shownDay) => shownDay > day)) return false
  const anchor = anchorForDay(state, day)
  if (day < anchor) return false
  const cadence = cadenceForDay(state, day)
  return cadence === 'daily' || (cadence === 'weekly' && (day - anchor) % 7 === 0)
}

/** A due date becomes countable only after the invitation actually appeared. */
export function markInvitationShown(state: InvitationState, day: number): InvitationState {
  if (!isInvitationDue(state, day) || state.shownDays.includes(day)) return state
  const active = materializeEffectiveChange(state, day)
  return {
    ...active,
    shownDays: [...state.shownDays, day],
  }
}

/** The UI calls this once for a whole round, whether it had one or two questions. */
export function settleInvitation(state: InvitationState, day: number, answered: boolean): InvitationState {
  if (state.paused || !state.shownDays.includes(day) || state.settledDays.includes(day) ||
    state.cancelledDays.includes(day) ||
    state.shownDays.some((shownDay) => shownDay > day)) return state
  const settledDays = [...state.settledDays, day]
  if (answered) return { ...state, settledDays, unansweredStreak: 0 }
  const streak = state.unansweredStreak + 1
  if (streak < 2) return { ...state, settledDays, unansweredStreak: streak }
  const cadence = state.cadence === 'daily' ? 'weekly' : 'manual'
  return { ...state, cadence, anchorDay: day, unansweredStreak: 0, settledDays, pendingChange: null }
}

/** A manual preference is effective on the next day, with that day as its anchor. */
export function changeCadence(state: InvitationState, next: Cadence, day: number): InvitationState {
  const active = materializeEffectiveChange(state, day)
  return {
    ...active, unansweredStreak: 0,
    pendingChange: { cadence: next, effectiveDay: day + 1 },
  }
}

export function shareProactively(state: InvitationState): InvitationState {
  return state.unansweredStreak === 0 ? state : { ...state, unansweredStreak: 0 }
}

export function pauseInvitations(state: InvitationState): InvitationState {
  const newlyCancelled = state.shownDays.filter((day) =>
    !state.settledDays.includes(day) && !state.cancelledDays.includes(day))
  return {
    ...state, paused: true, unansweredStreak: 0,
    cancelledDays: [...state.cancelledDays, ...newlyCancelled],
  }
}

/** Resume schedules anew tomorrow; paused dates never create a backlog. */
export function resumeInvitations(state: InvitationState, day: number): InvitationState {
  if (!state.paused) return state
  const active = materializeEffectiveChange(state, day)
  return {
    ...active, paused: false, anchorDay: day + 1, unansweredStreak: 0,
  }
}
