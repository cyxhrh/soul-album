import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex } from '@noble/hashes/utils.js'
import type { DailyAlbumContent, DailyAlbumResponse, DailyMessage } from '../../../shared/dailyAlbum'

export interface DailyRecord extends DailyAlbumContent {
  version: 1
  date: string
  revision: number
  /** The original chat version. Archive edits deliberately retain this value. */
  sourceFingerprint: string
  messages: DailyMessage[]
  generatedAt?: string
  model?: DailyAlbumResponse['model']
  userEdited: boolean
}

const emptyPortrait = (): DailyAlbumContent['portrait'] => ({ facts: [], feelings: [], observations: [], uncertainties: [] })

export function fingerprintMessages(messages: DailyMessage[]): string {
  const content = messages.map(({ id, role, text, recordedAt, revised }) => [id, role, text, recordedAt, revised === true])
  return bytesToHex(sha256(new TextEncoder().encode(JSON.stringify(content))))
}

export function createDailyRecord(date: string, messages: DailyMessage[]): DailyRecord {
  return {
    version: 1, date, revision: 0, sourceFingerprint: fingerprintMessages(messages),
    title: '今天留下的事', diary: '', portrait: emptyPortrait(),
    messages: messages.map(message => ({ ...message })), userEdited: false,
  }
}

const recordMetadata = (record: DailyRecord) => ({
  version: record.version, date: record.date, revision: record.revision,
  sourceFingerprint: record.sourceFingerprint, userEdited: record.userEdited,
  ...(record.generatedAt === undefined ? {} : { generatedAt: record.generatedAt }),
  ...(record.model === undefined ? {} : { model: record.model }),
})
const messageMetadata = ({ id, role, recordedAt, revised }: DailyMessage) => ({
  id, role, recordedAt, ...(revised === undefined ? {} : { revised }),
})
const json = (value: unknown) => JSON.stringify(value, null, 2)
const roleLabels = { user: '用户原文', assistant: '小册回答', system: '系统开场' }
const messageHeading = (message: DailyMessage, index: number) => `### 对话 ${index + 1} · ${roleLabels[message.role]}`

/** A fence longer than every backtick run preserves even Markdown-looking text verbatim. */
function fenced(text: string, language: 'text' | 'json'): string {
  let length = 3
  for (const match of text.matchAll(/`+/g)) length = Math.max(length, match[0].length + 1)
  const fence = '`'.repeat(length)
  return `${fence}${language}\n${text}\n${fence}\n\n`
}

export function serializeDailyRecord(record: DailyRecord): string {
  let markdown = '# 每日画册\n\n'
  markdown += '正文可以编辑；元数据、对话顺序与角色请保留。修改对话后，旧日记和肖像会撤下，需重新整理。\n\n'
  markdown += '## 档案元数据（只读）\n\n' + fenced(json(recordMetadata(record)), 'json')
  markdown += '## 日记标题\n\n' + fenced(record.title, 'text')
  markdown += '## 日记正面\n\n' + fenced(record.diary, 'text')
  markdown += '## 今日肖像\n\n'
  markdown += 'facts 为明确事实；feelings 为自述感受；observations 为暂定观察，evidenceIds 仅引用用户消息；uncertainties 为不确定之处。\n\n'
  markdown += fenced(json(record.portrait), 'json')
  markdown += '## 完整对话\n\n'
  for (const [index, message] of record.messages.entries()) {
    markdown += `${messageHeading(message, index)}\n\n`
    markdown += fenced(json(messageMetadata(message)), 'json')
    markdown += fenced(message.text, 'text')
  }
  return markdown
}

function failure(detail: string): never {
  throw new Error(`画册未保存：${detail}。请保留原有标题、围栏和只读元数据，仅修改内容；草稿仍可继续编辑。`)
}

function parseJson(text: string): unknown {
  try { return JSON.parse(text) }
  catch { return failure('JSON 内容格式有误，请检查引号、逗号和括号') }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
/** Object key ordering and JSON formatting are not user revisions. */
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`
  if (isObject(value)) return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`
  return JSON.stringify(value)
}
function exactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key))
}
function strings(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(item => typeof item === 'string')
}

function readPortrait(value: unknown, messages: DailyMessage[]): DailyAlbumContent['portrait'] {
  if (!isObject(value) || !exactKeys(value, ['facts', 'feelings', 'observations', 'uncertainties']) ||
    !strings(value.facts) || !strings(value.feelings) || !strings(value.uncertainties) || !Array.isArray(value.observations)) {
    return failure('今日肖像结构不完整或含有未知字段')
  }
  const userIds = new Set(messages.filter(message => message.role === 'user').map(message => message.id))
  const observations = value.observations.map(observation => {
    if (!isObject(observation) || !exactKeys(observation, ['text', 'evidenceIds']) ||
      typeof observation.text !== 'string' || !strings(observation.evidenceIds) ||
      observation.evidenceIds.length === 0 || observation.evidenceIds.some(id => !userIds.has(id))) {
      return failure('暂定观察必须引用本页真实存在的用户消息 ID，不能把模型回答当作依据')
    }
    return { text: observation.text, evidenceIds: [...observation.evidenceIds] }
  })
  return { facts: [...value.facts], feelings: [...value.feelings], observations, uncertainties: [...value.uncertainties] }
}

/** Parses only our exported document against a trusted baseline, never imports identities. */
export function parseDailyRecord(markdown: string, baseline: DailyRecord): DailyRecord {
  let cursor = 0
  const consume = (expected: string) => {
    if (!markdown.startsWith(expected, cursor)) failure('档案结构被修改或内容不完整')
    cursor += expected.length
  }
  const readBlock = (language: 'text' | 'json'): string => {
    const lineEnd = markdown.indexOf('\n', cursor)
    if (lineEnd === -1) return failure('缺少内容围栏')
    const opening = markdown.slice(cursor, lineEnd)
    const match = /^(`{3,})(text|json)$/.exec(opening)
    if (!match || match[2] !== language) return failure('内容围栏格式被修改')
    const closing = `\n${match[1]}\n\n`
    const end = markdown.indexOf(closing, lineEnd + 1)
    if (end === -1) return failure('内容围栏没有正确闭合')
    const content = markdown.slice(lineEnd + 1, end)
    cursor = end + closing.length
    return content
  }
  const verifyMetadata = (expected: unknown) => {
    const actual = parseJson(readBlock('json'))
    if (stable(actual) !== stable(expected)) failure('只读元数据不可修改，消息身份、时间和角色须与原档案一致')
  }

  consume('# 每日画册\n\n')
  consume('正文可以编辑；元数据、对话顺序与角色请保留。修改对话后，旧日记和肖像会撤下，需重新整理。\n\n')
  consume('## 档案元数据（只读）\n\n')
  verifyMetadata(recordMetadata(baseline))
  consume('## 日记标题\n\n')
  const title = readBlock('text')
  consume('## 日记正面\n\n')
  const diary = readBlock('text')
  consume('## 今日肖像\n\n')
  consume('facts 为明确事实；feelings 为自述感受；observations 为暂定观察，evidenceIds 仅引用用户消息；uncertainties 为不确定之处。\n\n')
  const portrait = readPortrait(parseJson(readBlock('json')), baseline.messages)
  consume('## 完整对话\n\n')
  let sourceEdited = false
  const messages = baseline.messages.map((message, index) => {
    consume(`${messageHeading(message, index)}\n\n`)
    verifyMetadata(messageMetadata(message))
    const text = readBlock('text')
    if (text === message.text) return { ...message }
    sourceEdited = true
    return { ...message, text, revised: true }
  })
  if (markdown.slice(cursor).trim() !== '') failure('发现档案结构以外的内容，请把新增文字写入对应的正文区域')
  const changed = sourceEdited || title !== baseline.title || diary !== baseline.diary || stable(portrait) !== stable(baseline.portrait)
  const result: DailyRecord = {
    ...baseline, title, diary, portrait, messages,
    revision: baseline.revision + (changed ? 1 : 0), userEdited: baseline.userEdited || changed,
  }
  if (sourceEdited) {
    result.diary = ''
    result.portrait = emptyPortrait()
    delete result.generatedAt
    delete result.model
  }
  return result
}
