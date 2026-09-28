import { describe, expect, it } from 'vitest'
import {
  correctSettledInvitation, createInvitationState, isInvitationDue, markInvitationShown,
  pauseInvitations, resumeInvitations, scheduleInvitation, setCadence, settleInvitation,
} from './invitations.js'

function twiceUnanswered() {
  let state = createInvitationState('2026-09-29')
  for (const [id, date] of [['invite-1', '2026-09-29'], ['invite-2', '2026-09-30']]) {
    state = scheduleInvitation(state, id, date)
    state = markInvitationShown(state, id, `${date}T09:00:00+08:00`)
    state = settleInvitation(state, id, false, `${date}T20:00:00+08:00`, `auto-${id}`)
  }
  return state
}

describe('local invitation policy', () => {
  it('downgrades only after two shown, settled, unanswered rounds', () => {
    let state = createInvitationState('2026-09-29')
    state = scheduleInvitation(state, 'invite-1', '2026-09-29')
    state = markInvitationShown(state, 'invite-1', '2026-09-29T09:00:00+08:00')
    state = settleInvitation(state, 'invite-1', false, '2026-09-29T20:00:00+08:00', 'change-1')
    expect(state.unansweredShownRounds).toBe(1)
    expect(state.changeEvents).toEqual([])

    state = scheduleInvitation(state, 'invite-2', '2026-09-30')
    state = markInvitationShown(state, 'invite-2', '2026-09-30T09:00:00+08:00')
    state = settleInvitation(state, 'invite-2', false, '2026-09-30T20:00:00+08:00', 'change-2')

    expect(state.unansweredShownRounds).toBe(0)
    expect(state.pendingChange).toMatchObject({
      id: 'change-2', reason: 'two_shown_rounds_unanswered',
      previousCadence: 'daily', nextCadence: 'weekly',
      effectiveDate: '2026-10-01', anchorDate: '2026-09-30',
      triggeringInvitationIds: ['invite-1', 'invite-2'],
    })
    expect(isInvitationDue(state, '2026-10-01')).toBe(false)
    expect(isInvitationDue(state, '2026-10-07')).toBe(true)
  })

  it('does not count unshown rounds, duplicate settlement, or an answer toward the unanswered streak', () => {
    let state = scheduleInvitation(createInvitationState('2026-09-29'), 'invite-1', '2026-09-29')
    expect(settleInvitation(state, 'invite-1', false, '2026-09-29T20:00:00+08:00', 'change-1')).toBe(state)
    state = markInvitationShown(state, 'invite-1', '2026-09-29T09:00:00+08:00')
    state = settleInvitation(state, 'invite-1', false, '2026-09-29T20:00:00+08:00', 'change-1')
    expect(settleInvitation(state, 'invite-1', false, '2026-09-29T21:00:00+08:00', 'change-2')).toBe(state)
    state = scheduleInvitation(state, 'invite-2', '2026-09-30')
    state = markInvitationShown(state, 'invite-2', '2026-09-30T09:00:00+08:00')
    state = settleInvitation(state, 'invite-2', true, '2026-09-30T20:00:00+08:00', 'change-2')
    expect(state.unansweredShownRounds).toBe(0)
    expect(state.changeEvents).toEqual([])
  })

  it('applies a manual cadence change next day and records the visible decision', () => {
    const state = setCadence(
      createInvitationState('2026-09-29'), 'weekly', '2026-09-29',
      '2026-09-29T18:00:00+08:00', 'manual-1',
    )
    expect(state.cadence).toBe('daily')
    expect(state.pendingChange).toMatchObject({
      id: 'manual-1', reason: 'manual_choice', previousCadence: 'daily',
      nextCadence: 'weekly', effectiveDate: '2026-09-30', anchorDate: '2026-09-30',
      triggeringInvitationIds: [],
    })
    expect(state.changeEvents).toHaveLength(1)
    expect(isInvitationDue(state, '2026-09-30')).toBe(true)
    expect(isInvitationDue(state, '2026-10-01')).toBe(false)
  })

  it('downgrades weekly to manual after two shown unanswered weeks, never automatically promotes', () => {
    let state = createInvitationState('2026-09-29')
    state = setCadence(state, 'weekly', '2026-09-29', '2026-09-29T12:00:00+08:00', 'manual-1')
    for (const [id, date] of [['invite-1', '2026-09-30'], ['invite-2', '2026-10-07']]) {
      state = scheduleInvitation(state, id, date)
      state = markInvitationShown(state, id, `${date}T09:00:00+08:00`)
      state = settleInvitation(state, id, false, `${date}T20:00:00+08:00`, `change-${id}`)
    }
    expect(state.pendingChange).toMatchObject({
      previousCadence: 'weekly', nextCadence: 'manual', effectiveDate: '2026-10-08',
      triggeringInvitationIds: ['invite-1', 'invite-2'],
    })
    expect(isInvitationDue(state, '2026-10-14')).toBe(false)
  })

  it('cancels a shown invitation on pause and resumes tomorrow without backlog', () => {
    let state = scheduleInvitation(createInvitationState('2026-09-29'), 'invite-1', '2026-09-29')
    state = markInvitationShown(state, 'invite-1', '2026-09-29T09:00:00+08:00')
    state = pauseInvitations(state, '2026-09-29', '2026-09-29T12:00:00+08:00', 'pause-1')
    expect(state.invitations[0]).toMatchObject({ state: 'cancelled', revision: 3 })
    expect(settleInvitation(state, 'invite-1', false, '2026-09-29T20:00:00+08:00', 'change-1')).toBe(state)
    expect(state.unansweredShownRounds).toBe(0)
    state = resumeInvitations(state, '2026-09-30', '2026-09-30T12:00:00+08:00', 'resume-1')
    expect(isInvitationDue(state, '2026-09-29')).toBe(false)
    expect(isInvitationDue(state, '2026-09-30')).toBe(false)
    expect(isInvitationDue(state, '2026-10-01')).toBe(true)
    expect(state.changeEvents.map((event) => event.reason)).toEqual(['pause', 'resume'])
  })

  it('does not show a new round until the existing shown round is settled', () => {
    let state = scheduleInvitation(createInvitationState('2026-09-29'), 'invite-1', '2026-09-29')
    state = markInvitationShown(state, 'invite-1', '2026-09-29T09:00:00+08:00')
    state = scheduleInvitation(state, 'invite-2', '2026-09-30')
    expect(markInvitationShown(state, 'invite-2', '2026-09-30T09:00:00+08:00')).toBe(state)
    state = settleInvitation(state, 'invite-1', false, '2026-09-30T00:05:00+08:00', 'change-1')
    state = markInvitationShown(state, 'invite-2', '2026-09-30T09:00:00+08:00')
    expect(state.invitations.map((item) => item.state)).toEqual(['settled_unanswered', 'shown'])
    expect(settleInvitation(state, 'invite-1', false, '2026-09-30T20:00:00+08:00', 'change-1')).toBe(state)
    expect(markInvitationShown(state, 'invite-1', '2026-09-30T21:00:00+08:00')).toBe(state)
    expect(isInvitationDue(state, '2026-09-28')).toBe(false)
    state = settleInvitation(state, 'invite-2', false, '2026-09-30T20:00:00+08:00', 'change-2')
    expect(state.unansweredShownRounds).toBe(0)
    expect(state.pendingChange?.nextCadence).toBe('weekly')
  })

  it('rejects nonexistent calendar dates before they can affect the schedule', () => {
    expect(() => createInvitationState('2026-02-30')).toThrowError('invalid_input')
    expect(() => isInvitationDue(createInvitationState('2026-09-29'), '2026-09-31'))
      .toThrowError('invalid_input')
    expect(() => setCadence(
      createInvitationState('2026-09-29'), 'weekly', 'not-a-date',
      '2026-09-29T12:00:00+08:00', 'change-1',
    )).toThrowError('invalid_input')
  })

  it('keeps a pending user cadence choice when pausing and resuming the same day', () => {
    let state = setCadence(
      createInvitationState('2026-09-29'), 'weekly', '2026-09-29',
      '2026-09-29T10:00:00+08:00', 'choice-1',
    )
    state = pauseInvitations(state, '2026-09-29', '2026-09-29T11:00:00+08:00', 'pause-1')
    state = resumeInvitations(state, '2026-09-29', '2026-09-29T12:00:00+08:00', 'resume-1')
    expect(isInvitationDue(state, '2026-09-30')).toBe(true)
    expect(isInvitationDue(state, '2026-10-01')).toBe(false)
    expect(state.changeEvents.map((event) => event.reason)).toEqual(['manual_choice', 'pause', 'resume'])
  })

  it('retracts a pending automatic downgrade when a triggering round is corrected to answered', () => {
    const before = twiceUnanswered()
    expect(before.pendingChange?.nextCadence).toBe('weekly')
    const state = correctSettledInvitation(
      before, 'invite-2', true, '2026-09-30T21:00:00+08:00', '2026-09-30',
      'correction-1', 'replacement-auto-1',
    )
    expect(state.invitations[1]).toMatchObject({ state: 'settled_answered', revision: 4 })
    expect(state.pendingChange).toBeNull()
    expect(state.cadence).toBe('daily')
    expect(state.unansweredShownRounds).toBe(0)
    expect(state.changeEvents).toMatchObject([
      { id: 'auto-invite-2', retractedAt: '2026-09-30T21:00:00+08:00',
        retractionDisposition: 'cancelled_pending' },
      { id: 'correction-1', reason: 'response_correction', previousCadence: 'daily',
        nextCadence: 'daily', triggeringInvitationIds: ['invite-2'] },
    ])
    expect(isInvitationDue(state, '2026-10-01')).toBe(true)
    expect(before.changeEvents[0].retractedAt).toBeUndefined()
  })

  it('marks an already-effective downgrade retracted without automatically increasing cadence', () => {
    let state = twiceUnanswered()
    state = scheduleInvitation(state, 'invite-3', '2026-10-07')
    expect(state.cadence).toBe('weekly')
    expect(state.pendingChange).toBeNull()
    state = correctSettledInvitation(
      state, 'invite-1', true, '2026-10-07T12:00:00+08:00', '2026-10-07',
      'correction-2', 'replacement-auto-2',
    )
    expect(state.invitations[0]).toMatchObject({ state: 'settled_answered', revision: 4 })
    expect(state.cadence).toBe('weekly')
    expect(state.pendingChange).toBeNull()
    expect(state.changeEvents).toMatchObject([
      { id: 'auto-invite-2', retractedAt: '2026-10-07T12:00:00+08:00',
        retractionDisposition: 'annotated_effective' },
      { id: 'correction-2', reason: 'response_correction', previousCadence: 'weekly',
        nextCadence: 'weekly', triggeringInvitationIds: ['invite-1'] },
    ])
    expect(state.unansweredShownRounds).toBe(0)
  })

  it('recounts the remaining unanswered round after a historical answer correction', () => {
    let state = twiceUnanswered()
    state = correctSettledInvitation(
      state, 'invite-1', true, '2026-09-30T21:00:00+08:00', '2026-09-30',
      'correction-1', 'replacement-auto-1',
    )
    expect(state.unansweredShownRounds).toBe(1)
    expect(state.pendingChange).toBeNull()
    state = scheduleInvitation(state, 'invite-3', '2026-10-01')
    state = markInvitationShown(state, 'invite-3', '2026-10-01T09:00:00+08:00')
    state = settleInvitation(state, 'invite-3', false, '2026-10-01T20:00:00+08:00', 'auto-invite-3')
    expect(state.pendingChange).toMatchObject({
      nextCadence: 'weekly', triggeringInvitationIds: ['invite-2', 'invite-3'],
    })
  })

  it('creates a new downgrade when an answered historical round becomes the second unanswered round', () => {
    let state = createInvitationState('2026-09-29')
    for (const [id, date, answered] of [
      ['invite-1', '2026-09-29', false], ['invite-2', '2026-09-30', true],
    ] as const) {
      state = scheduleInvitation(state, id, date)
      state = markInvitationShown(state, id, `${date}T09:00:00+08:00`)
      state = settleInvitation(state, id, answered, `${date}T20:00:00+08:00`, `auto-${id}`)
    }
    state = correctSettledInvitation(
      state, 'invite-2', false, '2026-10-02T21:00:00+08:00', '2026-10-02',
      'correction-2', 'replacement-auto-2',
    )
    expect(state.cadence).toBe('daily')
    expect(state.unansweredShownRounds).toBe(0)
    expect(state.pendingChange).toMatchObject({
      id: 'replacement-auto-2', reason: 'two_shown_rounds_unanswered',
      previousCadence: 'daily', nextCadence: 'weekly',
      effectiveDate: '2026-10-03', anchorDate: '2026-10-02',
      triggeringInvitationIds: ['invite-1', 'invite-2'],
    })
    expect(state.changeEvents.at(-2)).toMatchObject({ id: 'correction-2', reason: 'response_correction' })
  })

  it('materializes an overdue downgrade before retracting it even without a later schedule call', () => {
    const state = correctSettledInvitation(
      twiceUnanswered(), 'invite-1', true, '2026-10-01T10:00:00+08:00', '2026-10-01',
      'correction-overdue', 'replacement-auto-overdue',
    )
    expect(state.cadence).toBe('weekly')
    expect(state.pendingChange).toBeNull()
    expect(state.changeEvents[0]).toMatchObject({
      retractedAt: '2026-10-01T10:00:00+08:00',
      retractionDisposition: 'annotated_effective',
    })
    expect(state.unansweredShownRounds).toBe(0)
    expect(state.changeEvents.at(-1)).toMatchObject({
      id: 'correction-overdue', previousCadence: 'weekly', nextCadence: 'weekly',
    })
  })

  it('freezes question target when each invitation is scheduled', () => {
    let state = scheduleInvitation(createInvitationState('2026-09-29'), 'daily-invite', '2026-09-29')
    expect(state.invitations[0].questionTarget).toBe(2)
    state = setCadence(state, 'weekly', '2026-09-29', '2026-09-29T21:00:00+08:00', 'manual-1')
    state = scheduleInvitation(state, 'weekly-invite', '2026-09-30')
    expect(state.invitations.map((item) => item.questionTarget)).toEqual([2, 1])
    state = setCadence(state, 'daily', '2026-09-30', '2026-09-30T21:00:00+08:00', 'manual-2')
    expect(state.invitations.map((item) => item.questionTarget)).toEqual([2, 1])
  })

  it('never reuses effective downgrade rounds after correcting an old answer twice', () => {
    let state = correctSettledInvitation(
      twiceUnanswered(), 'invite-1', true, '2026-10-01T10:00:00+08:00', '2026-10-01',
      'correction-first', 'unused-auto-first',
    )
    state = correctSettledInvitation(
      state, 'invite-1', false, '2026-10-01T11:00:00+08:00', '2026-10-01',
      'correction-second', 'unused-auto-second',
    )
    expect(state.cadence).toBe('weekly')
    expect(state.pendingChange).toBeNull()
    expect(state.unansweredShownRounds).toBe(0)
    expect(state.changeEvents.map((event) => event.id)).toEqual([
      'auto-invite-2', 'correction-first', 'correction-second',
    ])
    state = scheduleInvitation(state, 'invite-3', '2026-10-07')
    state = markInvitationShown(state, 'invite-3', '2026-10-07T09:00:00+08:00')
    state = settleInvitation(state, 'invite-3', false, '2026-10-07T20:00:00+08:00', 'auto-invite-3')
    expect(state.unansweredShownRounds).toBe(1)
    expect(state.pendingChange).toBeNull()
    state = scheduleInvitation(state, 'invite-4', '2026-10-14')
    state = markInvitationShown(state, 'invite-4', '2026-10-14T09:00:00+08:00')
    state = settleInvitation(state, 'invite-4', false, '2026-10-14T20:00:00+08:00', 'auto-invite-4')
    expect(state.pendingChange).toMatchObject({
      nextCadence: 'manual', triggeringInvitationIds: ['invite-3', 'invite-4'],
    })
  })

  it('can retrigger a cancelled pending downgrade when the same two rounds become unanswered again', () => {
    let state = correctSettledInvitation(
      twiceUnanswered(), 'invite-1', true, '2026-09-30T21:00:00+08:00', '2026-09-30',
      'correction-first', 'unused-auto-first',
    )
    expect(state.changeEvents[0].retractionDisposition).toBe('cancelled_pending')
    expect(state.unansweredShownRounds).toBe(1)
    state = correctSettledInvitation(
      state, 'invite-1', false, '2026-09-30T22:00:00+08:00', '2026-09-30',
      'correction-second', 'replacement-auto-second',
    )
    expect(state.cadence).toBe('daily')
    expect(state.pendingChange).toMatchObject({
      id: 'replacement-auto-second', nextCadence: 'weekly',
      triggeringInvitationIds: ['invite-1', 'invite-2'],
    })
  })

  it('uses the supplied local calendar date for a correction across a UTC midnight boundary', () => {
    const state = correctSettledInvitation(
      twiceUnanswered(), 'invite-2', true,
      '2026-09-30T16:30:00Z', '2026-10-01', 'correction-timezone', 'replacement-auto-timezone',
    )
    expect(state.changeEvents.at(-1)).toMatchObject({
      id: 'correction-timezone', reason: 'response_correction',
      decidedAt: '2026-09-30T16:30:00Z', effectiveDate: '2026-10-01',
    })
  })

  it('does not fabricate a correction event when the settled outcome is unchanged', () => {
    const state = twiceUnanswered()
    const result = correctSettledInvitation(
      state, 'invite-2', false, '2026-09-30T21:00:00+08:00', '2026-09-30',
      'correction-same', 'replacement-auto-same',
    )
    expect(result).toBe(state)
    expect(result.invitations[1].revision).toBe(3)
    expect(result.pendingChange?.nextCadence).toBe('weekly')
    expect(result.changeEvents).toHaveLength(1)
  })
})
