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

  it('asks about the record without repeating an entire punctuated message', () => {
    const session = createBrowserLocalSession({
      dayOneDate: '2026-09-29', timezone: 'UTC',
      now: () => new Date('2026-09-29T09:15:00.000Z'),
    })
    const saved = session.sendMessage(1, '今天去了河边，看到夕阳，很开心。', session.firstQuestionId)
    const followup = session.displayNextQuestion(1)

    expect(followup.text).toBe('关于这段记录，还有什么想补充的吗？')
    expect(followup.text).not.toContain(saved.entry!.text)
    expect(followup.citations).toEqual([{ kind: 'entry', id: saved.entry!.id, revision: 1 }])

    session.sendMessage(1, '还看见了晚风里的树叶。', followup.id)
    const tomorrowFirst = session.displayNextQuestion(2)
    session.sendMessage(2, '今天走了一段路。', tomorrowFirst.id)
    const tomorrowSecond = session.displayNextQuestion(2)
    expect(new Set([followup.text, tomorrowFirst.text, tomorrowSecond.text]).size).toBe(3)
    expect(tomorrowFirst.citations).toHaveLength(1)
    expect(tomorrowSecond.citations).toHaveLength(1)
    expect([followup.text, tomorrowFirst.text, tomorrowSecond.text].join('')).not.toContain(saved.entry!.text)
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
