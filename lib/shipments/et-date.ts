const ET_TIME_ZONE = 'America/New_York'

const etDateFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: ET_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

const etDateTimeFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: ET_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
})

function partValue(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes): number {
  return Number(parts.find((part) => part.type === type)?.value ?? 0)
}

function nextDate(date: string): string {
  const [year, month, day] = date.split('-').map(Number)
  const next = new Date(Date.UTC(year, month - 1, day + 1))
  return [
    String(next.getUTCFullYear()).padStart(4, '0'),
    String(next.getUTCMonth() + 1).padStart(2, '0'),
    String(next.getUTCDate()).padStart(2, '0'),
  ].join('-')
}

function etMidnight(date: string): Date {
  const [year, month, day] = date.split('-').map(Number)
  const targetWallTime = Date.UTC(year, month - 1, day)
  let utcGuess = targetWallTime + 5 * 60 * 60 * 1000

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const parts = etDateTimeFormatter.formatToParts(new Date(utcGuess))
    const observedWallTime = Date.UTC(
      partValue(parts, 'year'),
      partValue(parts, 'month') - 1,
      partValue(parts, 'day'),
      partValue(parts, 'hour'),
      partValue(parts, 'minute'),
      partValue(parts, 'second')
    )
    const correction = targetWallTime - observedWallTime
    utcGuess += correction
    if (correction === 0) break
  }

  return new Date(utcGuess)
}

export function todayET(): string {
  const parts = etDateFormatter.formatToParts(new Date())
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((value) => value.type === type)?.value ?? ''
  return `${part('year')}-${part('month')}-${part('day')}`
}

export function isRealDate(date: unknown): date is string {
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return false
  const [year, month, day] = date.split('-').map(Number)
  const parsed = new Date(Date.UTC(year, month - 1, day))
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day
}

export function etRangeToDates(from: string, to: string): { from: Date; toExclusive: Date } {
  if (!isRealDate(from) || !isRealDate(to) || from > to) {
    throw new RangeError('Invalid Eastern Time date range')
  }
  return {
    from: etMidnight(from),
    toExclusive: etMidnight(nextDate(to)),
  }
}
