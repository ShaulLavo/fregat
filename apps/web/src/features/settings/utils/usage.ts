import type {
  ModelPrice,
  ModelPrices,
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
  return row.costUsd === null ? 'No price' : formatUsd(row.costUsd)
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

/**
 * Models the price editor offers: any that reports no cost of its own, plus any that
 * already has a price, so a price outlives the range that showed its model.
 */
export function pricedModelNames(history: ProviderUsageHistory | undefined, prices: ModelPrices) {
  const names = new Set(Object.keys(prices))
  for (const row of history?.models ?? []) {
    if (row.costSource !== 'provider') names.add(row.model)
  }

  return [...names].toSorted((left, right) => left.localeCompare(right))
}

/** The price list with one model set, or removed when `price` is null. */
export function withModelPrice(prices: ModelPrices, model: string, price: ModelPrice | null) {
  const next: Record<string, ModelPrice> = {}
  for (const [name, existing] of Object.entries(prices)) {
    if (name !== model) next[name] = existing
  }
  if (price) next[model] = price

  return next
}
