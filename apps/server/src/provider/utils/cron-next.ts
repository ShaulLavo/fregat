/**
 * The next match of a five-field cron expression (minute hour day-of-month month day-of-week),
 * in the server's local time zone: the harness that holds the schedule runs on this machine
 * and fires by its clock.
 */

type CronFields = {
  readonly minutes: ReadonlySet<number>
  readonly hours: ReadonlySet<number>
  readonly days: ReadonlySet<number>
  readonly months: ReadonlySet<number>
  readonly weekdays: ReadonlySet<number>
  readonly dayRestricted: boolean
  readonly weekdayRestricted: boolean
}

const RANGES = [
  [0, 59],
  [0, 23],
  [1, 31],
  [1, 12],
  [0, 7],
] as const
const MINUTE_MS = 60_000
/** A one-year horizon: a cron that never matches in a year is treated as never firing. */
const HORIZON_MS = 366 * 24 * 60 * MINUTE_MS

export function nextCronFire(expression: string, after: Date): Date | null {
  const fields = parseCron(expression)
  if (!fields) return null
  const cursor = new Date(after.getTime())
  cursor.setSeconds(0, 0)
  cursor.setMinutes(cursor.getMinutes() + 1)
  const limit = after.getTime() + HORIZON_MS
  while (cursor.getTime() <= limit) {
    if (!fields.months.has(cursor.getMonth() + 1)) {
      cursor.setMonth(cursor.getMonth() + 1, 1)
      cursor.setHours(0, 0, 0, 0)
      continue
    }
    if (!dayMatches(fields, cursor)) {
      cursor.setDate(cursor.getDate() + 1)
      cursor.setHours(0, 0, 0, 0)
      continue
    }
    if (!fields.hours.has(cursor.getHours())) {
      cursor.setHours(cursor.getHours() + 1, 0, 0, 0)
      continue
    }
    if (fields.minutes.has(cursor.getMinutes())) return cursor
    cursor.setMinutes(cursor.getMinutes() + 1, 0, 0)
  }
  return null
}

// Vixie cron: when both day fields are restricted, either one matching is enough.
function dayMatches(fields: CronFields, date: Date) {
  const day = fields.days.has(date.getDate())
  const weekday = fields.weekdays.has(date.getDay())
  if (fields.dayRestricted && fields.weekdayRestricted) return day || weekday
  if (fields.dayRestricted) return day
  if (fields.weekdayRestricted) return weekday
  return true
}

function parseCron(expression: string): CronFields | null {
  const parts = expression.trim().split(/\s+/)
  if (parts.length !== 5) return null
  const sets = parts.map((part, index) => parseField(part, RANGES[index] ?? [0, 0]))
  const [minutes, hours, days, months, weekdays] = sets
  if (!minutes || !hours || !days || !months || !weekdays) return null
  if (weekdays.has(7)) weekdays.add(0)
  return {
    minutes,
    hours,
    days,
    months,
    weekdays,
    dayRestricted: !parts[2]?.startsWith('*'),
    weekdayRestricted: !parts[4]?.startsWith('*'),
  }
}

function parseField(field: string, [min, max]: readonly [number, number]): Set<number> | null {
  const values = new Set<number>()
  for (const item of field.split(',')) {
    const range = parseItem(item, min, max)
    if (!range) return null
    for (let value = range.from; value <= range.to; value += range.step) values.add(value)
  }
  return values.size > 0 ? values : null
}

function parseItem(item: string, min: number, max: number) {
  const match = /^(\*|\d+)(?:-(\d+))?(?:\/(\d+))?$/.exec(item)
  if (!match) return null
  const [, start = '', end, stepText] = match
  const step = stepText === undefined ? 1 : Number(stepText)
  const from = start === '*' ? min : Number(start)
  let to = from
  if (start === '*' || (end === undefined && stepText !== undefined)) to = max
  if (end !== undefined) to = Number(end)
  if (step < 1 || from < min || to > max || from > to) return null
  return { from, to, step }
}
