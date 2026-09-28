import { LocalDomainError } from './errors.js'

/** Resolve a timestamp with an explicit offset into the user's IANA calendar day. */
export function journalDate(occurredAt: string, timezone: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.exec(occurredAt)
  if (!match) {
    throw new LocalDomainError('invalid_input')
  }
  const [, yearText, monthText, dayText, hourText, minuteText, secondText] = match
  const year = Number(yearText)
  const month = Number(monthText)
  const dayOfMonth = Number(dayText)
  if (month < 1 || month > 12 || dayOfMonth < 1 ||
    dayOfMonth > new Date(Date.UTC(year, month, 0)).getUTCDate() ||
    Number(hourText) > 23 || Number(minuteText) > 59 || Number(secondText) > 59) {
    throw new LocalDomainError('invalid_input')
  }
  const date = new Date(occurredAt)
  if (!Number.isFinite(date.getTime())) throw new LocalDomainError('invalid_input')
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(date)
    const field = (name: string) => parts.find((part) => part.type === name)?.value
    return `${field('year')}-${field('month')}-${field('day')}`
  } catch {
    throw new LocalDomainError('invalid_input')
  }
}
