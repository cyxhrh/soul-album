import type { Question, SpaceSnapshot } from '../../../backend/local/types.js'

export interface PrivateQuestionPreview {
  expectedSpaceRevision: number
  questionId: string
  expectedQuestionRevision: number
  entryCitation: { id: string; revision: number }
  original: string
  quote: string
}

export interface PrivateQuestionProposal {
  question: string
  citations: [{ id: string; quote: string }]
  model: { provider: 'qwen'; id: string }
  generatedAt: string
}

const MAX_EXCERPT_LENGTH = 800

/** The static public site has no trusted private-model endpoint. */
export function privateAiAvailableOnThisHost(hostname: string): boolean {
  return hostname === '127.0.0.1' || hostname === 'localhost'
}

export function privateQuestionPreview(
  snapshot: SpaceSnapshot, question: Question | undefined,
): PrivateQuestionPreview | null {
  if (!question || question.status !== 'ready' || question.answeredByMessageId ||
    question.provenance !== 'local_rule' || snapshot.questions.at(-1)?.id !== question.id ||
    question.citations.length !== 1 || question.citations[0].kind !== 'entry') return null
  const citation = question.citations[0]
  const entry = snapshot.entries.find((item) => item.id === citation.id && item.revision === citation.revision)
  if (!entry) return null
  const quote = Array.from(entry.text).slice(0, MAX_EXCERPT_LENGTH).join('').trim()
  if (Array.from(quote).length < 6) return null
  return {
    expectedSpaceRevision: snapshot.revision,
    questionId: question.id,
    expectedQuestionRevision: question.revision,
    entryCitation: { id: entry.id, revision: entry.revision },
    original: entry.text,
    quote,
  }
}

/** The user's redaction must still be a verbatim part of the source at this revision. */
export function validPrivateExcerpt(original: string, quote: string): boolean {
  const length = Array.from(quote).length
  return quote === quote.trim() && length >= 6 && length <= MAX_EXCERPT_LENGTH &&
    original.includes(quote)
}

function proposalFromUnknown(value: unknown, preview: PrivateQuestionPreview, quote: string): PrivateQuestionProposal {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid response')
  const result = value as Record<string, unknown>
  if (result.status !== 'generated' || typeof result.question !== 'string' ||
    !Array.isArray(result.citations) || result.citations.length !== 1 ||
    !result.model || typeof result.model !== 'object' || Array.isArray(result.model) ||
    typeof result.generatedAt !== 'string') throw new Error('invalid response')
  const question = result.question
  const chars = Array.from(question)
  if (question !== question.trim() || chars.length < 6 || chars.length > 80 ||
    !/[？?]$/.test(question) || (question.match(/[？?]/g)?.length ?? 0) !== 1 ||
    /[\r\n]|https?:|www\.|```|<\/?\w|执行命令|上传|发送给|提供密码|验证码|银行卡|身份证号|抑郁症|焦虑症|人格障碍|心理疾病|诊断|治疗|你一定|你就是|肯定是/i.test(question)) {
    throw new Error('invalid response')
  }
  const citation = result.citations[0] as Record<string, unknown> | null
  if (!citation || citation.id !== preview.entryCitation.id || citation.quote !== quote) {
    throw new Error('invalid citation')
  }
  const model = result.model as Record<string, unknown>
  if (model.provider !== 'qwen' || typeof model.id !== 'string' || !model.id) {
    throw new Error('invalid model')
  }
  return {
    question, citations: [{ id: citation.id, quote: citation.quote } as { id: string; quote: string }],
    model: { provider: 'qwen', id: model.id }, generatedAt: result.generatedAt,
  }
}

export async function requestPrivateQuestion(
  preview: PrivateQuestionPreview, quote: string, signal: AbortSignal,
  fetcher: typeof fetch = fetch,
): Promise<PrivateQuestionProposal> {
  if (!privateAiAvailableOnThisHost(window.location.hostname) ||
    !validPrivateExcerpt(preview.original, quote)) throw new Error('private request unavailable')
  const response = await fetcher('/api/ai/private-question', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ entry: {
      id: preview.entryCitation.id, revision: preview.entryCitation.revision, quote,
    } }),
    signal,
    cache: 'no-store',
    credentials: 'omit',
    redirect: 'error',
  })
  if (!response.ok) throw new Error('model request failed')
  const raw = await response.text()
  if (raw.length > 8_000) throw new Error('response too large')
  let parsed: unknown
  try { parsed = JSON.parse(raw) } catch { throw new Error('invalid response') }
  return proposalFromUnknown(parsed, preview, quote)
}
