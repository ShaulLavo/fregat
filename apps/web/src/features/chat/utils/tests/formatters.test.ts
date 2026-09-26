import {
  formatChatDateLabel,
  formatChatRelativeTime,
  formatChatTimestamp,
  formatWakeTime,
} from '@/features/chat/utils/formatters'
import { expect, test } from '../../../../../test/fixtures'

const NOW_ISO = '2026-06-12T10:00:00.000Z'
const NOW_MS = Date.parse(NOW_ISO)

function agoIso(elapsedMs: number) {
  return new Date(NOW_MS - elapsedMs).toISOString()
}

test('anything from the last minute reads as now rather than a zero', () => {
  expect(formatChatRelativeTime(agoIso(0), NOW_MS)).toBe('now')
  expect(formatChatRelativeTime(agoIso(59_000), NOW_MS)).toBe('now')
})

test('minutes and hours get the compact units a narrow rail row has room for', () => {
  expect(formatChatRelativeTime(agoIso(60_000), NOW_MS)).toBe('1m ago')
  expect(formatChatRelativeTime(agoIso(59 * 60_000), NOW_MS)).toBe('59m ago')
  expect(formatChatRelativeTime(agoIso(2 * 3_600_000 + 40 * 60_000), NOW_MS)).toBe('2h ago')
})

test('a day-old session counts days, and the count stops at a week', () => {
  expect(formatChatRelativeTime(agoIso(24 * 3_600_000), NOW_MS)).toBe('1d ago')
  expect(formatChatRelativeTime(agoIso(6 * 24 * 3_600_000), NOW_MS)).toBe('6d ago')
  // Compared against the calendar formatter rather than the substring "ago":
  // that is August's abbreviation in pt-BR and es, so the literal would fail
  // under those locales for any August date.
  const aWeekAgo = new Date(NOW_MS - 7 * 24 * 3_600_000)
  expect(formatChatRelativeTime(aWeekAgo.toISOString(), NOW_MS)).toBe(
    new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' }).format(aWeekAgo),
  )
})

test('past a week the label is the calendar date the rest of chat shows', () => {
  const eightDaysAgo = new Date(NOW_MS - 8 * 24 * 3_600_000)
  const calendar = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' })

  expect(formatChatRelativeTime(eightDaysAgo.toISOString(), NOW_MS)).toBe(
    calendar.format(eightDaysAgo),
  )
})

test('a date from another year carries its year so it cannot be read as this one', () => {
  const lastYear = new Date('2024-06-04T10:00:00.000Z')
  const thisYear = new Date('2026-06-04T10:00:00.000Z')
  const options = { day: 'numeric', month: 'short' } as const

  // Against the formatter, not against the digits "2024": the year renders as
  // ٢٠٢٤ under ar-EG, and the point is that the year is present at all.
  expect(formatChatRelativeTime(lastYear.toISOString(), NOW_MS)).toBe(
    new Intl.DateTimeFormat(undefined, { ...options, year: 'numeric' }).format(lastYear),
  )
  expect(formatChatRelativeTime(thisYear.toISOString(), NOW_MS)).toBe(
    new Intl.DateTimeFormat(undefined, options).format(thisYear),
  )
})

test('a stamp ahead of the browser clock is skew, not a countdown', () => {
  expect(formatChatRelativeTime(new Date(NOW_MS + 90_000).toISOString(), NOW_MS)).toBe('now')
})

test('an unparseable stamp formats to nothing instead of Invalid Date', () => {
  expect(formatChatRelativeTime('not a timestamp', NOW_MS)).toBe('')
  expect(formatChatTimestamp('not a timestamp')).toBe('')
  expect(formatChatDateLabel('not a timestamp')).toBe('')
})

test('a stamp from today is a time of day and any other day is its date', () => {
  const now = new Date()

  expect(formatChatTimestamp(now.toISOString())).toBe(
    new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(now),
  )
  expect(formatChatDateLabel(now.toISOString())).toBe('Today')
  expect(formatChatTimestamp('2020-03-04T08:15:00.000Z')).toBe(
    new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' }).format(
      new Date('2020-03-04T08:15:00.000Z'),
    ),
  )
})

test('formatting a rail full of rows builds no new date formatters', () => {
  // Construction is the expensive half of Intl, so the per-row cost has to be formatting
  // only. The module's formatters already exist by the time this swap lands, so anything
  // counted here is a formatter being built inside a render.
  const nativeDateTimeFormat = Intl.DateTimeFormat
  let constructed = 0

  class CountingDateTimeFormat extends nativeDateTimeFormat {
    constructor(...args: ConstructorParameters<typeof Intl.DateTimeFormat>) {
      super(...args)
      constructed += 1
    }
  }

  Object.defineProperty(Intl, 'DateTimeFormat', {
    configurable: true,
    value: CountingDateTimeFormat,
    writable: true,
  })

  try {
    for (let row = 0; row < 100; row += 1) {
      formatChatTimestamp(new Date().toISOString())
      formatChatTimestamp('2020-03-04T08:15:00.000Z')
      formatChatDateLabel('2020-03-04T08:15:00.000Z')
      formatChatRelativeTime('2020-03-04T08:15:00.000Z', NOW_MS)
    }
  } finally {
    Object.defineProperty(Intl, 'DateTimeFormat', {
      configurable: true,
      value: nativeDateTimeFormat,
      writable: true,
    })
  }

  expect(constructed).toBe(0)
})

test('a wake-up reads as a time today, a weekday within the week, and due once it passed', () => {
  const now = new Date(2026, 8, 26, 10, 0).getTime()
  const later = new Date(2026, 8, 26, 14, 30)
  const tomorrow = new Date(2026, 8, 27, 9, 0)
  const clock = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' })
  const weekday = new Intl.DateTimeFormat(undefined, {
    weekday: 'short',
    hour: 'numeric',
    minute: '2-digit',
  })

  expect(formatWakeTime(later.toISOString(), now)).toBe(clock.format(later))
  expect(formatWakeTime(tomorrow.toISOString(), now)).toBe(weekday.format(tomorrow))
  expect(formatWakeTime(new Date(now - 60_000).toISOString(), now)).toBe('due')
})
