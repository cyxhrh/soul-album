import { describe, expect, it } from 'vitest'
import { createBrowserLocalSession } from './browserLocalSession'

describe('browser local session', () => {
  it('keeps records from separate demonstration days on separate day pages', () => {
    const session = createBrowserLocalSession({
      dayOneDate: '2026-09-29', timezone: 'UTC',
      now: () => new Date('2026-09-29T09:15:00.000Z'),
    })

    session.sendMessage(1, '第一天的原话。', session.firstQuestionId)
    session.sendMessage(2, '第二天的原话。')

    expect(session.dateForDay(1)).toBe('2026-09-29')
    expect(session.dateForDay(2)).toBe('2026-09-30')
    expect(session.dateForDay(8)).toBe('2026-10-06')
    expect(session.listDays()).toEqual([2, 1])
    expect(session.getDay(1)?.entries.map((entry) => entry.text)).toEqual(['第一天的原话。'])
    expect(session.getDay(2)?.entries.map((entry) => entry.text)).toEqual(['第二天的原话。'])
  })

  it('keeps control words in messages without making a day page', () => {
    const session = createBrowserLocalSession({
      dayOneDate: '2026-09-29', timezone: 'UTC',
      now: () => new Date('2026-09-29T09:15:00.000Z'),
    })

    session.sendMessage(1, '换个问题', session.firstQuestionId)
    const snapshot = session.read()

    expect(session.projectMessages(snapshot).map((message) => message.text)).toEqual(['换个问题'])
    expect(session.listDays()).toEqual([])
    expect(session.getDay(1)).toBeNull()
  })

  it('redacts revised and deleted cited words in every active projection', () => {
    const session = createBrowserLocalSession({
      dayOneDate: '2026-09-29', timezone: 'UTC',
      now: () => new Date('2026-09-29T09:15:00.000Z'),
    })
    const first = session.sendMessage(1, '旧的秘密原话', session.firstQuestionId)
    const followup = session.displayNextQuestion(2)
    session.sendMessage(2, '第二天的回答', followup.id)
    session.setDayTitle(2, '旧的秘密原话')

    session.editEntry(first.entry!.id, '新的表述')
    let snapshot = session.read()
    expect(JSON.stringify(session.projectJournal(snapshot))).not.toContain('旧的秘密原话')
    expect(JSON.stringify(session.projectMessages(snapshot))).not.toContain('旧的秘密原话')
    expect(session.getDay(2)?.title).toBeNull()
    expect(snapshot.questions.find((question) => question.id === followup.id)?.text).toBe('引用已修订')

    session.deleteEntry(first.entry!.id)
    snapshot = session.read()
    expect(session.listDays()).toEqual([2])
    expect(JSON.stringify(session.projectJournal(snapshot))).not.toContain('旧的秘密原话')
    expect(JSON.stringify(session.projectMessages(snapshot))).not.toContain('旧的秘密原话')
  })

  it('refuses to render an entry-backed message when its only current entry is missing', () => {
    const session = createBrowserLocalSession({
      dayOneDate: '2026-09-29', timezone: 'UTC',
      now: () => new Date('2026-09-29T09:15:00.000Z'),
    })
    session.sendMessage(1, '一条原话', session.firstQuestionId)
    const damagedSnapshot = session.read()
    damagedSnapshot.entries = []

    expect(() => session.projectMessages(damagedSnapshot)).toThrow('message has no current text')
  })
})
