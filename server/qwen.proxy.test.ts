import type { IncomingMessage } from 'node:http'
import { Readable } from 'node:stream'
import { describe, expect, it } from 'vitest'
import { readQwenProxyResponse } from './qwen.js'

function response(status: number, body: string): IncomingMessage {
  const stream = Readable.from([Buffer.from(body)]) as IncomingMessage
  stream.statusCode = status
  return stream
}

describe('Qwen custom HTTPS proxy response', () => {
  it('reads a bounded non-2xx JSON body for code extraction', async () => {
    const result = await readQwenProxyResponse(response(403, JSON.stringify({
      error: { code: 'Workspace.AccessDenied', message: 'PRIVATE_SENTINEL' },
    })))
    expect(result.ok).toBe(false)
    expect(result.status).toBe(403)
    expect(JSON.parse(await result.text())).toMatchObject({
      error: { code: 'Workspace.AccessDenied' },
    })
  })

  it('drops a non-2xx body over the error limit but keeps its status', async () => {
    const result = await readQwenProxyResponse(response(403, JSON.stringify({
      code: 'Model.AccessDenied', padding: 'x'.repeat(5_000),
    })))
    expect(result.ok).toBe(false)
    expect(result.status).toBe(403)
    expect(await result.text()).toBe('')
  })
})
