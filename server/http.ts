import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { extname, relative, resolve, sep } from 'node:path'
import {
  AHE_CONFIRMED_CONTEXT, AHE_SCENARIO_VERSION, AHE_SYNTHETIC_SNIPPETS,
} from '../shared/aheScenario.js'

const API_PATH = '/api/ai/synthetic-question'
const MAX_BODY_BYTES = 256
const MAX_MODEL_OUTPUT_CHARS = 8192
const SAFE_MESSAGE = '合成提问暂时不可用，请使用规则问题。'

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

export interface SyntheticQuestionServerOptions {
  provider?: ModelProvider
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

function writeError(response: ServerResponse, status: number, code: ErrorCode): void {
  writeJson(response, status, {
    status: 'error', code,
    message: code === 'invalid_request' ? '请求格式无效。' :
      code === 'rate_limited' ? '合成提问次数已达上限，请稍后再试。' : SAFE_MESSAGE,
  })
}

async function readBoundedBody(request: IncomingMessage): Promise<string | null> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += bytes.length
    if (size > MAX_BODY_BYTES) {
      chunks.length = 0
      continue
    }
    chunks.push(bytes)
  }
  return size > MAX_BODY_BYTES ? null : Buffer.concat(chunks).toString('utf8')
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

/** Runs a single restricted experiment and optionally serves the built frontend from the same origin. */
export function createSyntheticQuestionServer(options: SyntheticQuestionServerOptions = {}): Server {
  let modelCalls = 0
  const windowByAddress = new Map<string, { start: number; count: number }>()
  const maxCalls = options.maxCalls ?? 30
  const maxPerMinute = options.maxPerMinute ?? 6
  const timeoutMs = options.timeoutMs ?? 10_000

  const server = createServer(async (request, response) => {
    if (request.url !== API_PATH) {
      await serveStatic(request, response, options.distDir)
      return
    }
    if (request.method !== 'POST' || request.headers['content-type'] !== 'application/json') {
      writeError(response, 400, 'invalid_request')
      return
    }
    let body: string | null
    try { body = await readBoundedBody(request) } catch {
      writeError(response, 400, 'invalid_request')
      return
    }
    if (!validRequest(body)) {
      writeError(response, 400, 'invalid_request')
      return
    }
    const model = options.provider
    if (!model) {
      writeError(response, 503, 'model_not_configured')
      return
    }
    const now = Date.now()
    for (const [address, window] of windowByAddress) {
      if (now - window.start >= 60_000) windowByAddress.delete(address)
    }
    const address = request.socket.remoteAddress ?? 'unknown'
    const window = windowByAddress.get(address) ?? { start: now, count: 0 }
    if (modelCalls >= maxCalls || window.count >= maxPerMinute) {
      writeError(response, 429, 'rate_limited')
      return
    }
    window.count += 1
    windowByAddress.set(address, window)
    modelCalls += 1

    const controller = new AbortController()
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
      const raw = await Promise.race([model.generate({
        scenarioVersion: AHE_SCENARIO_VERSION,
        snippets: AHE_SYNTHETIC_SNIPPETS,
        confirmedContext: AHE_CONFIRMED_CONTEXT,
        signal: controller.signal,
      }), timeout])
      if (typeof raw !== 'string') {
        writeError(response, 502, 'invalid_model_output')
        return
      }
      const result = validateModelOutput(raw)
      if (result === 'no_reliable_citation') {
        writeError(response, 422, result)
        return
      }
      if (!result) {
        writeError(response, 502, 'invalid_model_output')
        return
      }
      writeJson(response, 200, {
        status: 'generated', scenario: 'ahe', scenarioVersion: AHE_SCENARIO_VERSION,
        question: result.question, citations: result.citations,
        model: { provider: model.provider, id: model.id }, generatedAt: new Date().toISOString(),
      })
    } catch {
      writeError(response, timedOut ? 504 : 503, timedOut ? 'model_timeout' : 'model_unavailable')
    } finally {
      if (timer) clearTimeout(timer)
    }
  })
  server.requestTimeout = 10_000
  server.headersTimeout = 10_000
  return server
}
