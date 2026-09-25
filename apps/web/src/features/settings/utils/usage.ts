import { formatUsd } from '@/lib/usd'
import { formatContextTokens } from '@workspace/client-core/chat/context-usage'
import { usageTokenCount } from '@workspace/contracts'
import type {
  ProviderUsageDayRow,
  ProviderUsageHistory,
  ProviderUsageModelRow,
  ProviderUsagePurpose,
  USAGE_HISTORY_DAYS,
} from '@workspace/contracts'

const DAY_MS = 24 * 60 * 60_000
/** Rows shown before the rest fold into one. */
export const USAGE_MODEL_ROWS_SHOWN = 5

export type UsageDays = (typeof USAGE_HISTORY_DAYS)[number]

const PURPOSE_LABELS: Record<ProviderUsagePurpose, string> = {
  turn: 'Chat turns',
  title: 'Session titles',
  'commit-message': 'Commit messages',
}

export function usagePurposeLabel(purpose: ProviderUsagePurpose) {
  return PURPOSE_LABELS[purpose]
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
    days.push(byDay.get(day) ?? { costUsd: 0, day, models: [], tokens: 0, unpricedTokens: 0 })
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

export function usageModelKey(row: { readonly driverKind: string; readonly model: string }) {
  return `${row.driverKind}:${row.model}`
}

/** Cost when any is known, else tokens: the same measure the bars use. */
export function usageModelMeasure(row: ProviderUsageModelRow, byCost: boolean) {
  return byCost ? (row.costUsd ?? 0) : usageTokenCount(row)
}

/** A day with the hidden models taken out, its unpriced tokens recounted. */
export function visibleUsageDay(
  day: ProviderUsageDayRow,
  hidden: ReadonlySet<string>,
): ProviderUsageDayRow {
  if (hidden.size === 0) return day

  const models = day.models.filter((model) => !hidden.has(usageModelKey(model)))
  return {
    ...day,
    costUsd: models.some((model) => model.costUsd !== null)
      ? models.reduce((total, model) => total + (model.costUsd ?? 0), 0)
      : null,
    models,
    tokens: models.reduce((total, model) => total + model.tokens, 0),
    unpricedTokens: models
      .filter((model) => model.costUsd === null)
      .reduce((total, model) => total + model.tokens, 0),
  }
}

/** `1.2M in × $1.25 + 400k cached × $0.125 + 90k out × $10 per 1M`, or who priced it. */
export function usageCostArithmetic(row: ProviderUsageModelRow) {
  if (row.costSource === 'provider') return "Claude's estimate"
  if (row.costSource === 'none') return 'No price for this model'
  if (!row.rates) return 'Standard API rates, which changed during this range'

  const { rates } = row
  const terms = [
    `${formatContextTokens(row.inputTokens)} in × ${formatRate(rates.input)}`,
    rates.cacheRead === null
      ? null
      : `${formatContextTokens(row.cacheReadTokens)} cached × ${formatRate(rates.cacheRead)}`,
    rates.cacheWrite === null
      ? null
      : `${formatContextTokens(row.cacheWriteTokens)} cache write × ${formatRate(rates.cacheWrite)}`,
    `${formatContextTokens(row.outputTokens)} out × ${formatRate(rates.output)}`,
  ].filter(Boolean)
  return `${terms.join(' + ')} per 1M`
}

function formatRate(rate: number) {
  return `$${Number(rate.toPrecision(3))}`
}
