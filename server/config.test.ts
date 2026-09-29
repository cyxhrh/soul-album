import { describe, expect, it } from 'vitest'
import { maxCallsFromEnv } from './config.js'

describe('AI upstream attempt limit', () => {
  it('defaults to 30 and accepts positive integers through 30', () => {
    expect(maxCallsFromEnv(undefined)).toBe(30)
    expect(maxCallsFromEnv('1')).toBe(1)
    expect(maxCallsFromEnv('30')).toBe(30)
  })

  it.each(['', '0', '-1', '1.5', '1e0', ' 1', '31', '999999999999999999999'])
  ('rejects an invalid limit %s', (value) => {
    expect(() => maxCallsFromEnv(value)).toThrow('invalid AI max calls')
  })
})
