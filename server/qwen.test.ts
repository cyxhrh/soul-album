import { describe, expect, it } from 'vitest'
import { createQwenProviderFromEnv } from './qwen.js'

const snippets = [{ id: 'ahe-today-return', quote: '返程过零点，今天起床才觉得累。' }]

describe('Qwen OpenAI-compatible provider', () => {
  it('has no provider when the server has no key', () => {
    expect(createQwenProviderFromEnv({})).toBeUndefined()
  })

  it('has no provider until the key region and workspace endpoint are chosen', () => {
    expect(createQwenProviderFromEnv({ DASHSCOPE_API_KEY: 'test-secret' })).toBeUndefined()
  })

  it('sends only the fixed synthetic input with server-owned model configuration', async () => {
    const requests: { url: string; init: RequestInit }[] = []
    const fetcher: typeof fetch = async (input, init) => {
      requests.push({ url: String(input), init: init ?? {} })
      return new Response(JSON.stringify({
        choices: [{ message: { role: 'assistant', content: '{"question":"今天作息有什么变化？","citations":[]}' }, finish_reason: 'stop' }],
      }), { status: 200 })
    }
    const model = createQwenProviderFromEnv({
      DASHSCOPE_API_KEY: 'test-secret', SOUL_ALBUM_QWEN_MODEL: 'qwen-plus',
      SOUL_ALBUM_QWEN_BASE_URL: 'https://llm-test.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',
    }, fetcher)
    expect(model).toBeDefined()
    const output = await model!.generate({
      scenarioVersion: 'ahe-v1', snippets, confirmedContext: '这是合成资料。',
      signal: new AbortController().signal,
    })
    expect(output).toBe('{"question":"今天作息有什么变化？","citations":[]}')
    expect(requests).toHaveLength(1)
    expect(requests[0].url).toBe('https://llm-test.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/chat/completions')
    expect(requests[0].init.headers).toMatchObject({ Authorization: 'Bearer test-secret' })
    expect(requests[0].init.redirect).toBe('error')
    const body = JSON.parse(String(requests[0].init.body)) as Record<string, unknown>
    expect(body.model).toBe('qwen-plus')
    expect(body.stream).toBe(false)
    expect(body.enable_thinking).toBe(false)
    expect(body.response_format).toEqual({ type: 'json_object' })
    expect(JSON.stringify(body)).toContain('返程过零点，今天起床才觉得累。')
    expect(JSON.stringify(body)).not.toContain('PRIVATE_SENTINEL')
  })

  it('refuses an insecure configured URL before it can transmit a key', () => {
    expect(() => createQwenProviderFromEnv({
      DASHSCOPE_API_KEY: 'test-secret', SOUL_ALBUM_QWEN_BASE_URL: 'http://example.com/compatible-mode/v1',
    })).toThrow()
    expect(() => createQwenProviderFromEnv({
      DASHSCOPE_API_KEY: 'test-secret', SOUL_ALBUM_QWEN_BASE_URL: 'https://example.com/compatible-mode/v1',
    })).toThrow()
  })

  it('accepts only documented Model Studio compatible hosts, never arbitrary Aliyun services', () => {
    for (const url of [
      'https://dashscope.aliyuncs.com/compatible-mode/v1',
      'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
      'https://dashscope-us.aliyuncs.com/compatible-mode/v1',
      'https://cn-hongkong.dashscope.aliyuncs.com/compatible-mode/v1',
      'https://llm-test.ap-northeast-1.maas.aliyuncs.com/compatible-mode/v1',
      'https://trial.cn-hongkong.maas.aliyuncs.com/compatible-mode/v1',
    ]) {
      expect(createQwenProviderFromEnv({
        DASHSCOPE_API_KEY: 'test-secret', SOUL_ALBUM_QWEN_BASE_URL: url,
      })).toBeDefined()
    }
    for (const url of [
      'https://oss-cn-beijing.aliyuncs.com/compatible-mode/v1',
      'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',
      'https://coding.dashscope.aliyuncs.com/compatible-mode/v1',
      'https://llm-test.unknown-region.maas.aliyuncs.com/compatible-mode/v1',
      'https://evil.aliyuncs.com/compatible-mode/v1',
      'https://llm-test.cn-beijing.maas.aliyuncs.com/other/compatible-mode/v1',
    ]) {
      expect(() => createQwenProviderFromEnv({
        DASHSCOPE_API_KEY: 'test-secret', SOUL_ALBUM_QWEN_BASE_URL: url,
      })).toThrow()
    }
  })

  it('treats a truncated completion as invalid model output', async () => {
    const fetcher: typeof fetch = async () => new Response(JSON.stringify({
      choices: [{ message: { role: 'assistant', content: '{"question":"不完整"' }, finish_reason: 'length' }],
    }), { status: 200 })
    const model = createQwenProviderFromEnv({
      DASHSCOPE_API_KEY: 'test-secret',
      SOUL_ALBUM_QWEN_BASE_URL: 'https://llm-test.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',
    }, fetcher)!
    const result = await model.generate({
      scenarioVersion: 'ahe-v1', snippets, confirmedContext: '', signal: new AbortController().signal,
    })
    expect(result).toBe('')
  })
})
