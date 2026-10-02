import { beforeEach, expect, it, vi } from 'vitest'
import { clearSavedSession, readSavedSession, saveSession, SESSION_STORAGE_KEY } from './sessionPersistence'

beforeEach(() => { vi.restoreAllMocks(); localStorage.clear(); readSavedSession() })

it('round trips a versioned UI payload including Chinese and clears it explicitly', () => {
  expect(readSavedSession()).toEqual({ value: null, error: null })
  const value = { draft: '还想说的话 🌱', revision: 2, messages: ['原文\n```'] }
  saveSession(value)
  expect(readSavedSession<typeof value>()).toEqual({ value, error: null })
  clearSavedSession()
  expect(readSavedSession()).toEqual({ value: null, error: null })
})

it.each(['{', '{"version":99,"value":{}}', '{"version":1}'])('reports corruption and refuses to silently overwrite %s', (raw) => {
  localStorage.setItem(SESSION_STORAGE_KEY, raw)
  expect(readSavedSession().error).toBeTruthy()
  expect(() => saveSession({ draft: 'new' })).toThrow()
  expect(localStorage.getItem(SESSION_STORAGE_KEY)).toBe(raw)
})

it('surfaces quota and inaccessible-storage failures without deleting the previous record', () => {
  saveSession({ draft: '已存内容' })
  const previous = localStorage.getItem(SESSION_STORAGE_KEY)
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('full', 'QuotaExceededError') })
  expect(() => saveSession({ draft: '新内容' })).toThrow(/空间|保存/)
  expect(localStorage.getItem(SESSION_STORAGE_KEY)).toBe(previous)
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new DOMException('blocked', 'SecurityError') })
  expect(readSavedSession().error).toBeTruthy()
})

it('refuses stale writes after another tab modifies or clears the key', () => {
  saveSession({ draft: 'original' })
  const otherTab = JSON.stringify({ version: 1, value: { draft: '其他页面' }, writeId: 'other' })
  localStorage.setItem(SESSION_STORAGE_KEY, otherTab)
  expect(() => saveSession({ draft: 'stale' })).toThrow(/其他页面/)
  expect(localStorage.getItem(SESSION_STORAGE_KEY)).toBe(otherTab)
  readSavedSession()
  localStorage.removeItem(SESSION_STORAGE_KEY)
  expect(() => saveSession({ draft: 'resurrected' })).toThrow(/其他页面/)
})

it('reports clear failures and serialization failures without claiming success', () => {
  saveSession({ draft: '保留' })
  const raw = localStorage.getItem(SESSION_STORAGE_KEY)
  expect(() => saveSession({ invalid: 1n })).toThrow(/保存失败/)
  expect(localStorage.getItem(SESSION_STORAGE_KEY)).toBe(raw)
  vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new Error('blocked') })
  expect(() => clearSavedSession()).toThrow(/无法清除/)
  expect(localStorage.getItem(SESSION_STORAGE_KEY)).toBe(raw)
})
