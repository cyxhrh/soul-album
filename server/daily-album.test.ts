// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest'
import { request as httpRequest, type Server } from 'node:http'
import { createSyntheticQuestionServer, type DailyAlbumProvider, type SyntheticQuestionServerOptions } from './http.js'

const request = {
  date: '2026-09-30', messages: [
    { id: 'u1', role: 'user', text: '今天散步时觉得轻松。', recordedAt: '2026-09-30T09:00:00+08:00' },
    { id: 'a1', role: 'assistant', text: '你很喜欢散步。', recordedAt: '2026-09-30T09:00:01+08:00' },
    { id: 's1', role: 'system', text: '傍晚好。', recordedAt: '2026-09-30T09:00:02+08:00' },
  ],
}
const content = {
  title: '散步后的轻松', diary: '今天散步时，我觉得轻松。',
  portrait: { facts: ['今天散步了。'], feelings: ['用户说自己觉得轻松。'],
    observations: [{ text: '散步可能带来了片刻放松。', evidenceIds: ['u1'] }], uncertainties: ['还不知道散步的地点。'] },
}
const servers: Server[] = []
afterEach(async () => { await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve())))) })
const provider = (generate: DailyAlbumProvider['generate'] = async () => JSON.stringify(content)): DailyAlbumProvider =>
  ({ provider: 'qwen', id: 'fake', generate })
async function serve(options: SyntheticQuestionServerOptions = {}) {
  const server = createSyntheticQuestionServer(options)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  servers.push(server)
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('missing address')
  return `http://127.0.0.1:${address.port}/api/ai/daily-album`
}
async function post(url: string, value: unknown = request, headers: Record<string, string> = {}) {
  const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(value) })
  const body = await response.text()
  return { response, data: body ? JSON.parse(body) : {} }
}

describe('daily album endpoint', () => {
  it('returns a validated daily album with model metadata and full original input', async () => {
    const inputs: unknown[] = []
    const url = await serve({ privateChatEnabled: true, dailyAlbumProvider: provider(async ({ request }) => {
      inputs.push(request); return JSON.stringify(content)
    }) })
    const result = await post(url)
    expect(result.response.status).toBe(200)
    expect(result.response.headers.get('cache-control')).toBe('no-store')
    expect(result.data).toMatchObject({ ...content, status: 'generated', model: { provider: 'qwen', id: 'fake' } })
    expect(new Date(result.data.generatedAt).toISOString()).toBe(result.data.generatedAt)
    expect(inputs).toEqual([request])
  })

  it('uses the private chat switch and an independent daily provider', async () => {
    for (const options of [{ dailyAlbumProvider: provider() }, { privateChatEnabled: true },
      { privateAiEnabled: true, dailyAlbumProvider: provider() }]) {
      const result = await post(await serve(options))
      expect(result.response.status).toBe(503)
      expect(result.data.code).toBe('model_not_configured')
    }
  })

  it('rejects invalid dates, roles, IDs, timestamps and over-limit text before generation', async () => {
    let calls = 0
    const url = await serve({ privateChatEnabled: true, dailyAlbumProvider: provider(async () => { calls++; return JSON.stringify(content) }) })
    const message = request.messages[0]
    const invalid = [
      {}, { ...request, date: '2026-02-30' }, { ...request, date: '2026-9-30' },
      { ...request, messages: [] }, { ...request, messages: [request.messages[1]] },
      ...[{ role: 'tool' }, { id: '' }, { recordedAt: 'yesterday' }, { recordedAt: '2026-02-30T09:00:00Z' }, { revised: 'true' }, { text: '' }, { extra: true }]
        .map((change) => ({ ...request, messages: [{ ...message, ...change }] })),
      { ...request, messages: [message, message] },
      { ...request, messages: [{ ...message, text: '字'.repeat(30_001) }] },
      { ...request, messages: Array.from({ length: 201 }, (_, index) => ({ ...message, id: `u${index}` })) },
    ]
    for (const value of invalid) {
      const result = await post(url, value)
      expect(result.response.status).toBe(400)
      expect(result.data.code).toBe('invalid_request')
    }
    expect(calls).toBe(0)
  })

  it('preserves the full 30000-character input including its tail and Markdown', async () => {
    const input = { ...request, messages: [{ ...request.messages[0], text: '字'.repeat(29_975) + '\n```\n# 标题 <b>原话</b>\n尾部转折。' }] }
    expect(Array.from(input.messages[0].text)).toHaveLength(30_000)
    let received: unknown
    const url = await serve({ privateChatEnabled: true, dailyAlbumProvider: provider(async ({ request }) => {
      received = request; return JSON.stringify(content)
    }) })
    expect((await post(url, input)).response.status).toBe(200)
    expect(received).toEqual(input)
  })

  it('accepts 200 messages and counts astral characters without truncation', async () => {
    const input = { ...request, messages: Array.from({ length: 200 }, (_, index) => ({ ...request.messages[0], id: `u${index}`, text: '🌿'.repeat(150) })) }
    const url = await serve({ privateChatEnabled: true, dailyAlbumProvider: provider(async ({ request: received }) => {
      expect(received).toEqual(input); return JSON.stringify({ ...content, portrait: { ...content.portrait, observations: [] } })
    }) })
    expect((await post(url, input)).response.status).toBe(200)
  })

  it('rejects foreign origins, non-loopback hosts and non-JSON input', async () => {
    const url = await serve({ privateChatEnabled: true, dailyAlbumProvider: provider() })
    for (const headers of [{ Origin: 'https://example.com' }, { 'Content-Type': 'text/plain' }]) {
      expect((await post(url, request, headers)).response.status).toBe(400)
    }
    const status = await new Promise<number | undefined>((resolve, reject) => {
      const pending = httpRequest(url, { method: 'POST', headers: { Host: 'evil.example', 'Content-Type': 'application/json' } }, (response) => {
        response.resume()
        response.on('end', () => resolve(response.statusCode))
      })
      pending.on('error', reject)
      pending.end(JSON.stringify(request))
    })
    expect(status).toBe(400)
  })

  it('rejects invented, assistant or system evidence, duplicates and malformed output', async () => {
    const invalid = [
      ...[['missing'], ['a1'], ['s1'], [], ['u1', 'u1']].map((evidenceIds) => ({ ...content,
        portrait: { ...content.portrait, observations: [{ text: '暂定观察。', evidenceIds }] } })),
      { ...content, title: '字'.repeat(61) }, { ...content, diary: '字'.repeat(1001) },
      { ...content, diary: '' }, { ...content, diary: '<script>bad</script>' },
      { ...content, portrait: { ...content.portrait, facts: [1] } }, { ...content, extra: true },
    ]
    for (const output of invalid) {
      const result = await post(await serve({ privateChatEnabled: true, dailyAlbumProvider: provider(async () => JSON.stringify(output)) }))
      expect(result.response.status).toBe(502)
      expect(result.data.code).toBe('invalid_model_output')
    }
  })

  it('shares quota and timeout protection and never leaks provider errors', async () => {
    let aborted = false
    const url = await serve({ privateChatEnabled: true, maxCalls: 1, timeoutMs: 15,
      dailyAlbumProvider: provider(async ({ signal }) => { signal.addEventListener('abort', () => { aborted = true }); return new Promise(() => {}) }) })
    expect((await post(url)).data.code).toBe('model_timeout')
    expect(aborted).toBe(true)
    expect((await post(url)).response.status).toBe(429)
    const broken = await serve({ privateChatEnabled: true, dailyAlbumProvider: provider(async () => { throw new Error('SECRET_USER_TEXT') }) })
    const result = await post(broken)
    expect(result.response.status).toBe(503)
    expect(JSON.stringify(result.data)).not.toContain('SECRET_USER_TEXT')
  })
})
