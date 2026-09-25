import { parseModelPrices } from '../src/provider/utils/model-prices'
import { createStructuredError } from '../src/observability/structured-errors'

const response = await fetch('https://models.dev/api.json', { signal: AbortSignal.timeout(15_000) })
if (!response.ok)
  throw createStructuredError({
    code: 'provider.PRICE_CATALOG_FETCH_FAILED',
    status: 502,
    message: `Price catalog returned HTTP ${response.status}`,
    why: 'The pricing catalog could not be downloaded.',
    fix: 'Retry when models.dev is reachable.',
  })
const snapshot = parseModelPrices(await response.json(), new Date().toISOString())
await Bun.write(
  new URL('../src/provider/model-prices.json', import.meta.url),
  `${JSON.stringify(snapshot, null, 2)}\n`,
)
