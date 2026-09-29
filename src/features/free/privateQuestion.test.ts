import { afterEach, describe, expect, it, vi } from 'vitest'
import { createBrowserLocalSession } from '../../domain/browserLocalSession'
import {
  privateAiAvailableOnThisHost, privateQuestionPreview, requestPrivateQuestion, validPrivateExcerpt,
} from './privateQuestion'

afterEach(() => vi.unstubAllGlobals())

function candidate() {
  const session = createBrowserLocalSession({
    dayOneDate: '2026-09-29', timezone: 'UTC', now: () => new Date('2026-09-29T09:00:00Z'),
  })
  session.sendMessage(1, '今天散步时看见一朵黄色的小花。', session.firstQuestionId)
  const question = session.displayNextQuestion(1)
  const preview = privateQuestionPreview(session.read(), question)
  if (!preview) throw new Error('test setup failed')
  return { session, preview }
}

describe('one-time private-question gate', () => {
  it('offers only a current cited rule question and allows verbatim redaction', () => {
    const { session, preview } = candidate()
    expect(privateQuestionPreview(session.read(), session.read().questions[0])).toBeNull()
    expect(preview.quote).toBe('今天散步时看见一朵黄色的小花。')
    expect(validPrivateExcerpt(preview.original, '散步时看见一朵黄色的小花')).toBe(true)
    expect(validPrivateExcerpt(preview.original, '我想让模型相信另一件事。')).toBe(false)
    session.editEntry(preview.entryCitation.id, '今天改写了这条记录。')
    expect(privateQuestionPreview(session.read(), session.read().questions.at(-1))).toBeNull()
  })

  it('blocks cloud traffic from the public static site', async () => {
    expect(privateAiAvailableOnThisHost('cyxhrh.github.io')).toBe(false)
    const { preview } = candidate()
    vi.stubGlobal('window', { location: { hostname: 'cyxhrh.github.io' } })
    const fetcher = vi.fn() as unknown as typeof fetch
    await expect(requestPrivateQuestion(preview, preview.quote, new AbortController().signal, fetcher))
      .rejects.toThrow('private request unavailable')
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('sends only the approved excerpt and rejects a mismatched citation', async () => {
    const { preview } = candidate()
    vi.stubGlobal('window', { location: { hostname: '127.0.0.1' } })
    const excerpt = '散步时看见一朵黄色的小花'
    const fetcher = vi.fn(async (_url: string, init: RequestInit) => {
      expect(JSON.parse(String(init.body))).toEqual({
        entry: { id: preview.entryCitation.id, revision: preview.entryCitation.revision, quote: excerpt },
      })
      expect(String(init.body)).not.toContain('今天散步时')
      return new Response(JSON.stringify({
        status: 'generated', question: '那朵黄色的小花让你想记下什么？',
        citations: [{ id: preview.entryCitation.id, quote: '错误引用' }],
        model: { provider: 'qwen', id: 'fake-qwen' }, generatedAt: '2026-09-29T09:00:00Z',
      }), { status: 200 })
    }) as unknown as typeof fetch
    await expect(requestPrivateQuestion(preview, excerpt, new AbortController().signal, fetcher))
      .rejects.toThrow('invalid citation')
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('does not adopt an unsafe question even if the citation text matches', async () => {
    const { preview } = candidate()
    vi.stubGlobal('window', { location: { hostname: 'localhost' } })
    const fetcher = (async () => new Response(JSON.stringify({
      status: 'generated', question: '你是不是患有焦虑症？',
      citations: [{ id: preview.entryCitation.id, quote: preview.quote }],
      model: { provider: 'qwen', id: 'fake-qwen' }, generatedAt: '2026-09-29T09:00:00Z',
    }), { status: 200 })) as typeof fetch
    await expect(requestPrivateQuestion(preview, preview.quote, new AbortController().signal, fetcher))
      .rejects.toThrow('invalid response')
  })
})
