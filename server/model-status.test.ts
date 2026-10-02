import { afterEach, describe, expect, it } from 'vitest'
import type { Server } from 'node:http'
import { createSyntheticQuestionServer, type PrivateChatProvider } from './http.js'

const servers: Server[] = []

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(resolve))))
})

async function serve(options: Parameters<typeof createSyntheticQuestionServer>[0] = {}) {
  const server = createSyntheticQuestionServer(options)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  servers.push(server)
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('missing test address')
  return `http://127.0.0.1:${address.port}`
}

function provider(onGenerate: () => void = () => {}): PrivateChatProvider {
  return {
    provider: 'qwen', id: 'qwen3.8-flash',
    generate: async () => {
      onGenerate()
      return JSON.stringify({ reply: '你好，我在。', nextQuestion: null, citations: [] })
    },
  }
}

describe('read-only local model status', () => {
  it('reports only a model identity when private chat is enabled, without calling it or exposing credentials', async () => {
    let calls = 0
    const configured = { ...provider(() => { calls += 1 }), secret: 'never-expose-this-key' }
    const base = await serve({ privateChatEnabled: true, privateChatProvider: configured })
    for (let index = 0; index < 2; index += 1) {
      const response = await fetch(`${base}/api/ai/model-status`)
      expect(response.status).toBe(200)
      expect(response.headers.get('content-type')).toBe('application/json; charset=utf-8')
      expect(response.headers.get('cache-control')).toBe('no-store')
      const body = await response.text()
      expect(JSON.parse(body)).toEqual({ status: 'ready', model: { provider: 'qwen', id: 'qwen3.8-flash' } })
      expect(body).not.toContain('never-expose-this-key')
    }
    expect(calls).toBe(0)
  })

  it('reports unavailable when chat is disabled or no provider exists', async () => {
    const bases = [
      await serve({ privateChatProvider: provider() }),
      await serve({ privateChatEnabled: true }),
    ]
    for (const base of bases) {
      const response = await fetch(`${base}/api/ai/model-status`)
      expect(await response.json()).toEqual({ status: 'unavailable', model: null })
    }
  })

  it('reports unavailable after the configured call budget is exhausted but keeps the model name', async () => {
    const base = await serve({ privateChatEnabled: true, privateChatProvider: provider(), maxCalls: 1 })
    const request = {
      turn: { kind: 'control', id: 'message-1', revision: 1, day: 1, quote: '你好' }, context: [],
    }
    const sent = await fetch(`${base}/api/ai/private-chat`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request),
    })
    expect(sent.status).toBe(200)
    const response = await fetch(`${base}/api/ai/model-status`)
    expect(await response.json()).toEqual({
      status: 'unavailable', model: { provider: 'qwen', id: 'qwen3.8-flash' },
    })
  })

  it('rejects foreign origins and writes, preserving the same loopback boundary as chat', async () => {
    const base = await serve({ privateChatEnabled: true, privateChatProvider: provider() })
    const endpoint = `${base}/api/ai/model-status`
    for (const response of [
      await fetch(endpoint, { headers: { Origin: 'https://other.example' } }),
      await fetch(endpoint, { headers: { Origin: 'http://localhost:9999' } }),
      await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }),
    ]) {
      expect(response.status).toBe(400)
      expect((await response.json()).code).toBe('invalid_request')
    }
  })
})
