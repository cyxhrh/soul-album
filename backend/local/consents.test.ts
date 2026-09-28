import { describe, expect, it } from 'vitest'
import { grantSource, hasActiveSourceGrant, revokeSource } from './consents.js'
import type { SourceGrant } from './types.js'

function grant(overrides: Partial<SourceGrant> = {}): SourceGrant {
  return {
    id: 'grant-1', source: 'watch_steps', purpose: 'import_daily_summary',
    scope: ['steps'], status: 'active', grantVersion: 1,
    approvedAt: '2026-09-29T10:00:00+08:00', ...overrides,
  }
}

describe('device-local source grants', () => {
  it('keeps source, purpose and scope permissions independent', () => {
    let grants = grantSource([], grant())
    grants = grantSource(grants, grant({ id: 'grant-2', purpose: 'use_in_journal' }))
    grants = grantSource(grants, grant({ id: 'grant-3', source: 'phone_spending', scope: ['total_spend'] }))

    expect(hasActiveSourceGrant(grants, 'watch_steps', 'import_daily_summary', ['steps'])).toBe(true)
    expect(hasActiveSourceGrant(grants, 'watch_steps', 'use_in_journal', ['steps'])).toBe(true)
    expect(hasActiveSourceGrant(grants, 'watch_steps', 'import_daily_summary', ['heart_rate'])).toBe(false)
    expect(hasActiveSourceGrant(grants, 'phone_spending', 'import_daily_summary', ['steps'])).toBe(false)

    grants = revokeSource(grants, 'grant-1', '2026-09-29T12:00:00+08:00')
    expect(hasActiveSourceGrant(grants, 'watch_steps', 'import_daily_summary', ['steps'])).toBe(false)
    expect(hasActiveSourceGrant(grants, 'watch_steps', 'use_in_journal', ['steps'])).toBe(true)
    expect(hasActiveSourceGrant(grants, 'phone_spending', 'import_daily_summary', ['total_spend'])).toBe(true)
  })

  it('cannot bypass revocation through duplicate active grants or an empty scope', () => {
    const first = grantSource([], grant({ scope: ['steps', 'distance'] }))
    const duplicate = grantSource(first, grant({ id: 'grant-2', scope: ['distance', 'steps'] }))
    expect(duplicate).toBe(first)
    expect(hasActiveSourceGrant(duplicate, 'watch_steps', 'import_daily_summary', [])).toBe(false)
    expect(hasActiveSourceGrant(duplicate, 'watch_steps', 'import_daily_summary', ['heart_rate'])).toBe(false)

    const revoked = revokeSource(duplicate, 'grant-1', '2026-09-29T12:00:00+08:00')
    expect(revoked).toHaveLength(1)
    expect(revoked[0]).toMatchObject({
      id: 'grant-1', status: 'revoked', grantVersion: 2,
      revokedAt: '2026-09-29T12:00:00+08:00', scope: ['steps', 'distance'],
    })
    expect(hasActiveSourceGrant(revoked, 'watch_steps', 'import_daily_summary', ['steps'])).toBe(false)
    expect(revokeSource(revoked, 'grant-1', '2026-09-29T14:00:00+08:00')).toBe(revoked)
    expect(grantSource(revoked, grant({ id: 'grant-3' }))).toHaveLength(2)
  })

  it('never treats missing provider permission as an active source grant', () => {
    const grants = grantSource([], grant({ status: 'provider_permission_missing' }))
    expect(hasActiveSourceGrant(grants, 'watch_steps', 'import_daily_summary', ['steps'])).toBe(false)
  })

  it('rejects invalid scopes and a missing grant rather than silently broadening access', () => {
    expect(() => grantSource([], grant({ scope: [] }))).toThrowError('invalid_input')
    expect(() => grantSource([], grant({ scope: ['steps', 'steps'] }))).toThrowError('invalid_input')
    expect(() => revokeSource([], 'grant-unknown', '2026-09-29T12:00:00+08:00')).toThrowError('not_found')
  })
})
