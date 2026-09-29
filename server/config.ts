const DEFAULT_MAX_CALLS = 30

/** Parse the optional process-wide upstream attempt limit before the server starts. */
export function maxCallsFromEnv(value: string | undefined): number {
  if (value === undefined) return DEFAULT_MAX_CALLS
  if (!/^[0-9]+$/.test(value)) throw new Error('invalid AI max calls')
  const maxCalls = Number(value)
  if (!Number.isSafeInteger(maxCalls) || maxCalls < 1 || maxCalls > DEFAULT_MAX_CALLS) {
    throw new Error('invalid AI max calls')
  }
  return maxCalls
}
