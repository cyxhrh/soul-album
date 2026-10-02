import type { MessageView, SpaceSnapshot } from '../../../backend/local/index.js'
import { isChatOpeningId } from '../../../shared/chatOpening.js'
import type {
  PrivateChatRequest, PrivateChatResponse, PrivateChatSource,
} from '../../../shared/privateChat.js'

export type { PrivateChatRequest, PrivateChatResponse, PrivateChatSource }

export interface PrivateChatTurn {
  /** The local user message this assistant reply follows. */
  messageId: string
  request: PrivateChatRequest
  response: PrivateChatResponse
  /** A later reply depends on an earlier one only when it was sent as context. */
  precedingMessageId?: string
}

export type PrivateChatErrorCode = 'invalid_request' | 'rate_limited' | 'model_not_configured' |
  'model_unavailable' | 'model_timeout' | 'invalid_model_output' | 'no_reliable_citation' | 'unknown'

/** The UI may act on this allowlisted code, never on a provider error body. */
export class PrivateChatRequestError extends Error {
  readonly code: PrivateChatErrorCode

  constructor(code: PrivateChatErrorCode) {
    super('private chat request failed')
    this.name = 'PrivateChatRequestError'
    this.code = code
  }
}

export function privateChatAvailableOnThisHost(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1'
}

export function excerptFromText(text: string): string {
  return Array.from(text.trim()).slice(0, 800).join('').trim()
}

export function validChatExcerpt(original: string, quote: string): boolean {
  const length = Array.from(quote).length
  return length >= 1 && length <= 800 && quote === quote.trim() &&
    !quote.includes('\0') && original.includes(quote)
}

export function sourceForMessage(
  snapshot: SpaceSnapshot, message: MessageView, day: number,
): PrivateChatSource | null {
  if (message.entryId) {
    const entry = snapshot.entries.find((item) => item.id === message.entryId)
    return entry ? {
      kind: 'entry', id: entry.id, revision: entry.revision, day,
      quote: excerptFromText(entry.text),
    } : null
  }
  const control = snapshot.messages.find((item) => item.id === message.id)
  return control?.controlText ? {
    kind: 'control', id: control.id, revision: control.revision, day,
    quote: excerptFromText(control.controlText),
  } : null
}

export function sourceIsCurrent(snapshot: SpaceSnapshot, source: PrivateChatSource): boolean {
  if (!Number.isInteger(source.revision) || !Number.isInteger(source.day) || source.day < 1) return false
  if (source.kind === 'entry') {
    const entry = snapshot.entries.find((item) => item.id === source.id)
    return !!entry && entry.revision === source.revision && validChatExcerpt(entry.text, source.quote)
  }
  if (source.kind === 'control') {
    const message = snapshot.messages.find((item) => item.id === source.id)
    return !!message && message.entryId === null && message.revision === source.revision &&
      !!message.controlText && validChatExcerpt(message.controlText, source.quote)
  }
  const correction = snapshot.observations.find((item) => item.id === source.id)
  return !!correction && correction.status === 'user_corrected' &&
    correction.revision === source.revision && validChatExcerpt(correction.text, source.quote)
}

/** Keep only replies whose entire approved input, including assistant history, is still valid. */
export function currentChatTurns(snapshot: SpaceSnapshot, turns: readonly PrivateChatTurn[]): PrivateChatTurn[] {
  const current = new Map<string, PrivateChatTurn>()
  for (const turn of turns) {
    const message = snapshot.messages.find((item) => item.id === turn.messageId)
    if (!message || !sourceIsCurrent(snapshot, turn.request.turn) ||
      !turn.request.context.every((source) => sourceIsCurrent(snapshot, source)) ||
      (turn.request.turn.kind === 'entry' && message.entryId !== turn.request.turn.id) ||
      (turn.request.turn.kind === 'control' && message.id !== turn.request.turn.id)) continue
    if (turn.precedingMessageId) {
      const previous = current.get(turn.precedingMessageId)
      if (!previous || !turn.request.precedingAssistant ||
        previous.response.reply !== turn.request.precedingAssistant.reply ||
        previous.response.nextQuestion !== turn.request.precedingAssistant.nextQuestion) continue
    }
    current.set(turn.messageId, turn)
  }
  return [...current.values()]
}

function validSource(source: PrivateChatSource): boolean {
  return !!source && ['entry', 'correction', 'control'].includes(source.kind) &&
    typeof source.id === 'string' && source.id.length > 0 && source.id.length <= 128 &&
    Number.isSafeInteger(source.revision) && source.revision >= 1 &&
    Number.isSafeInteger(source.day) && source.day >= 1 &&
    typeof source.quote === 'string' && source.quote === source.quote.trim() &&
    Array.from(source.quote).length >= 1 && Array.from(source.quote).length <= 800 &&
    !source.quote.includes('\0')
}

export function validChatRequest(request: PrivateChatRequest): boolean {
  const sources = [request.turn, ...request.context]
  return validSource(request.turn) && request.context.length <= 2 &&
    (request.openingId === undefined || (isChatOpeningId(request.openingId) &&
      request.context.length === 0 && !request.precedingAssistant)) &&
    request.context.every(validSource) &&
    new Set(sources.map((source) => source.id)).size === sources.length &&
    (!request.precedingAssistant || (
      request.precedingAssistant.reply.trim() === request.precedingAssistant.reply &&
      Array.from(request.precedingAssistant.reply).length >= 1 &&
      Array.from(request.precedingAssistant.reply).length <= 280 &&
      (request.precedingAssistant.nextQuestion === null ||
        Array.from(request.precedingAssistant.nextQuestion).length <= 100)))
}

function parseChatResponse(value: unknown, request: PrivateChatRequest): PrivateChatResponse {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid response')
  const result = value as Record<string, unknown>
  if (result.status !== 'generated' || typeof result.reply !== 'string' ||
    (result.nextQuestion !== null && typeof result.nextQuestion !== 'string') ||
    !Array.isArray(result.citations) || result.citations.length > 3 ||
    !result.model || typeof result.model !== 'object' || Array.isArray(result.model) ||
    typeof result.generatedAt !== 'string') throw new Error('invalid response')
  const reply = result.reply
  const nextQuestion = result.nextQuestion
  const length = Array.from(reply).length
  if (length < 1 || length > 280 || reply !== reply.trim() ||
    Array.from(reply).some((character) => {
      const code = character.charCodeAt(0)
      return (code < 32 && code !== 10) || code === 127
    })) {
    throw new Error('invalid response')
  }
  if (typeof nextQuestion === 'string' && (
    Array.from(nextQuestion).length < 6 || Array.from(nextQuestion).length > 100 ||
    nextQuestion !== nextQuestion.trim() || !/[？?]$/.test(nextQuestion) ||
    (nextQuestion.match(/[？?]/g)?.length ?? 0) !== 1 || /[\r\n]/.test(nextQuestion))) {
    throw new Error('invalid response')
  }
  const sources = [request.turn, ...request.context]
  const citations: Array<{ id: string; quote: string }> = []
  for (const item of result.citations) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('invalid citation')
    const citation = item as Record<string, unknown>
    if (typeof citation.id !== 'string' || typeof citation.quote !== 'string' ||
      citations.some((existing) => existing.id === citation.id) ||
      !sources.some((source) => source.id === citation.id && source.quote.includes(citation.quote as string)) ||
      !citation.quote) throw new Error('invalid citation')
    citations.push({ id: citation.id, quote: citation.quote })
  }
  const model = result.model as Record<string, unknown>
  if (model.provider !== 'qwen' || typeof model.id !== 'string' || !model.id) {
    throw new Error('invalid model')
  }
  return {
    status: 'generated', reply, nextQuestion: nextQuestion as string | null, citations,
    model: { provider: 'qwen', id: model.id }, generatedAt: result.generatedAt,
  }
}

const CHAT_ERROR_STATUSES: Record<Exclude<PrivateChatErrorCode, 'unknown'>, number> = {
  invalid_request: 400, rate_limited: 429, model_not_configured: 503,
  model_unavailable: 503, model_timeout: 504, invalid_model_output: 502,
  no_reliable_citation: 422,
}

/** Read only a small local error envelope; discard all unrecognized text. */
async function safeChatErrorCode(response: Response): Promise<PrivateChatErrorCode> {
  if (!response.body) return 'unknown'
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > 2_048) {
        await reader.cancel()
        return 'unknown'
      }
      chunks.push(value)
    }
  } catch {
    return 'unknown'
  } finally {
    reader.releaseLock()
  }
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length }
  let parsed: unknown
  try { parsed = JSON.parse(new TextDecoder().decode(bytes)) } catch { return 'unknown' }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return 'unknown'
  const value = parsed as Record<string, unknown>
  if (value.status !== 'error' || typeof value.code !== 'string' ||
    !Object.hasOwn(CHAT_ERROR_STATUSES, value.code)) return 'unknown'
  const code = value.code as Exclude<PrivateChatErrorCode, 'unknown'>
  return CHAT_ERROR_STATUSES[code] === response.status ? code : 'unknown'
}

export async function requestPrivateChat(
  request: PrivateChatRequest, signal: AbortSignal, fetcher: typeof fetch = fetch,
): Promise<PrivateChatResponse> {
  if (!privateChatAvailableOnThisHost(window.location.hostname) || !validChatRequest(request)) {
    throw new Error('private chat unavailable')
  }
  const response = await fetcher('/api/ai/private-chat', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request), signal, cache: 'no-store', credentials: 'omit', redirect: 'error',
  })
  if (!response.ok) throw new PrivateChatRequestError(await safeChatErrorCode(response))
  const raw = await response.text()
  if (raw.length > 12_000) throw new Error('response too large')
  let parsed: unknown
  try { parsed = JSON.parse(raw) } catch { throw new Error('invalid response') }
  return parseChatResponse(parsed, request)
}
