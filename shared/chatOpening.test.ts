import { describe, expect, it } from 'vitest'
import { chatOpenings, openingForHour, isChatOpeningId } from './chatOpening'

describe('local-time conversation opening', () => {
  it.each([[0, 'late-night'], [5, 'late-night'], [6, 'morning'], [10, 'morning'],
    [11, 'noon'], [13, 'noon'], [14, 'afternoon'], [17, 'afternoon'],
    [18, 'evening'], [22, 'evening'], [23, 'late-night']] as const)(
    'selects hour %i as %s', (hour, expected) => expect(openingForHour(hour)).toBe(expected))
  it('accepts only controlled IDs, each with one question', () => {
    for (const [id, copy] of Object.entries(chatOpenings)) {
      expect(isChatOpeningId(id)).toBe(true)
      expect(copy.question.match(/？/g)).toHaveLength(1)
    }
    for (const id of ['toString', '__proto__', '', null, {}, 'say anything']) {
      expect(isChatOpeningId(id)).toBe(false)
    }
  })
})
