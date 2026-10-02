/** Browser-only cache. Payload validation belongs to the UI that owns that payload. */
export const SESSION_STORAGE_KEY = 'jianzhi:local-session:v1'

interface SavedEnvelope { version: 1; writeId: string; value: unknown }
let lastObservedRaw: string | null | undefined

function parseEnvelope(raw: string): SavedEnvelope {
  const envelope: unknown = JSON.parse(raw)
  if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope) ||
    !('version' in envelope) || envelope.version !== 1 ||
    !('writeId' in envelope) || typeof envelope.writeId !== 'string' || !envelope.writeId ||
    !('value' in envelope) || envelope.value === null) throw new Error('缓存格式或版本不受支持')
  return envelope as SavedEnvelope
}

export function readSavedSession<T>(): { value: T | null; error: string | null } {
  try {
    const raw = localStorage.getItem(SESSION_STORAGE_KEY)
    lastObservedRaw = raw
    return { value: raw === null ? null : parseEnvelope(raw).value as T, error: null }
  } catch {
    return { value: null, error: '无法读取本机记录，缓存可能损坏或浏览器禁止访问；原缓存未被清除。' }
  }
}

/** Throws on unavailable storage, quota, corruption or an observed cross-tab conflict. */
export function saveSession(value: unknown): void {
  try {
    const current = localStorage.getItem(SESSION_STORAGE_KEY)
    if (current !== null) parseEnvelope(current)
    if ((lastObservedRaw === undefined && current !== null) ||
      (lastObservedRaw !== undefined && current !== lastObservedRaw)) {
      throw new Error('记录已由其他页面修改或清除，请刷新后再保存。')
    }
    const raw = JSON.stringify({ version: 1, writeId: crypto.randomUUID(), value })
    parseEnvelope(raw)
    localStorage.setItem(SESSION_STORAGE_KEY, raw)
    if (localStorage.getItem(SESSION_STORAGE_KEY) !== raw) {
      throw new Error('记录已由其他页面修改，请刷新后检查保存结果。')
    }
    lastObservedRaw = raw
  } catch (error) {
    if (error instanceof Error && error.message.includes('其他页面')) throw error
    throw new Error('本机保存失败：浏览器存储不可用、空间不足或已有缓存损坏。请先下载备份。', { cause: error })
  }
}

/** Call only for an explicit user reset. Errors must be shown before declaring it cleared. */
export function clearSavedSession(): void {
  try {
    localStorage.removeItem(SESSION_STORAGE_KEY)
    if (localStorage.getItem(SESSION_STORAGE_KEY) !== null) throw new Error('clear did not persist')
    lastObservedRaw = null
  } catch (error) {
    throw new Error('无法清除本机记录，请检查浏览器存储权限。', { cause: error })
  }
}
