import { afterEach, describe, expect, it } from 'vitest'
import type { Server } from 'node:http'
import { resolve } from 'node:path'
import { createSyntheticQuestionServer, type ModelProvider } from './http.js'

const question = '返程过零点后，今天的作息有什么变化？'
const quote = '返程过零点，今天起床才觉得累。'
const validModelOutput = JSON.stringify({
  question, citations: [{ id: 'ahe-today-return', quote }],
})

const servers: Server[] = []
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))))
})

async function serve(provider?: ModelProvider, options: {
  maxCalls?: number; maxPerMinute?: number; timeoutMs?: number; distDir?: string
} = {}) {
  const server = createSyntheticQuestionServer({ provider, ...options })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  servers.push(server)
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('missing test address')
  const url = `http://127.0.0.1:${address.port}/api/ai/synthetic-question`
  return { url, server }
}

async function post(url: string, body = '{"scenario":"ahe"}', contentType = 'application/json') {
  const response = await fetch(url, {
    method: 'POST', headers: { 'content-type': contentType }, body,
  })
  return { response, data: await response.json() as Record<string, unknown> }
}

function provider(output = validModelOutput): ModelProvider {
  return { provider: 'qwen', id: 'test-model', generate: async () => output }
}

describe('restricted synthetic model endpoint', () => {
  it('returns a safe unconfigured error and never pretends a model ran', async () => {
    const { url } = await serve()
    const { response, data } = await post(url)
    expect(response.status).toBe(503)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(data).toEqual({
      status: 'error', code: 'model_not_configured',
      message: '合成提问暂时不可用，请使用规则问题。',
    })
  })

  it('rejects all caller-supplied material before a provider call', async () => {
    let calls = 0
    const model: ModelProvider = {
      ...provider(), generate: async () => { calls += 1; return validModelOutput },
    }
    const { url } = await serve(model)
    for (const body of [
      '{"scenario":"ahe","prompt":"private"}', '{"scenario":"other"}',
      '{"scenario":1}', '[]', '{"scenario":"ahe","entries":[]}',
      '{"scenario":"ahe","answer":"private"}',
      '{"scenario":"ahe","scenario":"ahe"}',
    ]) {
      const { response, data } = await post(url, body)
      expect(response.status).toBe(400)
      expect(data.code).toBe('invalid_request')
      expect(JSON.stringify(data)).not.toContain('private')
    }
    const wrongType = await post(url, '{"scenario":"ahe"}', 'text/plain')
    expect(wrongType.response.status).toBe(400)
    const oversized = await post(url, JSON.stringify({ scenario: 'ahe', extra: 'x'.repeat(1000) }))
    expect(oversized.response.status).toBe(400)
    expect(calls).toBe(0)
  })

  it('returns a validated complete source quote and server-owned model identity', async () => {
    const { url } = await serve(provider())
    const { response, data } = await post(url)
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(data).toMatchObject({
      status: 'generated', scenario: 'ahe', scenarioVersion: 'ahe-v1', question,
      citations: [{ id: 'ahe-today-return', quote }],
      model: { provider: 'qwen', id: 'test-model' },
    })
    expect(new Date(data.generatedAt as string).toISOString()).toBe(data.generatedAt)
  })

  it('rejects invented or shortened citations even when the question is fluent', async () => {
    const { url } = await serve(provider(JSON.stringify({
      question, citations: [{ id: 'ahe-today-return', quote: '返程过零点' }],
    })))
    const result = await post(url)
    expect(result.response.status).toBe(502)
    expect(result.data.code).toBe('invalid_model_output')
    expect(JSON.stringify(result.data)).not.toContain('返程过零点')
  })

  it('reports no reliable citation without presenting a generated question', async () => {
    const { url } = await serve(provider('{"noReliableCitation":true}'))
    const result = await post(url)
    expect(result.response.status).toBe(422)
    expect(result.data.code).toBe('no_reliable_citation')
  })

  it('times out once without retrying the provider or exposing its output', async () => {
    let calls = 0
    const model: ModelProvider = {
      ...provider(), generate: async () => { calls += 1; return new Promise<string>(() => {}) },
    }
    const { url } = await serve(model, { timeoutMs: 20 })
    const result = await post(url)
    expect(result.response.status).toBe(504)
    expect(result.data.code).toBe('model_timeout')
    expect(calls).toBe(1)
  })

  it('caps model calls for this process', async () => {
    let calls = 0
    const model: ModelProvider = {
      ...provider(), generate: async () => { calls += 1; return validModelOutput },
    }
    const { url } = await serve(model, { maxCalls: 1 })
    expect((await post(url)).response.status).toBe(200)
    const second = await post(url)
    expect(second.response.status).toBe(429)
    expect(second.data.code).toBe('rate_limited')
    expect(calls).toBe(1)
  })

  it('limits repeated calls from one network address', async () => {
    const { url } = await serve(provider(), { maxPerMinute: 1 })
    expect((await post(url)).response.status).toBe(200)
    expect((await post(url)).response.status).toBe(429)
  })

  it('does not leak an upstream exception body or credential in its error', async () => {
    const model: ModelProvider = {
      ...provider(), generate: async () => { throw new Error('SECRET_KEY PRIVATE_SENTINEL provider details') },
    }
    const { url } = await serve(model)
    const result = await post(url)
    expect(result.response.status).toBe(503)
    expect(result.data.code).toBe('model_unavailable')
    expect(JSON.stringify(result.data)).not.toMatch(/SECRET_KEY|PRIVATE_SENTINEL|provider details/)
  })

  it('serves the built UI and restricted API from one origin', async () => {
    const { url } = await serve(undefined, { distDir: resolve('server/fixtures') })
    const site = await fetch(new URL('/', url))
    expect(site.status).toBe(200)
    expect(site.headers.get('content-type')).toContain('text/html')
    expect(await site.text()).toContain('心灵画册测试页')
    const api = await post(url)
    expect(api.response.status).toBe(503)
    expect(api.data.code).toBe('model_not_configured')
  })
})
