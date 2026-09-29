import { expect, it } from 'vitest'
import { createServer as createViteServer } from 'vite'
import { createSyntheticQuestionServer } from './http.js'

it('blocks another localhost page before the paid private-chat provider', async () => {
  let calls = 0
  const backend = createSyntheticQuestionServer({
    privateChatEnabled: true,
    privateChatProvider: {
      provider: 'qwen', id: 'fake-qwen',
      generate: async () => {
        calls += 1
        return JSON.stringify({ reply: '我听到了。', nextQuestion: null, citations: [] })
      },
    },
  })
  const forwardedHeaders: Array<{ host: string | undefined; origin: string | undefined }> = []
  backend.on('request', (request) => {
    forwardedHeaders.push({ host: request.headers.host, origin: request.headers.origin })
  })
  await new Promise<void>((resolve) => backend.listen(0, '127.0.0.1', resolve))
  const backendAddress = backend.address()
  if (!backendAddress || typeof backendAddress === 'string') throw new Error('missing backend address')

  const vite = await createViteServer({
    server: {
      host: '127.0.0.1', port: 0, strictPort: true,
      proxy: { '/api': { target: `http://127.0.0.1:${backendAddress.port}`, changeOrigin: false } },
    },
    logLevel: 'silent',
  })
  try {
    await vite.listen()
    const viteAddress = vite.httpServer?.address()
    if (!viteAddress || typeof viteAddress === 'string') throw new Error('missing Vite address')
    const uiOrigin = `http://127.0.0.1:${viteAddress.port}`
    const endpoint = `${uiOrigin}/api/ai/private-chat`
    const foreignOrigin = 'http://localhost:9999'
    const body = JSON.stringify({
      turn: { kind: 'control', id: 'message-1', revision: 1, day: 1, quote: '你好' },
      context: [],
    })

    const preflight = await fetch(endpoint, {
      method: 'OPTIONS', headers: {
        Origin: foreignOrigin,
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'content-type',
      },
    })
    expect(preflight.headers.get('access-control-allow-origin')).toBeNull()
    expect(calls).toBe(0)

    const foreignPost = await fetch(endpoint, {
      method: 'POST', headers: { Origin: foreignOrigin, 'Content-Type': 'application/json' }, body,
    })
    expect(foreignPost.status).toBe(400)
    expect(calls).toBe(0)

    const sameOriginPost = await fetch(endpoint, {
      method: 'POST', headers: { Origin: uiOrigin, 'Content-Type': 'application/json' }, body,
    })
    expect(forwardedHeaders.at(-1)).toEqual({ host: `127.0.0.1:${viteAddress.port}`, origin: uiOrigin })
    expect(sameOriginPost.status).toBe(200)
    expect(calls).toBe(1)
  } finally {
    await vite.close()
    await new Promise<void>((resolve) => backend.close(resolve))
  }
})
