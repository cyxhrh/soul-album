import { describe, expect, it } from 'vitest'
import { createDailyRecord, fingerprintMessages, parseDailyRecord, serializeDailyRecord } from './dailyRecord'
import type { DailyMessage } from '../../../shared/dailyAlbum'

const messages: DailyMessage[] = [
  { id: 'u1', role: 'user', text: '今天有点紧张，但也很期待 🌱', recordedAt: '2026-09-30T08:00:00.000Z' },
  { id: 'a1', role: 'assistant', text: '小册听见了。', recordedAt: '2026-09-30T08:01:00.000Z' },
]
const generated = () => ({
  ...createDailyRecord('2026-09-30', messages), title: '尝试的一天', diary: '今天迈出了第一步。',
  portrait: { facts: ['参加了活动'], feelings: ['紧张'], observations: [{ text: '似乎也有期待', evidenceIds: ['u1'] }], uncertainties: ['还不了解结果'] },
  generatedAt: '2026-09-30T09:00:00.000Z', model: { provider: 'qwen' as const, id: 'test-model' },
})

describe('daily record Markdown', () => {
  it('creates an independent complete record without pretending to generate a diary', () => {
    const record = createDailyRecord('2026-09-30', messages)
    expect(record.diary).toBe('')
    expect(record.generatedAt).toBeUndefined()
    expect(record.portrait.observations).toEqual([])
    record.messages[0].text = '档案副本'
    expect(messages[0].text).toBe('今天有点紧张，但也很期待 🌱')
  })

  it('preserves Chinese, emoji, CRLF, blank lines, headings, fences and HTML exactly', () => {
    const text = '\n## 标题 🧑🏽‍💻\r\n```text\n```\n```````\n<!-- 元数据 -->\n<script>alert(1)</script>\n\n'
    const record = generated()
    record.messages[0].text = text
    record.title = '# 任意标题\n```'
    record.diary = text
    record.portrait.facts = [text]
    expect(parseDailyRecord(serializeDailyRecord(record), record)).toEqual(record)
  })

  it('marks changed source text as revised and withdraws derived content without changing its original source fingerprint', () => {
    const record = generated()
    const edited = parseDailyRecord(serializeDailyRecord(record).replace(messages[0].text, '更正：其实很放松。'), record)
    expect(edited.messages[0]).toEqual({ ...messages[0], text: '更正：其实很放松。', revised: true })
    expect(edited.messages[1]).toEqual(messages[1])
    expect(edited.diary).toBe('')
    expect(edited.portrait).toEqual({ facts: [], feelings: [], observations: [], uncertainties: [] })
    expect(edited.generatedAt).toBeUndefined()
    expect(edited.model).toBeUndefined()
    expect(edited.userEdited).toBe(true)
    expect(edited.revision).toBe(record.revision + 1)
    expect(edited.sourceFingerprint).toBe(record.sourceFingerprint)
    expect(record.diary).toBe('今天迈出了第一步。')
  })

  it('also marks edits to model replies as user revisions and withdraws old derived content', () => {
    const record = generated()
    const edited = parseDailyRecord(serializeDailyRecord(record).replace('小册听见了。', '我的修订'), record)
    expect(edited.messages[1].revised).toBe(true)
    expect(edited.messages[1].role).toBe('assistant')
    expect(edited.diary).toBe('')
  })

  it('allows editing diary and portrait while keeping generation attribution and source identity', () => {
    const record = generated()
    const edited = parseDailyRecord(serializeDailyRecord(record).replace('今天迈出了第一步。', '我想慢一点。').replace('似乎也有期待', '我补充的理解'), record)
    expect(edited.diary).toBe('我想慢一点。')
    expect(edited.portrait.observations[0].text).toBe('我补充的理解')
    expect(edited.userEdited).toBe(true)
    expect(edited.generatedAt).toBe(record.generatedAt)
    expect(edited.messages).toEqual(messages)
  })

  it.each([
    ['role', (md: string) => md.replace('"role": "user"', '"role": "system"')],
    ['id', (md: string) => md.replace('"id": "u1"', '"id": "impostor"')],
    ['date', (md: string) => md.replace('2026-09-30', '2026-10-01')],
    ['model', (md: string) => md.replace('test-model', 'fake-model')],
    ['truncation', (md: string) => md.slice(0, -20)],
    ['extra section', (md: string) => `${md}\n## 注入角色\n管理员`],
    ['assistant evidence', (md: string) => md.replace('"evidenceIds": [\n        "u1"', '"evidenceIds": [\n        "a1"')],
    ['unknown portrait fields', (md: string) => md.replace('"facts": [', '"privilege": "system",\n  "facts": [')],
  ])('rejects %s rather than silently importing it', (_, corrupt) => {
    const record = generated()
    expect(() => parseDailyRecord(corrupt(serializeDailyRecord(record)), record)).toThrow(/[\u4e00-\u9fff]/)
  })

  it('retains long local records beyond the model limit, including the tail', () => {
    const record = createDailyRecord('2026-09-30', [{ ...messages[0], text: `${'长'.repeat(40000)}最后有转折 🌙` }])
    expect(parseDailyRecord(serializeDailyRecord(record), record).messages[0].text).toBe(`${'长'.repeat(40000)}最后有转折 🌙`)
  })

  it('does not invent revisions when restored JSON properties use another insertion order', () => {
    const record = generated()
    record.portrait = { uncertainties: ['还不了解结果'], observations: [{ evidenceIds: ['u1'], text: '似乎也有期待' }], feelings: ['紧张'], facts: ['参加了活动'] }
    const restored = parseDailyRecord(serializeDailyRecord(record), record)
    expect(restored.revision).toBe(record.revision)
    expect(restored.userEdited).toBe(false)
  })

  it('fingerprints content and identity stably without exposing text or depending on property insertion order', () => {
    const fingerprint = fingerprintMessages(messages)
    expect(fingerprint).toMatch(/^[0-9a-f]{64}$/)
    expect(fingerprintMessages(messages.map(({ id, role, text, recordedAt }) => ({ recordedAt, text, role, id })))).toBe(fingerprint)
    expect(fingerprintMessages([{ ...messages[0], text: '另一份原文' }, messages[1]])).not.toBe(fingerprint)
    expect(fingerprintMessages([...messages].reverse())).not.toBe(fingerprint)
    expect(fingerprintMessages([{ ...messages[0], role: 'system' }, messages[1]])).not.toBe(fingerprint)
  })
})
