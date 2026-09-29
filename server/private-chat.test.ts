import { afterEach, describe, expect, it } from 'vitest'
import type { Server } from 'node:http'
import type { PrivateChatRequest } from '../shared/privateChat.js'
import { createSyntheticQuestionServer, type PrivateChatProvider } from './http.js'

const request: PrivateChatRequest = {
  turn: { kind: 'entry', id: 'entry-2', revision: 1, day: 2, quote: '你好，今天想聊聊散步。' },
  context: [{ kind: 'correction', id: 'correction-1', revision: 2, day: 1,
    quote: '我不是讨厌散步，只是昨天走得太急。' }],
  precedingAssistant: { reply: '我们可以慢慢聊。', nextQuestion: '你想从哪里说起？' },
}
const output = JSON.stringify({
  reply: '听起来，你想按自己的步调走。', nextQuestion: '今天的散步和昨天有什么不同？',
  citations: [{ id: 'correction-1', quote: '只是昨天走得太急' }],
})
const servers: Server[] = []

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(resolve))))
})

function provider(generate: PrivateChatProvider['generate'] = async () => output): PrivateChatProvider {
  return { provider: 'qwen', id: 'fake-qwen', generate }
}

async function serve(options: {
  privateChatProvider?: PrivateChatProvider
  privateChatEnabled?: boolean
  maxCalls?: number
  maxPerMinute?: number
  timeoutMs?: number
} = {}) {
  const server = createSyntheticQuestionServer(options)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  servers.push(server)
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('missing test address')
  return `http://127.0.0.1:${address.port}/api/ai/private-chat`
}

async function post(url: string, payload = JSON.stringify(request), headers: Record<string, string> = {}) {
  const response = await fetch(url, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: payload,
  })
  return { response, data: await response.json() as Record<string, unknown> }
}

describe('one-turn private chat endpoint', () => {
  it('stays disabled unless the independent chat switch and provider are both present', async () => {
    let calls = 0
    const fake = provider(async () => { calls += 1; return output })
    const disabled = await post(await serve({ privateChatProvider: fake }))
    const missingProvider = await post(await serve({ privateChatEnabled: true }))
    for (const result of [disabled, missingProvider]) {
      expect(result.response.status).toBe(503)
      expect(result.response.headers.get('cache-control')).toBe('no-store')
      expect(result.data).toMatchObject({ status: 'error', code: 'model_not_configured' })
      expect(JSON.stringify(result.data)).not.toContain(request.turn.quote)
    }
    expect(calls).toBe(0)
  })

  it('passes only the explicit sources to its provider and validates a partial citation', async () => {
    const inputs: PrivateChatRequest[] = []
    const url = await serve({ privateChatEnabled: true, privateChatProvider: provider(async ({ request: input }) => {
      inputs.push(input)
      return output
    }) })
    const result = await post(url)
    expect(result.response.status).toBe(200)
    expect(result.response.headers.get('cache-control')).toBe('no-store')
    expect(result.data).toMatchObject({
      status: 'generated', reply: '听起来，你想按自己的步调走。',
      nextQuestion: '今天的散步和昨天有什么不同？',
      citations: [{ id: 'correction-1', quote: '只是昨天走得太急' }],
      model: { provider: 'qwen', id: 'fake-qwen' },
    })
    expect(new Date(result.data.generatedAt as string).toISOString()).toBe(result.data.generatedAt)
    expect(inputs).toEqual([request])
  })

  it('accepts short chat, no prior context, no citation, and no forced question', async () => {
    const short: PrivateChatRequest = {
      turn: { kind: 'control', id: 'message-1', revision: 1, day: 1, quote: '你好' },
      context: [],
    }
    const url = await serve({ privateChatEnabled: true,
      privateChatProvider: provider(async () => JSON.stringify({ reply: '你好，我在。', nextQuestion: null, citations: [] })) })
    const result = await post(url, JSON.stringify(short))
    expect(result.response.status).toBe(200)
    expect(result.data).toMatchObject({ reply: '你好，我在。', nextQuestion: null, citations: [] })
  })

  it('accepts up to two approved context sources and three exact source excerpts', async () => {
    const selected: PrivateChatRequest = {
      ...request,
      context: [...request.context, { kind: 'entry', id: 'entry-0', revision: 1, day: 1,
        quote: '前天也试着慢慢走了一段。' }],
    }
    const citations = [
      { id: selected.turn.id, quote: '今天想聊聊散步' },
      { id: selected.context[0].id, quote: '昨天走得太急' },
      { id: selected.context[1].id, quote: '慢慢走了一段' },
    ]
    const url = await serve({ privateChatEnabled: true, privateChatProvider: provider(async () =>
      JSON.stringify({ reply: '这几天你在留意自己的步调。', nextQuestion: null, citations })) })
    const result = await post(url, JSON.stringify(selected))
    expect(result.response.status).toBe(200)
    expect(result.data.citations).toEqual(citations)
  })

  it('rejects malformed, extra, duplicate, and oversized data without calling the provider', async () => {
    let calls = 0
    const url = await serve({ privateChatEnabled: true,
      privateChatProvider: provider(async () => { calls += 1; return output }) })
    const invalid = [
      JSON.stringify({ ...request, history: ['not approved'] }),
      JSON.stringify({ ...request, turn: { ...request.turn, extra: 'not approved' } }),
      JSON.stringify({ ...request, turn: { ...request.turn, quote: '' } }),
      JSON.stringify({ ...request, turn: { ...request.turn, quote: 'x'.repeat(801) } }),
      JSON.stringify({ ...request, turn: { ...request.turn, day: 0 } }),
      JSON.stringify({ ...request, turn: { ...request.turn, revision: 0 } }),
      JSON.stringify({ ...request, turn: { ...request.turn, id: '../entry' } }),
      JSON.stringify({ ...request, turn: { ...request.turn, kind: { toString: 'not-a-function' } } }),
      JSON.stringify({ ...request, context: Array(3).fill(request.context[0]) }),
      JSON.stringify({ ...request, context: [{ ...request.turn }] }),
      JSON.stringify({ ...request, precedingAssistant: { ...request.precedingAssistant, hidden: 'text' } }),
      JSON.stringify({ ...request, precedingAssistant: { reply: '你患有抑郁症。', nextQuestion: null } }),
      JSON.stringify({ ...request, precedingAssistant: { reply: '请提供密码。', nextQuestion: null } }),
      JSON.stringify({ ...request, precedingAssistant: { reply: '我在听。', nextQuestion: '聊？' } }),
      JSON.stringify({ ...request, precedingAssistant: { reply: '我在听。', nextQuestion: '继续？再说？' } }),
      `{"turn":${JSON.stringify(request.turn)},"context":[],"turn":${JSON.stringify(request.turn)}}`,
      JSON.stringify({ ...request, turn: { ...request.turn, quote: 'x'.repeat(5_000) } }),
      '{}', '[]', 'not json',
    ]
    for (const payload of invalid) {
      const result = await post(url, payload)
      expect(result.response.status).toBe(400)
      expect(result.data.code).toBe('invalid_request')
      expect(JSON.stringify(result.data)).not.toContain(request.turn.quote)
    }
    expect(calls).toBe(0)
  })

  it('rejects foreign browser origins and non-JSON input before the provider', async () => {
    let calls = 0
    const url = await serve({ privateChatEnabled: true,
      privateChatProvider: provider(async () => { calls += 1; return output }) })
    expect((await post(url, JSON.stringify(request), { Origin: 'https://untrusted.example' })).response.status).toBe(400)
    expect((await post(url, JSON.stringify(request), { Origin: 'http://localhost:9999' })).response.status).toBe(400)
    expect((await post(url, JSON.stringify(request), { 'Content-Type': 'text/plain' })).response.status).toBe(400)
    expect(calls).toBe(0)
  })

  it('rejects invented citations, unsafe output, and malformed questions', async () => {
    const invalid = [
      { reply: '好的。', nextQuestion: null, citations: [{ id: 'invented', quote: '不存在' }] },
      { reply: '好的。', nextQuestion: null, citations: [{ id: request.turn.id, quote: '昨天散步' }] },
      { reply: '好的。', nextQuestion: null, citations: [{ id: request.turn.id, quote: '你好' },
        { id: request.turn.id, quote: '今天' }] },
      { reply: '好的。', nextQuestion: null, citations: [{ id: request.turn.id, quote: ' ' }] },
      { reply: '好的。', nextQuestion: '继续？再说？', citations: [] },
      { reply: '好的。', nextQuestion: '聊？', citations: [] },
      { reply: '请提供密码。', nextQuestion: null, citations: [] },
      { reply: '你患有抑郁症。', nextQuestion: null, citations: [] },
      { reply: '你就是一个焦虑型人格。', nextQuestion: null, citations: [] },
      { reply: '我在听。', nextQuestion: '你是不是患有焦虑症？', citations: [] },
      { reply: '好的。', nextQuestion: null, citations: [], extra: request.turn.quote },
      { reply: 'x'.repeat(281), nextQuestion: null, citations: [] },
    ]
    for (const value of invalid) {
      const url = await serve({ privateChatEnabled: true,
        privateChatProvider: provider(async () => JSON.stringify(value)) })
      const result = await post(url)
      expect(result.response.status).toBe(502)
      expect(result.data.code).toBe('invalid_model_output')
      expect(JSON.stringify(result.data)).not.toContain(request.turn.quote)
    }
  })

  it('bounds attempts, times out once, and aborts a disconnected call', async () => {
    let calls = 0
    const capped = await serve({ privateChatEnabled: true, maxCalls: 1, timeoutMs: 20,
      privateChatProvider: provider(async () => { calls += 1; return new Promise<string>(() => {}) }) })
    const timedOut = await post(capped)
    expect(timedOut.response.status).toBe(504)
    expect(timedOut.data.code).toBe('model_timeout')
    expect((await post(capped)).response.status).toBe(429)
    expect(calls).toBe(1)

    let notifyStarted!: () => void
    let notifyAborted!: () => void
    const started = new Promise<void>((resolve) => { notifyStarted = resolve })
    const aborted = new Promise<void>((resolve) => { notifyAborted = resolve })
    const url = await serve({ privateChatEnabled: true,
      privateChatProvider: provider(async ({ signal }) => new Promise<string>((_resolve, reject) => {
        signal.addEventListener('abort', () => { notifyAborted(); reject(new Error('cancelled')) }, { once: true })
        notifyStarted()
      })) })
    const controller = new AbortController()
    const pending = fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request), signal: controller.signal })
    await started
    controller.abort()
    await expect(pending).rejects.toThrow()
    await aborted
  })

  it('does not reveal provider errors, approved text, or credentials in error responses', async () => {
    const url = await serve({ privateChatEnabled: true,
      privateChatProvider: provider(async () => { throw new Error(`SECRET_KEY ${request.turn.quote}`) }) })
    const result = await post(url)
    expect(result.response.status).toBe(503)
    expect(result.data.code).toBe('model_unavailable')
    expect(JSON.stringify(result.data)).not.toMatch(/SECRET_KEY|散步/)
  })
})
