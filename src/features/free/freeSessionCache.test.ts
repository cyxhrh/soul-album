import { beforeEach, describe, expect, it } from 'vitest'
import { createBrowserLocalSession } from '../../domain/browserLocalSession'
import { createInvitationState } from '../../domain/invitations'
import { createDailyRecord } from '../album/dailyRecord'
import { loadFreeSession, type SavedFreeSession } from './freeSessionCache'
import { readSavedSession, saveSession, SESSION_STORAGE_KEY } from './sessionPersistence'

function fixture(): SavedFreeSession {
  const session = createBrowserLocalSession({ dayOneDate: '2026-09-30', timezone: 'UTC' })
  const sent = session.sendMessage(1, '今天去了河边散步。', session.firstQuestionId)
  const messages = [{ id: sent.message.id, role: 'user' as const, text: '今天去了河边散步。', recordedAt: '2026-09-30T00:00:00Z' }]
  return {
    session: session.exportState(), openingId: 'morning', openingDismissed: false,
    chatTurns: [{ messageId: sent.message.id,
      request: { turn: { kind: 'entry', id: sent.entry!.id, revision: 1, day: 1, quote: '今天去了河边散步。' }, context: [] },
      response: { status: 'generated', reply: '听见了你的分享。', nextQuestion: null, citations: [],
        model: { provider: 'qwen', id: 'test-model' }, generatedAt: '2026-09-30T00:00:00Z' } }],
    controlExchanges: [], invitation: createInvitationState(), day: 1, viewedDay: 1, questionIndex: 0,
    answeredInRound: false, extraQuestion: false, thirdUsed: false, activeQuestionId: session.firstQuestionId,
    draft: '还没发送的草稿', choice: 'daily', dailyRecords: { '2026-09-30': createDailyRecord('2026-09-30', messages) },
    dailySources: { '2026-09-30': messages },
  }
}

beforeEach(() => { localStorage.clear(); readSavedSession() })

it('returns no session on first visit and restores a complete typed cache without changing it', () => {
  expect(loadFreeSession()).toEqual({ saved: null, error: null })
  const saved = fixture()
  saveSession(saved)
  const raw = localStorage.getItem(SESSION_STORAGE_KEY)
  expect(loadFreeSession()).toEqual({ saved, error: null })
  expect(localStorage.getItem(SESSION_STORAGE_KEY)).toBe(raw)
})

describe('invalid saved UI payload', () => {
  it.each(['opening', 'day', 'invitation', 'pending', 'chat-request', 'chat-context', 'chat-response',
    'response-model', 'response-citation', 'preceding-reply', 'record-role', 'record-portrait',
    'record-fingerprint', 'record-date', 'daily-source', 'draft', 'control-exchange', 'active-question', 'unknown-question'])('%s returns an error without crashing or overwriting the cache', (kind) => {
    const saved = fixture()
    if (kind === 'opening') saved.openingId = 'bad' as never
    if (kind === 'day') saved.day = NaN
    if (kind === 'invitation') saved.invitation.shownDays = null as never
    if (kind === 'pending') saved.invitation.pendingChange = { cadence: 'bad', effectiveDay: -1 } as never
    if (kind === 'chat-request') saved.chatTurns[0].request = null as never
    if (kind === 'chat-context') saved.chatTurns[0].request.context = [null as never]
    if (kind === 'chat-response') saved.chatTurns[0].response = null as never
    if (kind === 'response-model') saved.chatTurns[0].response.model = null as never
    if (kind === 'response-citation') saved.chatTurns[0].response.citations = [{ id: 'fake', quote: '假的引用' }]
    if (kind === 'preceding-reply') saved.chatTurns[0].request.precedingAssistant = { reply: 5, nextQuestion: null } as never
    if (kind === 'record-role') saved.dailyRecords['2026-09-30'].messages[0].role = 'admin' as never
    if (kind === 'record-portrait') saved.dailyRecords['2026-09-30'].portrait.observations = [{ text: '无依据推断', evidenceIds: ['fake'] }]
    if (kind === 'record-fingerprint') saved.dailyRecords['2026-09-30'].sourceFingerprint = 'bad'
    if (kind === 'record-date') saved.dailyRecords['2026-09-30'].date = '2026-10-01'
    if (kind === 'daily-source') saved.dailySources['2026-09-30'][0].recordedAt = 'bad'
    if (kind === 'draft') saved.draft = null as never
    if (kind === 'control-exchange') saved.controlExchanges = [{ id: 'id', reply: null as never }]
    if (kind === 'active-question') saved.activeQuestionId = 2 as never
    if (kind === 'unknown-question') saved.activeQuestionId = crypto.randomUUID()
    saveSession(saved)
    const raw = localStorage.getItem(SESSION_STORAGE_KEY)
    const result = loadFreeSession()
    expect(result.saved).toBeNull()
    expect(result.error).toBeTruthy()
    expect(localStorage.getItem(SESSION_STORAGE_KEY)).toBe(raw)
  })

  it('preserves a damaged envelope and returns its read error', () => {
    localStorage.setItem(SESSION_STORAGE_KEY, '{')
    expect(loadFreeSession().error).toBeTruthy()
    expect(localStorage.getItem(SESSION_STORAGE_KEY)).toBe('{')
  })

  it('reports a null payload as corruption instead of treating it as a first visit', () => {
    const raw = JSON.stringify({ version: 1, writeId: 'id', value: null })
    localStorage.setItem(SESSION_STORAGE_KEY, raw)
    expect(loadFreeSession().error).toBeTruthy()
    expect(localStorage.getItem(SESSION_STORAGE_KEY)).toBe(raw)
  })
})
