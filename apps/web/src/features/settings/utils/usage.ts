import type {
  ProviderUsageDayRow,
  ProviderUsageHistory,
  ProviderUsageModelRow,
  ProviderUsagePurpose,
  USAGE_HISTORY_DAYS,
} from '@workspace/contracts'

const DAY_MS = 24 * 60 * 60_000

export type UsageDays = (typeof USAGE_HISTORY_DAYS)[number]

const PURPOSE_LABELS: Record<ProviderUsagePurpose, string> = {
  turn: 'Chat turns',
  title: 'Session titles',
  'commit-message': 'Commit messages',
}

export function usagePurposeLabel(purpose: ProviderUsagePurpose) {
  return PURPOSE_LABELS[purpose]
}

/** Cents while they matter; a sub-cent amount says so rather than rounding to `$0.00`. */
export function formatUsd(value: number) {
  if (value === 0) return '$0.00'
  if (value < 0.01) return '<$0.01'

  return new Intl.NumberFormat('en-US', {
    currency: 'USD',
    maximumFractionDigits: value < 100 ? 2 : 0,
    minimumFractionDigits: value < 100 ? 2 : 0,
    style: 'currency',
  }).format(value)
}

/** `null` is an unknown cost, never zero. */
export function formatModelCost(row: Pick<ProviderUsageModelRow, 'costUsd'>) {
  return row.costUsd === null ? 'Price unavailable' : formatUsd(row.costUsd)
}

/**
 * Every day in the range, empty ones included, so a quiet day reads as a gap rather
 * than the bars closing ranks. `since` is local midnight; noon keeps DST off the edge.
 */
export function usageDays(history: ProviderUsageHistory): ProviderUsageDayRow[] {
  const byDay = new Map(history.daily.map((row) => [row.day, row]))
  const sinceMs = Date.parse(history.since)
  const days: ProviderUsageDayRow[] = []
  for (let index = 0; index < history.days; index += 1) {
    const day = localDay(new Date(sinceMs + index * DAY_MS + DAY_MS / 2))
    days.push(byDay.get(day) ?? { costUsd: 0, day, tokens: 0 })
  }

  return days
}

function localDay(date: Date) {
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')

  return `${date.getFullYear()}-${month}-${day}`
}

/** `Sep 25`, read in the viewer's zone like the day itself. */
export function formatUsageDay(day: string) {
  const [year, month, date] = day.split('-').map(Number)

  return new Date(year ?? 0, (month ?? 1) - 1, date ?? 1).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
  })
}

/** Usage is a report, so it is searchable without registering a pretend setting. */
export function matchesUsageSearch(query: string) {
  const words = 'usage cost price spend tokens billing codex claude'
  return query
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .every((word) => words.includes(word))
}
