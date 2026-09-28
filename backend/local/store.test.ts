import { describe, expect, it } from 'vitest'
import { journalDate } from './date.js'
import { LocalDomainError } from './errors.js'
import { LocalPreferencesService } from './preferences.js'
import { canonicalFingerprint, InMemorySpaceRepository } from './store.js'

const SPACE_A = '11111111-1111-4111-8111-111111111111'
const SPACE_B = '22222222-2222-4222-8222-222222222222'
function operation(number: number): string {
  return `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`
}

describe('InMemorySpaceRepository', () => {
  it('rejects identifiers that could smuggle private words into repository keys', () => {
    const repository = new InMemorySpaceRepository()
    expect(() => repository.createSpace('private-space-秘密原话', 'Asia/Shanghai')).toThrowError('invalid_input')
    repository.createSpace(SPACE_A, 'Asia/Shanghai')
    expect(() => repository.transact(SPACE_A, {
      clientOperationId: 'op-秘密原话', fingerprint: 'first', expectedSpaceRevision: 0,
    }, () => undefined)).toThrowError('invalid_input')
  })

  it('treats different letter casing of the same UUID as one space and one operation', () => {
    const repository = new InMemorySpaceRepository()
    const space = 'abcdefab-cdef-4abc-8def-abcdefabcdef'
    const operationId = 'abcdefab-cdef-4abc-8def-abcdefabcdea'
    repository.createSpace(space, 'Asia/Shanghai')
    const first = repository.transact(space, {
      clientOperationId: operationId.toUpperCase(), fingerprint: 'same-request', expectedSpaceRevision: 0,
    }, (_draft, nextRevision) => ({ spaceRevision: nextRevision }))

    const replay = repository.transact(space.toUpperCase(), {
      clientOperationId: operationId, fingerprint: 'same-request', expectedSpaceRevision: 1,
    }, () => { throw new Error('same UUID must not mutate twice') })

    expect(replay).toEqual(first)
    expect(repository.read(space.toUpperCase()).revision).toBe(1)
    expect(() => repository.createSpace(space.toUpperCase(), 'Asia/Shanghai'))
      .toThrowError('revision_conflict')
  })

  it('commits a whole-space mutation once and returns a detached snapshot', () => {
    const repository = new InMemorySpaceRepository()
    repository.createSpace(SPACE_A, 'Asia/Shanghai')

    const result = repository.transact(SPACE_A, {
      clientOperationId: operation(1), fingerprint: 'first-message', expectedSpaceRevision: 0,
    }, (draft, nextRevision) => {
      draft.titles['2026-09-29'] = { text: '这一页', revision: 1, dependencyEntryIds: [] }
      return { spaceRevision: nextRevision, title: draft.titles['2026-09-29'].text }
    })

    expect(result).toEqual({ spaceRevision: 1, title: '这一页' })
    const read = repository.read(SPACE_A)
    expect(read.revision).toBe(1)
    expect(read.titles['2026-09-29'].text).toBe('这一页')
    read.titles['2026-09-29'].text = '外部修改'
    expect(repository.read(SPACE_A).titles['2026-09-29'].text).toBe('这一页')
  })

  it('replays the exact committed result for one operation without another mutation', () => {
    const repository = new InMemorySpaceRepository()
    repository.createSpace(SPACE_A, 'Asia/Shanghai')
    const key = { clientOperationId: operation(1), fingerprint: '{"message":"hello"}', expectedSpaceRevision: 0 }
    const first = repository.transact(SPACE_A, key, (draft, nextRevision) => {
      draft.titles['2026-09-29'] = { text: '初次提交', revision: 1, dependencyEntryIds: [] }
      return { spaceRevision: nextRevision, created: ['entry-1'] }
    })
    first.created.push('外部修改')

    const replay = repository.transact(SPACE_A, key, () => {
      throw new Error('a replay must never run the mutation again')
    })

    expect(replay).toEqual({ spaceRevision: 1, created: ['entry-1'] })
    expect(repository.read(SPACE_A).revision).toBe(1)
    expect(repository.read(SPACE_A).titles['2026-09-29'].text).toBe('初次提交')
  })

  it('replays an entity command after later writes even when its current revision preflight changed', () => {
    const repository = new InMemorySpaceRepository()
    repository.createSpace(SPACE_A, 'Asia/Shanghai')
    const original = repository.transact(SPACE_A, {
      clientOperationId: operation(6), fingerprint: 'entry-1-to-new-text', expectedSpaceRevision: 0,
    }, (_draft, nextRevision) => ({ spaceRevision: nextRevision, entryId: 'entry-1' }))
    repository.transact(SPACE_A, {
      clientOperationId: operation(7), fingerprint: 'other-write', expectedSpaceRevision: 1,
    }, () => undefined)

    const replay = repository.transact(SPACE_A, {
      clientOperationId: operation(6), fingerprint: 'entry-1-to-new-text', expectedSpaceRevision: 2,
    }, () => { throw new Error('must not repeat edit') })

    expect(replay).toEqual(original)
    expect(repository.read(SPACE_A).revision).toBe(2)
  })

  it('rejects reuse of an operation ID with a different request fingerprint', () => {
    const repository = new InMemorySpaceRepository()
    repository.createSpace(SPACE_A, 'Asia/Shanghai')
    repository.transact(SPACE_A, {
      clientOperationId: operation(1), fingerprint: 'first', expectedSpaceRevision: 0,
    }, () => 'first-result')

    expect(() => repository.transact(SPACE_A, {
      clientOperationId: operation(1), fingerprint: 'changed', expectedSpaceRevision: 0,
    }, () => 'new-result')).toThrowError(LocalDomainError)
    expect(() => repository.transact(SPACE_A, {
      clientOperationId: operation(1), fingerprint: 'changed', expectedSpaceRevision: 0,
    }, () => 'new-result')).toThrowError('idempotency_conflict')
    expect(repository.read(SPACE_A).revision).toBe(1)
  })

  it('rejects a stale space revision without changing existing state', () => {
    const repository = new InMemorySpaceRepository()
    repository.createSpace(SPACE_A, 'Asia/Shanghai')
    repository.transact(SPACE_A, {
      clientOperationId: operation(1), fingerprint: 'first', expectedSpaceRevision: 0,
    }, (draft) => { draft.titles['2026-09-29'] = { text: '已提交', revision: 1, dependencyEntryIds: [] } })

    expect(() => repository.transact(SPACE_A, {
      clientOperationId: operation(2), fingerprint: 'second', expectedSpaceRevision: 0,
    }, (draft) => { draft.titles['2026-09-29'].text = '错误覆盖' })).toThrowError('revision_conflict')
    expect(repository.read(SPACE_A).titles['2026-09-29'].text).toBe('已提交')
  })

  it('rolls back a throwing mutation and permits a valid retry of the same operation', () => {
    const repository = new InMemorySpaceRepository()
    repository.createSpace(SPACE_A, 'Asia/Shanghai')
    const key = { clientOperationId: operation(1), fingerprint: 'first', expectedSpaceRevision: 0 }
    expect(() => repository.transact(SPACE_A, key, (draft) => {
      draft.titles['2026-09-29'] = { text: '不得保存', revision: 1, dependencyEntryIds: [] }
      throw new Error('validation failed')
    })).toThrowError('validation failed')
    expect(repository.read(SPACE_A).revision).toBe(0)
    expect(repository.read(SPACE_A).titles).toEqual({})

    expect(repository.transact(SPACE_A, key, (draft) => {
      draft.titles['2026-09-29'] = { text: '有效提交', revision: 1, dependencyEntryIds: [] }
      return 'saved'
    })).toBe('saved')
    expect(repository.read(SPACE_A).titles['2026-09-29'].text).toBe('有效提交')
  })

  it('isolates each space and never lets creation reset an existing space', () => {
    const repository = new InMemorySpaceRepository()
    repository.createSpace(SPACE_A, 'Asia/Shanghai')
    repository.createSpace(SPACE_B, 'America/Los_Angeles')
    repository.transact(SPACE_A, {
      clientOperationId: operation(3), fingerprint: 'message-a', expectedSpaceRevision: 0,
    }, (draft) => { draft.titles['2026-09-29'] = { text: '仅 A 可见', revision: 1, dependencyEntryIds: [] } })
    repository.transact(SPACE_B, {
      clientOperationId: operation(3), fingerprint: 'message-b', expectedSpaceRevision: 0,
    }, (draft) => { draft.titles['2026-09-28'] = { text: '仅 B 可见', revision: 1, dependencyEntryIds: [] } })

    expect(repository.read(SPACE_B).titles['2026-09-29']).toBeUndefined()
    expect(repository.read(SPACE_A).titles['2026-09-28']).toBeUndefined()
    expect(() => repository.createSpace(SPACE_A, 'Asia/Shanghai')).toThrowError('revision_conflict')
    expect(repository.read(SPACE_A).titles['2026-09-29'].text).toBe('仅 A 可见')
  })

  it('prevents a nested transaction from committing through its outer draft', () => {
    const repository = new InMemorySpaceRepository()
    repository.createSpace(SPACE_A, 'Asia/Shanghai')

    expect(() => repository.transact(SPACE_A, {
      clientOperationId: operation(4), fingerprint: operation(4), expectedSpaceRevision: 0,
    }, (outer) => {
      outer.titles['2026-09-29'] = { text: '外层未提交', revision: 1, dependencyEntryIds: [] }
      repository.transact(SPACE_A, {
        clientOperationId: operation(5), fingerprint: operation(5), expectedSpaceRevision: 0,
      }, (inner) => { inner.titles['2026-09-28'] = { text: '内层未提交', revision: 1, dependencyEntryIds: [] } })
    })).toThrowError('revision_conflict')

    expect(repository.read(SPACE_A).revision).toBe(0)
    expect(repository.read(SPACE_A).titles).toEqual({})
  })

  it('uses an injected clock for the initial local invitation date', () => {
    const repository = new InMemorySpaceRepository({ now: () => '2040-01-01T16:30:00Z' })
    const space = repository.createSpace(SPACE_A, 'Asia/Shanghai')

    expect(space.invitations.cadenceAnchorDate).toBe('2040-01-02')
  })

  it('keeps message sequence monotonic even after all messages are removed', () => {
    const repository = new InMemorySpaceRepository()
    repository.createSpace(SPACE_A, 'Asia/Shanghai')
    repository.transact(SPACE_A, {
      clientOperationId: operation(1), fingerprint: 'first', expectedSpaceRevision: 0,
    }, (draft) => {
      draft.nextMessageSequence += 1
      draft.messages = []
    })

    expect(repository.read(SPACE_A).nextMessageSequence).toBe(2)
    expect(repository.transact(SPACE_A, {
      clientOperationId: operation(2), fingerprint: 'second', expectedSpaceRevision: 1,
    }, (draft) => draft.nextMessageSequence++)).toBe(2)
    expect(repository.read(SPACE_A).nextMessageSequence).toBe(3)
  })

  it('retires plaintext receipts after editing an entry and blocks old operation replay', () => {
    const repository = new InMemorySpaceRepository()
    repository.createSpace(SPACE_A, 'Asia/Shanghai')
    const oldText = '秘密原话_山茶花'
    const firstKey = {
      clientOperationId: operation(8), fingerprint: JSON.stringify({ text: oldText }), expectedSpaceRevision: 0,
    }
    repository.transact(SPACE_A, firstKey, (draft) => {
      draft.entries.push({
        id: 'entry-1', messageId: 'message-1', text: oldText,
        journalDate: '2026-09-29', timezone: 'Asia/Shanghai',
        occurredAt: '2026-09-29T09:00:00+08:00', recordedAt: '2026-09-29T09:00:00+08:00',
        revision: 1, source: 'conversation',
      })
      return { text: oldText, entryId: 'entry-1' }
    })
    repository.transact(SPACE_A, {
      clientOperationId: operation(9), fingerprint: operation(6), expectedSpaceRevision: 1,
    }, (draft) => {
      draft.entries[0].text = '新的表述'
      draft.entries[0].revision = 2
      return { entryId: 'entry-1' }
    })

    const receipts = Reflect.get(repository, 'operations') as Map<string, Map<string, unknown>>
    expect(JSON.stringify([...receipts.get(SPACE_A)!.entries()])).not.toContain(oldText)
    expect(() => repository.transact(SPACE_A, { ...firstKey, expectedSpaceRevision: 2 }, () => {
      throw new Error('deleted content must not be recreated')
    })).toThrowError('revision_conflict')
    expect(repository.read(SPACE_A).entries[0].text).toBe('新的表述')
  })

  it('retires old results and raw fingerprints after an entry is deleted', () => {
    const repository = new InMemorySpaceRepository()
    repository.createSpace(SPACE_A, 'Asia/Shanghai')
    const oldText = '只属于旧记录的私密句子'
    const oldKey = {
      clientOperationId: operation(8), fingerprint: `send:${oldText}`, expectedSpaceRevision: 0,
    }
    repository.transact(SPACE_A, oldKey, (draft) => {
      draft.entries.push({
        id: 'entry-1', messageId: 'message-1', text: oldText,
        journalDate: '2026-09-29', timezone: 'Asia/Shanghai',
        occurredAt: '2026-09-29T09:00:00+08:00', recordedAt: '2026-09-29T09:00:00+08:00',
        revision: 1, source: 'conversation',
      })
      return { echoed: oldText }
    })
    repository.transact(SPACE_A, {
      clientOperationId: operation(10), fingerprint: 'delete-entry-1', expectedSpaceRevision: 1,
    }, (draft) => {
      draft.entries = []
      return { deleted: true }
    })

    const receipts = Reflect.get(repository, 'operations') as Map<string, Map<string, unknown>>
    expect(JSON.stringify([...receipts.get(SPACE_A)!.entries()])).not.toContain(oldText)
    expect(() => repository.transact(SPACE_A, { ...oldKey, expectedSpaceRevision: 2 }, () => {
      throw new Error('deleted entry must not reappear')
    })).toThrowError('revision_conflict')
    expect(repository.read(SPACE_A).entries).toEqual([])
  })

  it('retires a control-message receipt when its stored words move to an entry', () => {
    const repository = new InMemorySpaceRepository()
    repository.createSpace(SPACE_A, 'Asia/Shanghai')
    const oldText = '更正前的控制原话_纸船'
    const oldKey = { clientOperationId: operation(11), fingerprint: `control:${oldText}`, expectedSpaceRevision: 0 }
    repository.transact(SPACE_A, oldKey, (draft) => {
      draft.messages.push({
        id: 'message-1', clientOperationId: operation(11), sequence: 1,
        occurredAt: '2026-09-29T09:00:00+08:00', recordedAt: '2026-09-29T09:00:00+08:00',
        revision: 1, interpretation: { kind: 'decline', status: 'accepted', provenance: 'local_rule' },
        entryId: null, controlText: oldText, controlEvent: 'decline',
      })
      return { controlText: oldText }
    })
    repository.transact(SPACE_A, {
      clientOperationId: operation(12), fingerprint: 'correct-control-1', expectedSpaceRevision: 1,
    }, (draft) => {
      draft.messages[0].entryId = 'entry-1'
      draft.messages[0].controlText = null
      draft.entries.push({
        id: 'entry-1', messageId: 'message-1', text: '用户更正后的当前原话',
        journalDate: '2026-09-29', timezone: 'Asia/Shanghai',
        occurredAt: '2026-09-29T09:00:00+08:00', recordedAt: '2026-09-29T09:00:00+08:00',
        revision: 1, source: 'conversation',
      })
      return { corrected: true }
    })

    const receipts = Reflect.get(repository, 'operations') as Map<string, Map<string, unknown>>
    expect(JSON.stringify([...receipts.get(SPACE_A)!.entries()])).not.toContain(oldText)
    expect(() => repository.transact(SPACE_A, { ...oldKey, expectedSpaceRevision: 2 }, () => 'replayed'))
      .toThrowError('revision_conflict')
  })

  it('does not replay an active grant receipt after that grant is revoked', () => {
    const repository = new InMemorySpaceRepository()
    repository.createSpace(SPACE_A, 'Asia/Shanghai')
    const preferences = new LocalPreferencesService(repository)
    const request = {
      clientOperationId: operation(60), source: 'watch_steps' as const,
      purpose: 'import_daily_summary' as const, scope: ['daily_steps'],
      approvedAt: '2026-09-29T09:00:00+08:00',
    }
    const active = preferences.grantSource(SPACE_A, request)
    expect(preferences.hasActiveGrant(SPACE_A, 'watch_steps', 'import_daily_summary', ['daily_steps']))
      .toBe(true)

    preferences.revokeSource(SPACE_A, {
      clientOperationId: operation(61), grantId: active.id,
      expectedGrantVersion: 1, revokedAt: '2026-09-29T10:00:00+08:00',
    })

    expect(preferences.hasActiveGrant(SPACE_A, 'watch_steps', 'import_daily_summary', ['daily_steps']))
      .toBe(false)
    expect(() => preferences.grantSource(SPACE_A, request)).toThrowError('revision_conflict')
  })
})

describe('journalDate', () => {
  it('derives a Shanghai day across UTC midnight', () => {
    expect(journalDate('2026-09-28T16:30:00Z', 'Asia/Shanghai')).toBe('2026-09-29')
  })

  it('uses the requested zone rather than the timestamp offset alone', () => {
    expect(journalDate('2026-09-29T00:15:00+08:00', 'America/Los_Angeles')).toBe('2026-09-28')
  })

  it('rejects a missing offset, invalid calendar date or unknown timezone', () => {
    expect(() => journalDate('2026-09-29T00:15:00', 'Asia/Shanghai')).toThrowError('invalid_input')
    expect(() => journalDate('2026-02-30T00:15:00+08:00', 'Asia/Shanghai')).toThrowError('invalid_input')
    expect(() => journalDate('2026-09-29T00:15:00+08:00', 'Nowhere/Imaginary')).toThrowError('invalid_input')
  })
})

describe('canonicalFingerprint', () => {
  it('treats JSON objects with the same fields as one request regardless of key insertion order', () => {
    const first = canonicalFingerprint({ text: '一句话', context: { question: 'q-1', revision: 2 } })
    const reordered = canonicalFingerprint({ context: { revision: 2, question: 'q-1' }, text: '一句话' })

    expect(first).toBe(reordered)
    expect(first).not.toBe(canonicalFingerprint({ text: '另一句话', context: { question: 'q-1', revision: 2 } }))
  })

  it('rejects values that cannot be represented unambiguously in JSON', () => {
    expect(() => canonicalFingerprint({ text: undefined })).toThrowError('invalid_input')
    expect(() => canonicalFingerprint({ count: Number.NaN })).toThrowError('invalid_input')
  })
})
