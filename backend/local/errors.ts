export type LocalErrorCode =
  | 'invalid_input' | 'not_found' | 'revision_conflict' | 'idempotency_conflict'
  | 'not_authorized' | 'source_unavailable'

export class LocalDomainError extends Error {
  readonly code: LocalErrorCode

  constructor(code: LocalErrorCode) {
    super(code)
    this.name = 'LocalDomainError'
    this.code = code
  }
}
