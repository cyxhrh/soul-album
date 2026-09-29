import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { extname, relative, resolve, sep } from 'node:path'
import {
  AHE_CONFIRMED_CONTEXT, AHE_SCENARIO_VERSION, AHE_SYNTHETIC_SNIPPETS,
} from '../shared/aheScenario.js'

const API_PATH = '/api/ai/synthetic-question'
const PRIVATE_API_PATH = '/api/ai/private-question'
const MAX_BODY_BYTES = 256
const MAX_PRIVATE_BODY_BYTES = 4_096
const MAX_PRIVATE_QUOTE_CHARS = 1_000
const MAX_MODEL_OUTPUT_CHARS = 8192
const SAFE_MESSAGE = '合成提问暂时不可用，请使用规则问题。'
const PRIVATE_SAFE_MESSAGE = '千问提问暂时不可用，请继续使用本地问题。'
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

function writeError(response: ServerResponse, status: number, code: ErrorCode, isPrivate = false): void {
  writeJson(response, status, {
    status: 'error', code,
    message: code === 'invalid_request' ? '请求格式无效。' :
      code === 'rate_limited' ? (isPrivate ? '千问提问次数已达上限，请稍后再试。' :
        '合成提问次数已达上限，请稍后再试。') :
        (isPrivate ? PRIVATE_SAFE_MESSAGE : SAFE_MESSAGE),
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

function isLoopbackHost(host: string | undefined): boolean {
  return typeof host === 'string' && /^(?:127\.0\.0\.1|localhost)(?::\d{1,5})?$/i.test(host)
}

function isLoopbackOrigin(origin: string | undefined): boolean {
  if (origin === undefined) return true
  try {
    const parsed = new URL(origin)
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
      (parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost') &&
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
    const isPrivate = request.url === PRIVATE_API_PATH
    if (request.url !== API_PATH && !isPrivate) {
      await serveStatic(request, response, options.distDir)
      return
    }
    if (!isLoopbackHost(request.headers.host) || !isLoopbackOrigin(request.headers.origin)) {
      writeError(response, 400, 'invalid_request', isPrivate)
      return
    }
    if (request.method !== 'POST' || request.headers['content-type'] !== 'application/json') {
      writeError(response, 400, 'invalid_request', isPrivate)
      return
    }
    let body: string | null
    try { body = await readBoundedBody(request, isPrivate ? MAX_PRIVATE_BODY_BYTES : MAX_BODY_BYTES) } catch {
      writeError(response, 400, 'invalid_request', isPrivate)
      return
    }
    const privateEntry = isPrivate ? parsePrivateRequest(body) : null
    if (isPrivate ? !privateEntry : !validRequest(body)) {
      writeError(response, 400, 'invalid_request', isPrivate)
      return
    }
    const model = isPrivate
      ? (options.privateAiEnabled === true ? options.privateProvider : undefined)
      : options.provider
    if (!model) {
      writeError(response, 503, 'model_not_configured', isPrivate)
      return
    }
    const now = Date.now()
    for (const [address, window] of windowByAddress) {
      if (now - window.start >= 60_000) windowByAddress.delete(address)
    }
    const address = request.socket.remoteAddress ?? 'unknown'
    const window = windowByAddress.get(address) ?? { start: now, count: 0 }
    if (modelCalls >= maxCalls || window.count >= maxPerMinute) {
      writeError(response, 429, 'rate_limited', isPrivate)
      return
    }
    window.count += 1
    windowByAddress.set(address, window)
    modelCalls += 1

    const controller = new AbortController()
    // A browser can stop waiting after consent. This cannot retract bytes already
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
        isPrivate
          ? options.privateProvider!.generate({ entry: privateEntry!, signal: controller.signal })
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
        writeError(response, 502, 'invalid_model_output', isPrivate)
        return
      }
      const result = isPrivate
        ? validatePrivateModelOutput(raw, privateEntry!)
        : validateModelOutput(raw)
      if (result === 'no_reliable_citation') {
        writeError(response, 422, result, isPrivate)
        return
      }
      if (!result) {
        writeError(response, 502, 'invalid_model_output', isPrivate)
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
      if (error instanceof ModelUpstreamHttpError && !timedOut && !isPrivate) {
        writeJson(response, 503, {
          status: 'error', code: 'model_unavailable', message: SAFE_MESSAGE,
          upstreamStatus: error.upstreamStatus,
          ...(error.upstreamCode ? { upstreamCode: error.upstreamCode } : {}),
        })
      } else {
        writeError(response, timedOut ? 504 : 503,
          timedOut ? 'model_timeout' : 'model_unavailable', isPrivate)
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
