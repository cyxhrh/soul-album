import { resolve } from 'node:path'
import { createSyntheticQuestionServer } from './http.js'
import {
  createQwenPrivateChatProviderFromEnv, createQwenPrivateQuestionProviderFromEnv,
  createQwenProviderFromEnv, createQwenDailyAlbumProviderFromEnv,
} from './qwen.js'
import { maxCallsFromEnv } from './config.js'

// This pilot is local-only; public paid-key deployment needs separate access control.
const host = '127.0.0.1'
const port = Number(process.env.SOUL_ALBUM_AI_PORT || '8787')
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('invalid server port')
}

const server = createSyntheticQuestionServer({
  provider: createQwenProviderFromEnv(),
  // A configured key never enables personal-record calls by itself.
  privateAiEnabled: process.env.SOUL_ALBUM_PRIVATE_AI_ENABLED === '1',
  privateProvider: process.env.SOUL_ALBUM_PRIVATE_AI_ENABLED === '1'
    ? createQwenPrivateQuestionProviderFromEnv()
    : undefined,
  privateChatEnabled: process.env.SOUL_ALBUM_PRIVATE_CHAT_ENABLED === '1',
  privateChatProvider: process.env.SOUL_ALBUM_PRIVATE_CHAT_ENABLED === '1'
    ? createQwenPrivateChatProviderFromEnv()
    : undefined,
  dailyAlbumProvider: process.env.SOUL_ALBUM_PRIVATE_CHAT_ENABLED === '1'
    ? createQwenDailyAlbumProviderFromEnv()
    : undefined,
  maxCalls: maxCallsFromEnv(process.env.SOUL_ALBUM_AI_MAX_CALLS),
  distDir: resolve(process.cwd(), 'dist'),
})
server.listen(port, host, () => {
  process.stdout.write(`渐知本地 AI 服务运行于 http://${host}:${port}\n`)
})
