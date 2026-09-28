import { describe, expect, it } from 'vitest'
import {
  cadenceForDay, changeCadence, createInvitationState, isInvitationDue,
  markInvitationShown, pauseInvitations, resumeInvitations,
  settleInvitation, shareProactively,
} from './invitations'

describe('invitation cadence', () => {
  it('counts a shown round once and moves a second skipped daily round to weekly day 9', () => {
    let state = createInvitationState()
    expect(isInvitationDue(state, 1)).toBe(true)
    state = markInvitationShown(state, 1)
    state = markInvitationShown(state, 1)
    state = settleInvitation(state, 1, false)
    state = settleInvitation(state, 1, false)
    expect(state.unansweredStreak).toBe(1)
    expect(isInvitationDue(state, 2)).toBe(true)

    state = settleInvitation(markInvitationShown(state, 2), 2, false)
    expect(cadenceForDay(state, 2)).toBe('weekly')
    expect(state.unansweredStreak).toBe(0)
    expect(isInvitationDue(state, 8)).toBe(false)
    expect(isInvitationDue(state, 9)).toBe(true)
  })

  it('clears the streak when any question is answered or the user shares proactively', () => {
    let state = settleInvitation(markInvitationShown(createInvitationState(), 1), 1, false)
    state = settleInvitation(markInvitationShown(state, 2), 2, true)
    expect(state.unansweredStreak).toBe(0)
    state = settleInvitation(markInvitationShown(state, 3), 3, false)
    expect(state.unansweredStreak).toBe(1)
    state = shareProactively(state)
    expect(state.unansweredStreak).toBe(0)
    expect(cadenceForDay(state, 4)).toBe('daily')
  })

  it('ignores unshown, failed, paused, and jumped-over days, and resumes without backlog', () => {
    let state = createInvitationState()
    state = settleInvitation(state, 1, false)
    expect(state.unansweredStreak).toBe(0)
    state = pauseInvitations(markInvitationShown(state, 1))
    state = settleInvitation(state, 1, false)
    expect(state.unansweredStreak).toBe(0)
    expect(isInvitationDue(state, 2)).toBe(false)
    state = resumeInvitations(state, 10)
    expect(isInvitationDue(state, 10)).toBe(false)
    expect(isInvitationDue(state, 11)).toBe(true)
    state = settleInvitation(markInvitationShown(state, 11), 11, false)
    expect(state.unansweredStreak).toBe(1)
    expect(cadenceForDay(state, 11)).toBe('daily')
  })

  it('uses day 1 as the initial weekly anchor and never raises cadence automatically', () => {
    let state = changeCadence(createInvitationState(), 'weekly', 0)
    expect(isInvitationDue(state, 1)).toBe(true)
    expect(isInvitationDue(state, 2)).toBe(false)
    expect(isInvitationDue(state, 8)).toBe(true)
    state = settleInvitation(markInvitationShown(state, 1), 1, false)
    state = settleInvitation(markInvitationShown(state, 8), 8, false)
    expect(cadenceForDay(state, 8)).toBe('manual')
    expect(isInvitationDue(state, 15)).toBe(false)
    state = shareProactively(state)
    expect(cadenceForDay(state, 16)).toBe('manual')
  })

  it('applies a manual change the next day with a fresh anchor and no same-day extra invitation', () => {
    let state = settleInvitation(markInvitationShown(createInvitationState(), 1), 1, false)
    state = changeCadence(state, 'weekly', 1)
    expect(state.unansweredStreak).toBe(0)
    expect(isInvitationDue(state, 1)).toBe(false)
    expect(isInvitationDue(state, 2)).toBe(true)
    expect(isInvitationDue(state, 8)).toBe(false)
    expect(isInvitationDue(state, 9)).toBe(true)
  })

  it('materializes an effective no-invite choice before a later manual change replaces it', () => {
    let state = changeCadence(createInvitationState(), 'manual', 1)
    expect(isInvitationDue(state, 8)).toBe(false)
    state = changeCadence(state, 'daily', 8)
    expect(cadenceForDay(state, 8)).toBe('manual')
    expect(isInvitationDue(state, 8)).toBe(false)
    expect(isInvitationDue(state, 9)).toBe(true)
  })

  it('retires an open shown round on pause so resume cannot count its silence later', () => {
    let state = markInvitationShown(createInvitationState(), 1)
    state = pauseInvitations(state)
    state = resumeInvitations(state, 1)
    state = settleInvitation(state, 1, false)
    expect(state.unansweredStreak).toBe(0)
    expect(isInvitationDue(state, 1)).toBe(false)
    state = settleInvitation(markInvitationShown(state, 2), 2, false)
    expect(state.unansweredStreak).toBe(1)
    expect(cadenceForDay(state, 2)).toBe('daily')
  })

  it('keeps a weekly choice made during pause and anchors it after resume', () => {
    let state = pauseInvitations(createInvitationState())
    state = changeCadence(state, 'weekly', 1)
    state = resumeInvitations(state, 1)
    expect(cadenceForDay(state, 2)).toBe('weekly')
    expect(isInvitationDue(state, 2)).toBe(true)
    expect(isInvitationDue(state, 3)).toBe(false)
    expect(isInvitationDue(state, 9)).toBe(true)

    let longPause = pauseInvitations(createInvitationState())
    longPause = changeCadence(longPause, 'weekly', 1)
    longPause = resumeInvitations(longPause, 8)
    expect(isInvitationDue(longPause, 8)).toBe(false)
    expect(isInvitationDue(longPause, 9)).toBe(true)
    expect(isInvitationDue(longPause, 10)).toBe(false)
  })
})
