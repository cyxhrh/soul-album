import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { extname, relative, resolve, sep } from 'node:path'
import {
  AHE_CONFIRMED_CONTEXT, AHE_SCENARIO_VERSION, AHE_SYNTHETIC_SNIPPETS,
} from '../shared/aheScenario.js'
import type { PrivateChatRequest, PrivateChatResponse, PrivateChatSource } from '../shared/privateChat.js'
import { isChatOpeningId } from '../shared/chatOpening.js'
import { MAX_DAILY_MESSAGES, MAX_DAILY_TEXT_CHARS,
  type DailyAlbumContent, type DailyAlbumRequest, type DailyAlbumResponse } from '../shared/dailyAlbum.js'

const API_PATH = '/api/ai/synthetic-question'
const PRIVATE_API_PATH = '/api/ai/private-question'
const PRIVATE_CHAT_PATH = '/api/ai/private-chat'
const DAILY_ALBUM_PATH = '/api/ai/daily-album'
const MODEL_STATUS_PATH = '/api/ai/model-status'
const MAX_BODY_BYTES = 256
const MAX_PRIVATE_BODY_BYTES = 4_096
const MAX_PRIVATE_CHAT_BODY_BYTES = 12_288
const MAX_DAILY_ALBUM_BODY_BYTES = 262_144
const MAX_PRIVATE_QUOTE_CHARS = 1_000
const MAX_MODEL_OUTPUT_CHARS = 8192
const SAFE_MESSAGE = '合成提问暂时不可用，请使用规则问题。'
const PRIVATE_SAFE_MESSAGE = '千问提问暂时不可用，请继续使用本地问题。'
const PRIVATE_CHAT_SAFE_MESSAGE = '千问对话暂时不可用，你的本地记录仍在。'
// Model Studio's documented error codes; never relay an arbitrary provider string.
const ALIBABA_ERROR_CODES = new Set([
  'AccessDenied', 'access_denied', 'AccessDenied.Unpurchased',
  'Model.AccessDenied', 'App.AccessDenied', 'Workspace.AccessDenied',
  'Endpoint.AccessDenied', 'AllocationQuota.FreeTierOnly',
  'Arrearage', 'InvalidApiKey', 'invalid_api_key',
])

export interface ModelProvider {
  provider: string
  id: string
  generate(input: {
    scenarioVersion: string
    snippets: readonly { id: string; quote: string }[]
    confirmedContext: string
    signal: AbortSignal
  }): Promise<string>
}

export interface PrivateQuestionEntry {
  id: string
  revision: number
  quote: string
}

export interface PrivateQuestionProvider {
  provider: 'qwen'
  id: string
  generate(input: { entry: PrivateQuestionEntry; signal: AbortSignal }): Promise<string>
}

export interface PrivateChatProvider {
  provider: 'qwen'
  id: string
  generate(input: { request: PrivateChatRequest; signal: AbortSignal }): Promise<string>
}

export interface DailyAlbumProvider {
  provider: string
  id: string
  generate(input: { request: DailyAlbumRequest; signal: AbortSignal }): Promise<string>
}

/** Carries only an upstream HTTP status and an allowlisted provider code. */
export class ModelUpstreamHttpError extends Error {
  readonly upstreamCode?: string

  constructor(readonly upstreamStatus: number, upstreamCode?: unknown) {
    super('model unavailable')
    if (typeof upstreamCode === 'string' && ALIBABA_ERROR_CODES.has(upstreamCode)) {
      this.upstreamCode = upstreamCode
    }
  }
}

export interface SyntheticQuestionServerOptions {
  provider?: ModelProvider
  /** A private provider alone cannot enable transmission of personal text. */
  privateProvider?: PrivateQuestionProvider
  privateAiEnabled?: boolean
  /** Private chat must be enabled independently of the one-question experiment. */
  privateChatProvider?: PrivateChatProvider
  privateChatEnabled?: boolean
  /** Shares the explicit private-chat opt-in; uses a separate generation contract. */
  dailyAlbumProvider?: DailyAlbumProvider
  maxCalls?: number
  maxPerMinute?: number
  timeoutMs?: number
  distDir?: string
}

type ErrorCode = 'invalid_request' | 'rate_limited' | 'model_not_configured' |
  'model_unavailable' | 'model_timeout' | 'invalid_model_output' | 'no_reliable_citation'

function writeJson(response: ServerResponse, status: number, payload: object): void {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  })
  response.end(JSON.stringify(payload))
}

function writeError(
  response: ServerResponse, status: number, code: ErrorCode, kind: 'synthetic' | 'question' | 'chat' | 'album' = 'synthetic',
): void {
  const unavailable = kind === 'album' ? '今天的画册暂时无法整理，完整记录仍在本机。' : kind === 'chat' ? PRIVATE_CHAT_SAFE_MESSAGE :
    kind === 'question' ? PRIVATE_SAFE_MESSAGE : SAFE_MESSAGE
  writeJson(response, status, {
    status: 'error', code,
    message: code === 'invalid_request' ? '请求格式无效。' :
      code === 'rate_limited' ? (kind === 'synthetic' ? '合成提问次数已达上限，请稍后再试。' :
        '千问调用次数已达上限，请稍后再试。') : unavailable,
  })
}

async function readBoundedBody(request: IncomingMessage, maxBytes = MAX_BODY_BYTES): Promise<string | null> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += bytes.length
    if (size > maxBytes) {
      chunks.length = 0
      continue
    }
    chunks.push(bytes)
  }
  return size > maxBytes ? null : Buffer.concat(chunks).toString('utf8')
}

function validRequest(body: string | null): boolean {
  // A literal one-field JSON object also rejects duplicate JSON keys that JSON.parse would hide.
  if (!body || !/^\s*\{\s*"scenario"\s*:\s*"ahe"\s*\}\s*$/.test(body)) return false
  try {
    const value: unknown = JSON.parse(body)
    return value !== null && typeof value === 'object' && !Array.isArray(value) &&
      Object.keys(value).length === 1 && 'scenario' in value && value.scenario === 'ahe'
  } catch {
    return false
  }
}

function parsePrivateRequest(body: string | null): PrivateQuestionEntry | null {
  if (!body) return null
  let parsed: unknown
  try { parsed = JSON.parse(body) } catch { return null }
  // Require the canonical encoding the frontend sends. This also rejects duplicate JSON keys.
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) ||
    JSON.stringify(parsed) !== body) return null
  const value = parsed as Record<string, unknown>
  if (Object.keys(value).length !== 1 || !value.entry || typeof value.entry !== 'object' ||
    Array.isArray(value.entry)) return null
  const entry = value.entry as Record<string, unknown>
  if (Object.keys(entry).length !== 3 || typeof entry.id !== 'string' ||
    typeof entry.quote !== 'string' || typeof entry.revision !== 'number') return null
  const chars = Array.from(entry.quote)
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(entry.id) ||
    !Number.isSafeInteger(entry.revision) || entry.revision < 1 ||
    chars.length < 6 || chars.length > MAX_PRIVATE_QUOTE_CHARS ||
    entry.quote.trim() !== entry.quote || /\0/.test(entry.quote)) return null
  return { id: entry.id, revision: entry.revision, quote: entry.quote }
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key))
}

function hasControlCharacter(value: string, allowInternalWhitespace = false): boolean {
  return Array.from(value).some((character) => {
    const code = character.charCodeAt(0)
    return code === 127 || (code < 32 &&
      !(allowInternalWhitespace && (code === 9 || code === 10 || code === 13)))
  })
}

/** A narrow backstop for explicit second-person diagnosis or fixed personality labels. */
function makesUnsupportedPersonalClaim(value: string): boolean {
  return /(?:你|您)(?:一定|可能|就是|是|属于|患有|得了|有).{0,12}(?:抑郁症|焦虑症|人格障碍|双相情感障碍|[^\s，。？！]{1,8}型人格)/.test(value)
}

function validChatReply(value: string): boolean {
  return value === value.trim() && Array.from(value).length >= 1 && Array.from(value).length <= 280 &&
    !hasControlCharacter(value) && !/https?:|www\.|```|<\/?\w/i.test(value) &&
    !/(?:请|把|上传|发送|提供).{0,12}(?:密码|验证码|银行卡|身份证|完整记录)/.test(value) &&
    !makesUnsupportedPersonalClaim(value)
}

function validChatQuestion(value: string | null): boolean {
  return value === null || (value === value.trim() && Array.from(value).length >= 6 &&
    Array.from(value).length <= 100 && /[？?]$/.test(value) &&
    (value.match(/[？?]/g)?.length ?? 0) === 1 && !hasControlCharacter(value) &&
    !/https?:|www\.|```|<\/?\w/i.test(value) &&
    !/(?:请|把|上传|发送|提供).{0,12}(?:密码|验证码|银行卡|身份证|完整记录)/.test(value) &&
    !makesUnsupportedPersonalClaim(value))
}

function parseChatSource(value: unknown): PrivateChatSource | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const source = value as Record<string, unknown>
  if (!hasOnlyKeys(source, ['kind', 'id', 'revision', 'day', 'quote']) ||
    typeof source.kind !== 'string' || !['entry', 'correction', 'control'].includes(source.kind) ||
    typeof source.id !== 'string' || typeof source.revision !== 'number' ||
    typeof source.day !== 'number' || typeof source.quote !== 'string') return null
  const quoteLength = Array.from(source.quote).length
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(source.id) ||
    !Number.isSafeInteger(source.revision) || source.revision < 1 ||
    !Number.isSafeInteger(source.day) || source.day < 1 || source.day > 36_500 ||
    quoteLength < 1 || quoteLength > 800 || source.quote !== source.quote.trim() ||
    hasControlCharacter(source.quote, true)) return null
  return source as unknown as PrivateChatSource
}

function parsePrivateChatRequest(body: string | null): PrivateChatRequest | null {
  if (!body) return null
  let parsed: unknown
  try { parsed = JSON.parse(body) } catch { return null }
  // Re-encoding also rejects duplicate JSON keys rather than silently accepting the last one.
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) ||
    JSON.stringify(parsed) !== body) return null
  const value = parsed as Record<string, unknown>
  if (!(hasOnlyKeys(value, ['turn', 'context']) ||
    hasOnlyKeys(value, ['turn', 'context', 'precedingAssistant']) ||
    hasOnlyKeys(value, ['turn', 'context', 'openingId'])) ||
    !Array.isArray(value.context) || value.context.length > 2) return null
  if (Object.hasOwn(value, 'openingId') &&
    (!isChatOpeningId(value.openingId) || value.context.length !== 0)) return null
  const turn = parseChatSource(value.turn)
  const context = value.context.map(parseChatSource)
  if (!turn || context.some((source) => !source)) return null
  const sources = [turn, ...context] as PrivateChatSource[]
  if (new Set(sources.map((source) => source.id)).size !== sources.length) return null
  if (Object.hasOwn(value, 'precedingAssistant')) {
    const prior = value.precedingAssistant
    if (!prior || typeof prior !== 'object' || Array.isArray(prior)) return null
    const assistant = prior as Record<string, unknown>
    if (!hasOnlyKeys(assistant, ['reply', 'nextQuestion']) || typeof assistant.reply !== 'string' ||
      !(assistant.nextQuestion === null || typeof assistant.nextQuestion === 'string') ||
      !validChatReply(assistant.reply) || !validChatQuestion(assistant.nextQuestion)) return null
  }
  return value as unknown as PrivateChatRequest
}

function parseDailyAlbumRequest(body: string | null): DailyAlbumRequest | null {
  if (!body) return null
  let parsed: unknown
  try { parsed = JSON.parse(body) } catch { return null }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) ||
    JSON.stringify(parsed) !== body) return null
  const value = parsed as Record<string, unknown>
  if (!hasOnlyKeys(value, ['date', 'messages']) || typeof value.date !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value.date) ||
    !Number.isFinite(Date.parse(value.date)) || new Date(value.date).toISOString().slice(0, 10) !== value.date ||
    !Array.isArray(value.messages) || value.messages.length < 1 || value.messages.length > MAX_DAILY_MESSAGES) return null
  const ids = new Set<string>()
  let chars = 0
  let hasUser = false
  for (const item of value.messages) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return null
    const message = item as Record<string, unknown>
    if (!(hasOnlyKeys(message, ['id', 'role', 'text', 'recordedAt']) ||
      hasOnlyKeys(message, ['id', 'role', 'text', 'recordedAt', 'revised'])) ||
      typeof message.id !== 'string' || message.id.length < 1 || message.id.length > 128 ||
      message.id !== message.id.trim() || hasControlCharacter(message.id) || ids.has(message.id) ||
      typeof message.role !== 'string' || !['user', 'assistant', 'system'].includes(message.role) ||
      typeof message.text !== 'string' || !message.text.trim() || hasControlCharacter(message.text, true) ||
      typeof message.recordedAt !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(message.recordedAt) ||
      !Number.isFinite(Date.parse(message.recordedAt)) ||
      new Date(message.recordedAt.slice(0, 10)).toISOString().slice(0, 10) !== message.recordedAt.slice(0, 10) ||
      (Object.hasOwn(message, 'revised') && typeof message.revised !== 'boolean')) return null
    chars += Array.from(message.text).length
    if (chars > MAX_DAILY_TEXT_CHARS) return null
    ids.add(message.id)
    hasUser ||= message.role === 'user'
  }
  return hasUser ? value as unknown as DailyAlbumRequest : null
}

function validateDailyAlbumOutput(raw: string, request: DailyAlbumRequest): DailyAlbumContent | null {
  if (raw.length > MAX_MODEL_OUTPUT_CHARS) return null
  let parsed: unknown
  try { parsed = JSON.parse(raw) } catch { return null }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
  const value = parsed as Record<string, unknown>
  const text = (item: unknown, max: number): item is string => typeof item === 'string' &&
    item === item.trim() && Array.from(item).length >= 1 && Array.from(item).length <= max &&
    !hasControlCharacter(item, true) && !/https?:|www\.|```|<\/?\w/i.test(item) &&
    !makesUnsupportedPersonalClaim(item)
  if (!hasOnlyKeys(value, ['title', 'diary', 'portrait']) || !text(value.title, 60) ||
    !text(value.diary, 1000) || !value.portrait || typeof value.portrait !== 'object' ||
    Array.isArray(value.portrait)) return null
  const portrait = value.portrait as Record<string, unknown>
  if (!hasOnlyKeys(portrait, ['facts', 'feelings', 'observations', 'uncertainties'])) return null
  for (const key of ['facts', 'feelings', 'uncertainties']) {
    const items = portrait[key]
    if (!Array.isArray(items) || items.length > 12 || !items.every((item) => text(item, 300))) return null
  }
  if (!Array.isArray(portrait.observations) || portrait.observations.length > 12) return null
  const userIds = new Set(request.messages.filter((message) => message.role === 'user').map((message) => message.id))
  for (const item of portrait.observations) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return null
    const observation = item as Record<string, unknown>
    if (!hasOnlyKeys(observation, ['text', 'evidenceIds']) || !text(observation.text, 300) ||
      !Array.isArray(observation.evidenceIds) || observation.evidenceIds.length < 1 ||
      observation.evidenceIds.length > 12 ||
      !observation.evidenceIds.every((id) => typeof id === 'string' && userIds.has(id)) ||
      new Set(observation.evidenceIds).size !== observation.evidenceIds.length) return null
  }
  return value as unknown as DailyAlbumContent
}

function isLoopbackHost(host: string | undefined): boolean {
  return typeof host === 'string' && /^(?:127\.0\.0\.1|localhost)(?::\d{1,5})?$/i.test(host)
}

function isSameLoopbackOrigin(origin: string | undefined, host: string | undefined): boolean {
  if (origin === undefined) return true
  if (!host) return false
  try {
    const parsed = new URL(origin)
    return parsed.protocol === 'http:' &&
      (parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost') &&
      parsed.origin.toLowerCase() === `http://${host.toLowerCase()}` &&
      origin.toLowerCase() === parsed.origin.toLowerCase() &&
      !parsed.username && !parsed.password && parsed.pathname === '/' &&
      !parsed.search && !parsed.hash
  } catch {
    return false
  }
}

type ValidQuestion = { question: string; citations: { id: string; quote: string }[] }

function validateModelOutput(raw: string): ValidQuestion | 'no_reliable_citation' | null {
  if (raw.length > MAX_MODEL_OUTPUT_CHARS) return null
  let parsed: unknown
  try { parsed = JSON.parse(raw) } catch { return null }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
  const value = parsed as Record<string, unknown>
  if (Object.keys(value).length === 1 && value.noReliableCitation === true) {
    return 'no_reliable_citation'
  }
  if (Object.keys(value).length !== 2 || typeof value.question !== 'string' ||
    !Array.isArray(value.citations)) return null
  const question = value.question.trim()
  const chars = Array.from(question)
  if (question !== value.question || chars.length < 6 || chars.length > 80 ||
    !/[？?]$/.test(question) || (question.match(/[？?]/g)?.length ?? 0) !== 1 ||
    /[\r\n]|https?:|www\.|```|<\/?\w|执行命令|上传资料|调用工具|抑郁症|焦虑症|人格障碍|心理疾病|诊断|治疗|你一定|你就是|肯定是/i.test(question)) {
    return null
  }
  if (value.citations.length === 0) return 'no_reliable_citation'
  if (value.citations.length > 3) return null
  const snippets = new Map<string, string>(AHE_SYNTHETIC_SNIPPETS.map((item) => [item.id, item.quote]))
  const citations: { id: string; quote: string }[] = []
  for (const citation of value.citations) {
    if (!citation || typeof citation !== 'object' || Array.isArray(citation)) return null
    const record = citation as Record<string, unknown>
    if (Object.keys(record).length !== 2 || typeof record.id !== 'string' ||
      typeof record.quote !== 'string' || snippets.get(record.id) !== record.quote ||
      citations.some((item) => item.id === record.id)) return null
    citations.push({ id: record.id, quote: record.quote })
  }
  return { question, citations }
}

function validatePrivateModelOutput(
  raw: string, entry: PrivateQuestionEntry,
): ValidQuestion | 'no_reliable_citation' | null {
  if (raw.length > MAX_MODEL_OUTPUT_CHARS) return null
  let parsed: unknown
  try { parsed = JSON.parse(raw) } catch { return null }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
  const value = parsed as Record<string, unknown>
  if (Object.keys(value).length === 1 && value.noReliableCitation === true) {
    return 'no_reliable_citation'
  }
  if (Object.keys(value).length !== 2 || typeof value.question !== 'string' ||
    !Array.isArray(value.citations)) return null
  const question = value.question.trim()
  const chars = Array.from(question)
  if (question !== value.question || chars.length < 6 || chars.length > 80 ||
    !/[？?]$/.test(question) || (question.match(/[？?]/g)?.length ?? 0) !== 1 ||
    /[\r\n]|https?:|www\.|```|<\/?\w|执行命令|上传|发送给|提供密码|验证码|银行卡|身份证号|抑郁症|焦虑症|人格障碍|心理疾病|诊断|治疗|你一定|你就是|肯定是/i.test(question)) {
    return null
  }
  if (value.citations.length === 0) return 'no_reliable_citation'
  if (value.citations.length !== 1) return null
  const citation: unknown = value.citations[0]
  if (!citation || typeof citation !== 'object' || Array.isArray(citation)) return null
  const source = citation as Record<string, unknown>
  if (Object.keys(source).length !== 2 || source.id !== entry.id ||
    source.quote !== entry.quote) return null
  return { question, citations: [{ id: entry.id, quote: entry.quote }] }
}

function validatePrivateChatOutput(
  raw: string, request: PrivateChatRequest,
): Pick<PrivateChatResponse, 'reply' | 'nextQuestion' | 'citations'> | null {
  if (raw.length > MAX_MODEL_OUTPUT_CHARS) return null
  let parsed: unknown
  try { parsed = JSON.parse(raw) } catch { return null }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
  const value = parsed as Record<string, unknown>
  if (!hasOnlyKeys(value, ['reply', 'nextQuestion', 'citations']) ||
    typeof value.reply !== 'string' ||
    !(value.nextQuestion === null || typeof value.nextQuestion === 'string') ||
    !Array.isArray(value.citations) || value.citations.length > 3) return null
  const reply = value.reply
  const nextQuestion = value.nextQuestion
  if (!validChatReply(reply) || !validChatQuestion(nextQuestion)) return null
  const sources = new Map([request.turn, ...request.context].map((source) => [source.id, source.quote]))
  const citations: Array<{ id: string; quote: string }> = []
  for (const citation of value.citations) {
    if (!citation || typeof citation !== 'object' || Array.isArray(citation)) return null
    const record = citation as Record<string, unknown>
    if (!hasOnlyKeys(record, ['id', 'quote']) || typeof record.id !== 'string' ||
      typeof record.quote !== 'string' || !record.quote.trim() ||
      !sources.get(record.id)?.includes(record.quote) ||
      citations.some((item) => item.id === record.id)) return null
    citations.push({ id: record.id, quote: record.quote })
  }
  return { reply, nextQuestion: nextQuestion as string | null, citations }
}

const mimeTypes: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.json': 'application/json; charset=utf-8',
}

async function serveStatic(request: IncomingMessage, response: ServerResponse, distDir?: string) {
  if (!distDir || request.method !== 'GET') {
    response.writeHead(404, { 'Cache-Control': 'no-store' })
    response.end()
    return
  }
  let pathname: string
  try { pathname = decodeURIComponent(new URL(request.url ?? '/', 'http://local.invalid').pathname) } catch {
    response.writeHead(400)
    response.end()
    return
  }
  if (pathname.includes('\0') || pathname.includes('\\')) {
    response.writeHead(404)
    response.end()
    return
  }
  const root = resolve(distDir)
  const file = resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname))
  const local = relative(root, file)
  if (local.startsWith('..' + sep) || local === '..' || local.startsWith(sep)) {
    response.writeHead(404)
    response.end()
    return
  }
  try {
    const metadata = await stat(file)
    if (!metadata.isFile()) throw new Error('not a file')
    const bytes = await readFile(file)
    response.writeHead(200, {
      'Content-Type': mimeTypes[extname(file).toLowerCase()] ?? 'application/octet-stream',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
    })
    response.end(bytes)
  } catch {
    response.writeHead(404, { 'Cache-Control': 'no-store' })
    response.end()
  }
}

/** Runs restricted local AI routes and optionally serves the built frontend from the same origin. */
export function createSyntheticQuestionServer(options: SyntheticQuestionServerOptions = {}): Server {
  let modelCalls = 0
  const windowByAddress = new Map<string, { start: number; count: number }>()
  const maxCalls = options.maxCalls ?? 30
  const maxPerMinute = options.maxPerMinute ?? 6
  const timeoutMs = options.timeoutMs ?? 25_000

  const server = createServer(async (request, response) => {
    const isModelStatus = request.url === MODEL_STATUS_PATH
    const isPrivate = request.url === PRIVATE_API_PATH
    const isChat = request.url === PRIVATE_CHAT_PATH
    const isAlbum = request.url === DAILY_ALBUM_PATH
    const kind = isAlbum ? 'album' : isChat ? 'chat' : isPrivate ? 'question' : 'synthetic'
    if (request.url !== API_PATH && !isPrivate && !isChat && !isAlbum && !isModelStatus) {
      await serveStatic(request, response, options.distDir)
      return
    }
    if (!isLoopbackHost(request.headers.host) ||
      !isSameLoopbackOrigin(request.headers.origin, request.headers.host)) {
      writeError(response, 400, 'invalid_request', kind)
      return
    }
    if (isModelStatus) {
      if (request.method !== 'GET') {
        writeError(response, 400, 'invalid_request', kind)
        return
      }
      const chatProvider = options.privateChatEnabled === true ? options.privateChatProvider : undefined
      writeJson(response, 200, {
        status: chatProvider && modelCalls < maxCalls ? 'ready' : 'unavailable',
        model: chatProvider ? { provider: chatProvider.provider, id: chatProvider.id } : null,
      })
      return
    }
    if (request.method !== 'POST' || request.headers['content-type'] !== 'application/json') {
      writeError(response, 400, 'invalid_request', kind)
      return
    }
    let body: string | null
    try {
      body = await readBoundedBody(request,
        isAlbum ? MAX_DAILY_ALBUM_BODY_BYTES : isChat ? MAX_PRIVATE_CHAT_BODY_BYTES : isPrivate ? MAX_PRIVATE_BODY_BYTES : MAX_BODY_BYTES)
    } catch {
      writeError(response, 400, 'invalid_request', kind)
      return
    }
    const privateEntry = isPrivate ? parsePrivateRequest(body) : null
    const chatRequest = isChat ? parsePrivateChatRequest(body) : null
    const albumRequest = isAlbum ? parseDailyAlbumRequest(body) : null
    if (isAlbum ? !albumRequest : isChat ? !chatRequest : isPrivate ? !privateEntry : !validRequest(body)) {
      writeError(response, 400, 'invalid_request', kind)
      return
    }
    const model = isAlbum ? (options.privateChatEnabled === true ? options.dailyAlbumProvider : undefined) : isChat
      ? (options.privateChatEnabled === true ? options.privateChatProvider : undefined)
      : isPrivate ? (options.privateAiEnabled === true ? options.privateProvider : undefined)
        : options.provider
    if (!model) {
      writeError(response, 503, 'model_not_configured', kind)
      return
    }
    const now = Date.now()
    for (const [address, window] of windowByAddress) {
      if (now - window.start >= 60_000) windowByAddress.delete(address)
    }
    const address = request.socket.remoteAddress ?? 'unknown'
    const window = windowByAddress.get(address) ?? { start: now, count: 0 }
    if (modelCalls >= maxCalls || window.count >= maxPerMinute) {
      writeError(response, 429, 'rate_limited', kind)
      return
    }
    window.count += 1
    windowByAddress.set(address, window)
    modelCalls += 1

    const controller = new AbortController()
    // A browser can stop waiting after sending. This cannot retract bytes already
    // sent upstream, but it should stop an unfinished provider request if possible.
    const onClientClose = () => {
      if (!response.writableEnded) controller.abort()
    }
    response.once('close', onClientClose)
    let timedOut = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        timedOut = true
        controller.abort()
        reject(new Error('model timeout'))
      }, timeoutMs)
    })
    try {
      const raw = await Promise.race([
        isAlbum ? options.dailyAlbumProvider!.generate({ request: albumRequest!, signal: controller.signal })
          : isChat ? options.privateChatProvider!.generate({ request: chatRequest!, signal: controller.signal })
          : isPrivate ? options.privateProvider!.generate({ entry: privateEntry!, signal: controller.signal })
            : options.provider!.generate({
              scenarioVersion: AHE_SCENARIO_VERSION,
              snippets: AHE_SYNTHETIC_SNIPPETS,
              confirmedContext: AHE_CONFIRMED_CONTEXT,
              signal: controller.signal,
            }),
        timeout,
      ])
      if (response.destroyed) return
      if (typeof raw !== 'string') {
        writeError(response, 502, 'invalid_model_output', kind)
        return
      }
      if (isAlbum) {
        const result = validateDailyAlbumOutput(raw, albumRequest!)
        if (!result) {
          writeError(response, 502, 'invalid_model_output', kind)
          return
        }
        writeJson(response, 200, {
          status: 'generated', ...result,
          model: { provider: model.provider, id: model.id }, generatedAt: new Date().toISOString(),
        } satisfies DailyAlbumResponse)
        return
      }
      if (isChat) {
        const result = validatePrivateChatOutput(raw, chatRequest!)
        if (!result) {
          writeError(response, 502, 'invalid_model_output', kind)
          return
        }
        writeJson(response, 200, {
          status: 'generated', ...result,
          model: { provider: options.privateChatProvider!.provider, id: model.id },
          generatedAt: new Date().toISOString(),
        } satisfies PrivateChatResponse)
        return
      }
      const result = isPrivate
        ? validatePrivateModelOutput(raw, privateEntry!)
        : validateModelOutput(raw)
      if (result === 'no_reliable_citation') {
        writeError(response, 422, result, kind)
        return
      }
      if (!result) {
        writeError(response, 502, 'invalid_model_output', kind)
        return
      }
      writeJson(response, 200, isPrivate ? {
        status: 'generated', question: result.question, citations: result.citations,
        model: { provider: model.provider, id: model.id }, generatedAt: new Date().toISOString(),
      } : {
        status: 'generated', scenario: 'ahe', scenarioVersion: AHE_SCENARIO_VERSION,
        question: result.question, citations: result.citations,
        model: { provider: model.provider, id: model.id }, generatedAt: new Date().toISOString(),
      })
    } catch (error) {
      if (response.destroyed) return
      if (error instanceof ModelUpstreamHttpError && !timedOut && kind === 'synthetic') {
        writeJson(response, 503, {
          status: 'error', code: 'model_unavailable', message: SAFE_MESSAGE,
          upstreamStatus: error.upstreamStatus,
          ...(error.upstreamCode ? { upstreamCode: error.upstreamCode } : {}),
        })
      } else {
        writeError(response, timedOut ? 504 : 503,
          timedOut ? 'model_timeout' : 'model_unavailable', kind)
      }
    } finally {
      if (timer) clearTimeout(timer)
      response.off('close', onClientClose)
    }
  })
  server.requestTimeout = 10_000
  server.headersTimeout = 10_000
  return server
}
