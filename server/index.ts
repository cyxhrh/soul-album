import { resolve } from 'node:path'
import { createSyntheticQuestionServer } from './http.js'
import { createQwenProviderFromEnv } from './qwen.js'
import { maxCallsFromEnv } from './config.js'

// This pilot is local-only; public paid-key deployment needs separate access control.
const host = '127.0.0.1'
const port = Number(process.env.SOUL_ALBUM_AI_PORT || '8787')
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('invalid server port')
}

const server = createSyntheticQuestionServer({
  provider: createQwenProviderFromEnv(),
  maxCalls: maxCallsFromEnv(process.env.SOUL_ALBUM_AI_MAX_CALLS),
  distDir: resolve(process.cwd(), 'dist'),
})
server.listen(port, host, () => {
  process.stdout.write(`心灵画册合成 AI 实验服务运行于 http://${host}:${port}\n`)
})
