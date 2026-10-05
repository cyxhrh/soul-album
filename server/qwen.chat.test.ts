import { describe, expect, it } from 'vitest'
import type { PrivateChatRequest } from '../shared/privateChat.js'
import { createQwenPrivateChatProviderFromEnv } from './qwen.js'

const env = {
  DASHSCOPE_API_KEY: 'test-secret',
  SOUL_ALBUM_QWEN_MODEL: 'qwen3.8-flash',
  SOUL_ALBUM_QWEN_BASE_URL: 'https://llm-test.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',
}
const request: PrivateChatRequest = {
  turn: { kind: 'entry', id: 'entry-2', revision: 9, day: 2, quote: '今天下班后走得慢一些。' },
  context: [{ kind: 'correction', id: 'correction-1', revision: 3, day: 1,
    quote: '我不是不喜欢散步，只是那天有点赶。' }],
  precedingAssistant: { reply: '原来是那天时间太赶。', nextQuestion: '今天想慢一点吗？' },
}

describe('Qwen private chat provider', () => {
  it('resolves the displayed opening for a short first answer without turning it into user facts', async () => {
    let messages: Array<{ role: string; content: string }> = []
    const fetcher: typeof fetch = async (_input, init) => {
      messages = JSON.parse(String(init?.body)).messages
      return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: {
        content: '{"reply":"慢慢聊。","nextQuestion":null,"citations":[]}',
      } }] }), { status: 200 })
    }
    await createQwenPrivateChatProviderFromEnv(env, fetcher)!.generate({
      request: { turn: { ...request.turn, quote: '有点累' }, context: [], openingId: 'morning' },
      signal: new AbortController().signal,
    })
    expect(JSON.parse(messages[1].content)).toMatchObject({
      turn: { quote: '有点累' }, context: [],
      opening: { greeting: '早上好呀 ☀️ 新的一天开始啦！', question: '今天有什么让你期待的安排？' },
    })
    expect(messages[0].content).toContain('语气跟随用户当前感受')
  })
  it('does not exist without server-held key and an approved endpoint', () => {
    expect(createQwenPrivateChatProviderFromEnv({})).toBeUndefined()
    expect(createQwenPrivateChatProviderFromEnv({ DASHSCOPE_API_KEY: 'test-secret' })).toBeUndefined()
    expect(() => createQwenPrivateChatProviderFromEnv({
      ...env, SOUL_ALBUM_QWEN_BASE_URL: 'https://untrusted.example/compatible-mode/v1',
    })).toThrow('invalid Qwen base URL')
  })

  it('sends only the selected snippets, day, kind and previous response, without local revisions', async () => {
    const requests: Array<{ url: string; init: RequestInit }> = []
    const fetcher: typeof fetch = async (input, init) => {
      requests.push({ url: String(input), init: init ?? {} })
      return new Response(JSON.stringify({ choices: [{
        finish_reason: 'stop', message: { role: 'assistant',
          content: '{"reply":"听起来今天自在一些。","nextQuestion":null,"citations":[]}' },
      }] }), { status: 200 })
    }
    const provider = createQwenPrivateChatProviderFromEnv(env, fetcher)!
    const output = await provider.generate({ request, signal: new AbortController().signal })
    expect(output).toContain('听起来今天自在一些。')
    expect(requests).toHaveLength(1)
    expect(requests[0].url).toBe(`${env.SOUL_ALBUM_QWEN_BASE_URL}/chat/completions`)
    expect(requests[0].init.headers).toMatchObject({ Authorization: 'Bearer test-secret' })
    const body = JSON.parse(String(requests[0].init.body)) as {
      messages: Array<{ role: string; content: string }>
      stream: boolean
      max_tokens: number
    }
    expect(body.stream).toBe(false)
    expect(body.max_tokens).toBe(1536)
    expect(body.messages.map((message) => message.role)).toEqual(['system', 'user'])
    expect(body.messages[0].content).toContain('日常对话伙伴')
    expect(body.messages[0].content).not.toContain(request.turn.quote)
    expect(JSON.parse(body.messages[1].content)).toEqual({
      turn: { kind: 'entry', id: 'entry-2', day: 2, quote: request.turn.quote },
      context: [{ kind: 'correction', id: 'correction-1', day: 1, quote: request.context[0].quote }],
      precedingAssistant: request.precedingAssistant,
    })
    expect(String(requests[0].init.body)).not.toMatch(/"revision"|scenarioVersion|confirmedContext|snippets/)
    expect(String(requests[0].init.body).split(request.turn.quote)).toHaveLength(2)
  })

  it('sends parseable null and question examples with output bounds in the system prompt', async () => {
    let system = ''
    const fetcher: typeof fetch = async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as {
        messages: Array<{ role: string; content: string }>
      }
      system = body.messages[0].content
      return new Response(JSON.stringify({ choices: [{
        finish_reason: 'stop', message: { role: 'assistant',
          content: '{"reply":"我听到了。","nextQuestion":null,"citations":[]}' },
      }] }), { status: 200 })
    }
    await createQwenPrivateChatProviderFromEnv(env, fetcher)!.generate({
      request, signal: new AbortController().signal,
    })
    const example = (label: string) => {
      const start = system.indexOf(label)
      expect(start).toBeGreaterThanOrEqual(0)
      const objectStart = system.indexOf('{', start)
      const end = system.indexOf('}。', objectStart)
      expect(end).toBeGreaterThan(objectStart)
      return JSON.parse(system.slice(objectStart, end + 1)) as Record<string, unknown>
    }
    expect(example('无追问和引用时')).toEqual({ reply: '我听到了。', nextQuestion: null, citations: [] })
    expect(example('需要追问和引用时')).toMatchObject({
      reply: '你刚补充了更准确的背景。',
      nextQuestion: '你愿意说说今天有什么不同吗？',
      citations: [{ id: '来源ID', quote: '原话中的连续片段' }],
    })
    expect(system).toContain('1–280 字')
    expect(system).toContain('6–100 字')
    expect(system).toContain('一个问号')
    expect(system).toContain('不能逐字核对时必须为 []')
    expect(system).not.toContain('"或null')
  })
})
