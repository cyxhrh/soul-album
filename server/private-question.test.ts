import { afterEach, describe, expect, it } from 'vitest'
import { type Server } from 'node:http'
import {
  createSyntheticQuestionServer, type PrivateQuestionProvider,
} from './http.js'

const entry = { id: 'entry-123', revision: 2, quote: '今天走了很长一段路，回来觉得有点累。' }
const question = '走了很长一段路之后，你想怎样休息？'
const output = JSON.stringify({ question, citations: [{ id: entry.id, quote: entry.quote }] })
const body = JSON.stringify({ entry })
const servers: Server[] = []

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))))
})

function provider(generate: PrivateQuestionProvider['generate'] = async () => output): PrivateQuestionProvider {
  return { provider: 'qwen', id: 'fake-qwen', generate }
}

async function serve(options: {
  privateProvider?: PrivateQuestionProvider
  privateAiEnabled?: boolean
  maxCalls?: number
  maxPerMinute?: number
  timeoutMs?: number
} = {}) {
  const server = createSyntheticQuestionServer(options)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  servers.push(server)
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('missing test address')
  return `http://127.0.0.1:${address.port}/api/ai/private-question`
}

async function post(url: string, payload = body, headers: Record<string, string> = {}) {
  const response = await fetch(url, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: payload,
  })
  return { response, data: await response.json() as Record<string, unknown> }
}

describe('one-time private question endpoint', () => {
  it('stays disabled with a configured provider until explicitly enabled', async () => {
    let calls = 0
    const url = await serve({ privateProvider: provider(async () => { calls += 1; return output }) })
    const result = await post(url)
    expect(result.response.status).toBe(503)
    expect(result.response.headers.get('cache-control')).toBe('no-store')
    expect(result.data).toMatchObject({ status: 'error', code: 'model_not_configured' })
    expect(JSON.stringify(result.data)).not.toContain(entry.quote)
    expect(calls).toBe(0)
  })

  it('accepts exactly one bounded source and returns a citation to its complete quote', async () => {
    const inputs: unknown[] = []
    const url = await serve({
      privateAiEnabled: true,
      privateProvider: provider(async (input) => { inputs.push(input.entry); return output }),
    })
    const result = await post(url)
    expect(result.response.status).toBe(200)
    expect(result.data).toMatchObject({
      status: 'generated', question,
      citations: [{ id: entry.id, quote: entry.quote }],
      model: { provider: 'qwen', id: 'fake-qwen' },
    })
    expect(result.data).not.toHaveProperty('scenario')
    expect(new Date(result.data.generatedAt as string).toISOString()).toBe(result.data.generatedAt)
    expect(inputs).toEqual([entry])
  })

  it('rejects extra, duplicate, malformed, and oversized input without calling the model', async () => {
    let calls = 0
    const url = await serve({
      privateAiEnabled: true,
      privateProvider: provider(async () => { calls += 1; return output }),
    })
    const invalid = [
      JSON.stringify({ entry, history: [] }),
      JSON.stringify({ entry: { ...entry, history: [] } }),
      JSON.stringify({ entry: { ...entry, quote: ' ' } }),
      JSON.stringify({ entry: { ...entry, id: '../other' } }),
      JSON.stringify({ entry: { ...entry, revision: 0 } }),
      JSON.stringify({ entry: { ...entry, quote: 'x'.repeat(1001) } }),
      JSON.stringify({ entry: { ...entry, quote: 'x'.repeat(5_000) } }),
      `{"entry":${JSON.stringify(entry)},"entry":${JSON.stringify(entry)}}`,
      '{}', '[1]', 'not json',
    ]
    for (const payload of invalid) {
      const result = await post(url, payload)
      expect(result.response.status).toBe(400)
      expect(result.data.code).toBe('invalid_request')
      expect(JSON.stringify(result.data)).not.toContain(entry.quote)
    }
    expect(calls).toBe(0)
  })

  it('rejects foreign origins and a non-JSON content type before the provider', async () => {
    let calls = 0
    const url = await serve({
      privateAiEnabled: true,
      privateProvider: provider(async () => { calls += 1; return output }),
    })
    const foreign = await post(url, body, { Origin: 'https://untrusted.example' })
    expect(foreign.response.status).toBe(400)
    const plain = await post(url, body, { 'Content-Type': 'text/plain' })
    expect(plain.response.status).toBe(400)
    expect(calls).toBe(0)
  })

  it('rejects missing, shortened, or invented citations and unsafe questions', async () => {
    for (const candidate of [
      { question, citations: [{ id: entry.id, quote: '今天走了很长一段路' }] },
      { question, citations: [{ id: 'other', quote: entry.quote }] },
      { question, citations: [{ id: entry.id, quote: entry.quote }, { id: 'other', quote: '别的内容' }] },
      { question: '请上传你的全部记录？', citations: [{ id: entry.id, quote: entry.quote }] },
      { question, citations: [], extra: true },
    ]) {
      const url = await serve({
        privateAiEnabled: true,
        privateProvider: provider(async () => JSON.stringify(candidate)),
      })
      const result = await post(url)
      expect(result.response.status).toBe(502)
      expect(result.data.code).toBe('invalid_model_output')
      expect(JSON.stringify(result.data)).not.toContain(entry.quote)
    }
  })

  it('treats no reliable citation as no question', async () => {
    const url = await serve({
      privateAiEnabled: true,
      privateProvider: provider(async () => '{"noReliableCitation":true}'),
    })
    const result = await post(url)
    expect(result.response.status).toBe(422)
    expect(result.data.code).toBe('no_reliable_citation')
    expect(result.data).not.toHaveProperty('question')
  })

  it('makes only one attempt within a process cap and does not retry a timeout', async () => {
    let calls = 0
    const url = await serve({
      privateAiEnabled: true, maxCalls: 1, timeoutMs: 20,
      privateProvider: provider(async () => { calls += 1; return new Promise<string>(() => {}) }),
    })
    const first = await post(url)
    expect(first.response.status).toBe(504)
    expect(first.data.code).toBe('model_timeout')
    const second = await post(url)
    expect(second.response.status).toBe(429)
    expect(calls).toBe(1)
  })

  it('aborts an unfinished provider request when the client stops waiting', async () => {
    let notifyStarted!: () => void
    let notifyAborted!: () => void
    const started = new Promise<void>((resolve) => { notifyStarted = resolve })
    const aborted = new Promise<void>((resolve) => { notifyAborted = resolve })
    const url = await serve({
      privateAiEnabled: true,
      privateProvider: provider(({ signal }) => new Promise<string>((_resolve, reject) => {
        signal.addEventListener('abort', () => {
          notifyAborted()
          reject(new Error('client disconnected'))
        }, { once: true })
        notifyStarted()
      })),
    })
    const controller = new AbortController()
    const request = fetch(url, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body, signal: controller.signal,
    })
    await started
    controller.abort()
    await expect(request).rejects.toThrow()
    await aborted
  })

  it('never relays provider errors or the submitted quote', async () => {
    const url = await serve({
      privateAiEnabled: true,
      privateProvider: provider(async () => { throw new Error(`${entry.quote} SECRET_KEY PRIVATE_SENTINEL`) }),
    })
    const result = await post(url)
    expect(result.response.status).toBe(503)
    expect(result.data.code).toBe('model_unavailable')
    expect(JSON.stringify(result.data)).not.toMatch(/SECRET_KEY|PRIVATE_SENTINEL|今天走了/)
  })
})
