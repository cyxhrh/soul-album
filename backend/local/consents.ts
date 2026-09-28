import { LocalDomainError } from './errors.js'
import type { Source, SourceGrant, SourcePurpose } from './types.js'

export function grantSource(grants: SourceGrant[], grant: SourceGrant): SourceGrant[] {
  if (!grant.id || grant.grantVersion !== 1 || grant.scope.length === 0 ||
    grant.scope.some((item) => !item.trim()) || new Set(grant.scope).size !== grant.scope.length) {
    throw new LocalDomainError('invalid_input')
  }
  const sameId = grants.find((item) => item.id === grant.id)
  if (sameId) {
    if (JSON.stringify(sameId) === JSON.stringify(grant)) return grants
    throw new LocalDomainError('idempotency_conflict')
  }
  const requestedScope = [...grant.scope].sort().join('\u0000')
  if (grants.some((item) => item.status === 'active' && item.source === grant.source &&
    item.purpose === grant.purpose && [...item.scope].sort().join('\u0000') === requestedScope)) return grants
  return [...grants, { ...grant, scope: [...grant.scope] }]
}

export function revokeSource(grants: SourceGrant[], grantId: string, revokedAt: string): SourceGrant[] {
  const found = grants.find((grant) => grant.id === grantId)
  if (!found) throw new LocalDomainError('not_found')
  if (found.status === 'revoked') return grants
  return grants.map((grant) => grant.id === grantId && grant.status !== 'revoked'
    ? { ...grant, status: 'revoked', revokedAt, grantVersion: grant.grantVersion + 1 } : grant)
}

/** App-level grant only; this does not establish OS/provider permission. */
export function hasActiveSourceGrant(
  grants: SourceGrant[], source: Source, purpose: SourcePurpose, scope: string[],
): boolean {
  if (scope.length === 0 || scope.some((item) => !item.trim())) return false
  return grants.some((grant) => grant.status === 'active' && grant.source === source &&
    grant.purpose === purpose && scope.every((item) => grant.scope.includes(item)))
}
