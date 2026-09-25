import * as v from 'valibot'
import type { ProviderUsageAmounts } from './usage-totals'

const rateSchema = v.pipe(v.number(), v.finite(), v.minValue(0))

const modelRateSchema = v.object({
  input: rateSchema,
  output: rateSchema,
  cacheRead: v.nullable(rateSchema),
  cacheWrite: v.nullable(rateSchema),
})

export const priceSnapshotSchema = v.object({
  fetchedAt: v.pipe(v.string(), v.isoTimestamp()),
  prices: v.pipe(v.record(v.string(), modelRateSchema), v.minEntries(1)),
})

export type PriceSnapshot = v.InferOutput<typeof priceSnapshotSchema>
export type RecordedModelPrice = v.InferOutput<typeof modelRateSchema> & {
  provider: string
  model: string
  fetchedAt: string
}

const catalogSchema = v.record(v.string(), v.object({ models: v.record(v.string(), v.unknown()) }))
const modelSchema = v.object({
  cost: v.object({
    input: rateSchema,
    output: rateSchema,
    cache_read: v.optional(rateSchema),
    cache_write: v.optional(rateSchema),
  }),
})

/** Standard API rates only: cumulative turn usage cannot identify per-request pricing tiers. */
export function parseModelPrices(value: unknown, fetchedAt: string): PriceSnapshot {
  const catalog = v.parse(catalogSchema, value)
  const prices: PriceSnapshot['prices'] = {}
  for (const provider of ['openai', 'anthropic']) {
    Object.assign(prices, providerPrices(provider, catalog[provider]?.models ?? {}))
  }

  return v.parse(priceSnapshotSchema, { fetchedAt, prices })
}

function providerPrices(provider: string, models: Record<string, unknown>) {
  const prices: PriceSnapshot['prices'] = {}
  for (const [model, value] of Object.entries(models)) {
    const parsed = v.safeParse(modelSchema, value)
    if (!parsed.success) continue
    const { cost } = parsed.output
    prices[`${provider}/${model}`] = {
      input: cost.input,
      output: cost.output,
      cacheRead: cost.cache_read ?? null,
      cacheWrite: cost.cache_write ?? null,
    }
  }
  return prices
}

export function modelPrice(
  snapshot: PriceSnapshot,
  driverKind: string,
  model: string,
): RecordedModelPrice | null {
  const provider = catalogProvider(driverKind)
  if (!provider) return null
  const price = snapshot.prices[`${provider}/${model}`]
  if (!price) return null
  return { ...price, provider, model, fetchedAt: snapshot.fetchedAt }
}

function catalogProvider(driverKind: string) {
  if (driverKind === 'codex') return 'openai'
  if (driverKind === 'claude') return 'anthropic'
  return null
}

export function estimateUsageCost(
  usage: ProviderUsageAmounts,
  price: RecordedModelPrice,
): number | null {
  if (usage.cacheReadTokens > 0 && price.cacheRead === null) return null
  if (usage.cacheWriteTokens > 0 && price.cacheWrite === null) return null
  return (
    (usage.inputTokens * price.input +
      usage.outputTokens * price.output +
      usage.cacheReadTokens * (price.cacheRead ?? 0) +
      usage.cacheWriteTokens * (price.cacheWrite ?? 0)) /
    1_000_000
  )
}
