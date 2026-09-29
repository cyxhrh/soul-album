import { afterEach, describe, expect, it, vi } from 'vitest'
import { createBrowserLocalSession } from '../../domain/browserLocalSession'
import {
  currentChatTurns, excerptFromText, privateChatAvailableOnThisHost,
  PrivateChatRequestError, requestPrivateChat,
  sourceForMessage, validChatExcerpt, type PrivateChatRequest, type PrivateChatTurn,
} from './privateChat'

afterEach(() => vi.unstubAllGlobals())

function setup() {
  const session = createBrowserLocalSession({
    dayOneDate: '2026-09-29', timezone: 'UTC', now: () => new Date('2026-09-29T09:00:00Z'),
  })
  const result = session.sendMessage(1, '你好', null)
  const source = sourceForMessage(session.read(), result.message, 1)
  if (!source || !result.entry) throw new Error('test setup failed')
  return { session, result, source }
}

describe('consented private chat turns', () => {
  it('supports a short greeting and sends only the exact selected turn', async () => {
    const { source } = setup()
    const request: PrivateChatRequest = { turn: source, context: [] }
    expect(validChatExcerpt('你好', '你好')).toBe(true)
    expect(excerptFromText('新消息')).toBe('新消息')
    vi.stubGlobal('window', { location: { hostname: 'localhost' } })
    const fetcher = vi.fn(async (_url: string, init: RequestInit) => {
      expect(JSON.parse(String(init.body))).toEqual(request)
      return new Response(JSON.stringify({
        status: 'generated', reply: '你好，我在。想聊什么都可以。', nextQuestion: null, citations: [],
        model: { provider: 'qwen', id: 'fake-qwen' }, generatedAt: '2026-09-29T09:00:00Z',
      }), { status: 200 })
    }) as unknown as typeof fetch
    const response = await requestPrivateChat(request, new AbortController().signal, fetcher)
    expect(response.reply).toBe('你好，我在。想聊什么都可以。')
    expect(response.nextQuestion).toBeNull()
    expect(fetcher).toHaveBeenCalledOnce()
  })

  it('never calls a private endpoint from the public static host', async () => {
    const { source } = setup()
    expect(privateChatAvailableOnThisHost('cyxhrh.github.io')).toBe(false)
    vi.stubGlobal('window', { location: { hostname: 'cyxhrh.github.io' } })
    const fetcher = vi.fn() as unknown as typeof fetch
    await expect(requestPrivateChat({ turn: source, context: [] }, new AbortController().signal, fetcher))
      .rejects.toThrow('private chat unavailable')
    expect(fetcher).not.toHaveBeenCalled()
  })

  it.each([
    [502, 'invalid_model_output'],
    [429, 'rate_limited'],
    [503, 'model_unavailable'],
    [504, 'model_timeout'],
  ] as const)('maps only an allowlisted %i error code (%s)', async (status, code) => {
    const { source } = setup()
    vi.stubGlobal('window', { location: { hostname: 'localhost' } })
    const fetcher = (async () => new Response(JSON.stringify({
      status: 'error', code, message: 'provider-secret-and-raw-error',
    }), { status })) as typeof fetch
    const failure = await requestPrivateChat({ turn: source, context: [] },
      new AbortController().signal, fetcher).catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(PrivateChatRequestError)
    expect((failure as PrivateChatRequestError).code).toBe(code)
    expect(String(failure)).not.toContain('provider-secret')
  })

  it('does not trust a mismatched status or an oversized error body', async () => {
    const { source } = setup()
    vi.stubGlobal('window', { location: { hostname: 'localhost' } })
    for (const [status, body] of [
      [503, JSON.stringify({ status: 'error', code: 'invalid_model_output' })],
      [502, JSON.stringify({ status: 'error', code: 'invalid_model_output',
        message: 'raw-private-error'.repeat(400) })],
    ] as const) {
      const fetcher = (async () => new Response(body, { status })) as typeof fetch
      const failure = await requestPrivateChat({ turn: source, context: [] },
        new AbortController().signal, fetcher).catch((error: unknown) => error)
      expect((failure as PrivateChatRequestError).code).toBe('unknown')
      expect(String(failure)).not.toContain('raw-private-error')
    }
  })

  it('rejects invented citations and withdraws dependent replies after editing the source', async () => {
    const { session, result, source } = setup()
    vi.stubGlobal('window', { location: { hostname: '127.0.0.1' } })
    const request: PrivateChatRequest = { turn: source, context: [] }
    const invalidFetcher = (async () => new Response(JSON.stringify({
      status: 'generated', reply: '我记得你说过天气很好。', nextQuestion: null,
      citations: [{ id: source.id, quote: '天气很好' }],
      model: { provider: 'qwen', id: 'fake-qwen' }, generatedAt: '2026-09-29T09:00:00Z',
    }), { status: 200 })) as typeof fetch
    await expect(requestPrivateChat(request, new AbortController().signal, invalidFetcher))
      .rejects.toThrow('invalid citation')

    const first: PrivateChatTurn = {
      messageId: result.message.id, request,
      response: { status: 'generated', reply: '你好，我在。', nextQuestion: null, citations: [],
        model: { provider: 'qwen', id: 'fake-qwen' }, generatedAt: '2026-09-29T09:00:00Z' },
    }
    const secondMessage = session.sendMessage(1, '其实我想聊今天。', null)
    const secondSource = sourceForMessage(session.read(), secondMessage.message, 1)
    if (!secondSource) throw new Error('test setup failed')
    const second: PrivateChatTurn = {
      messageId: secondMessage.message.id,
      request: { turn: secondSource, context: [],
        precedingAssistant: { reply: first.response.reply, nextQuestion: null } },
      precedingMessageId: first.messageId,
      response: { status: 'generated', reply: '今天发生了什么？', nextQuestion: null, citations: [],
        model: { provider: 'qwen', id: 'fake-qwen' }, generatedAt: '2026-09-29T09:01:00Z' },
    }
    expect(currentChatTurns(session.read(), [first, second])).toHaveLength(2)
    session.editEntry(result.entry!.id, '改过的问候。')
    expect(currentChatTurns(session.read(), [first, second])).toEqual([])

    const deleted = setup()
    const linked: PrivateChatTurn = { ...first, messageId: deleted.result.message.id,
      request: { turn: deleted.source, context: [] } }
    deleted.session.deleteEntry(deleted.result.entry!.id)
    expect(currentChatTurns(deleted.session.read(), [linked])).toEqual([])
  })
})
