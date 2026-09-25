import { strictEqual } from 'node:assert/strict'
import { selectors, settleAnimations } from '../selectors'
import type { Scenario } from './index'

const historyRoute = /\/providers\/usage\/history(\?|$)/
const DAY_MS = 86_400_000

/** Local midnight `days - 1` days back, as the server computes `since` for this zone. */
function rangeStart(days: number) {
  const midnight = new Date()
  midnight.setHours(0, 0, 0, 0)

  return new Date(midnight.getTime() - (days - 1) * DAY_MS)
}

// `en-CA` formats a local date as `YYYY-MM-DD`, the day key the page uses.
const localDay = new Intl.DateTimeFormat('en-CA').format

/** A month of mixed spend: Claude priced by its CLI, one Codex model with no price. */
function historyFixture() {
  const since = rangeStart(30)
  const daily = [2, 5, 6, 12, 20, 21, 27, 29].map((offset, index) => ({
    costUsd: 0.4 + index * 0.35,
    day: localDay(new Date(since.getTime() + offset * DAY_MS + DAY_MS / 2)),
    tokens: 120_000 + index * 40_000,
  }))
  const model = (fields: Record<string, unknown>) => ({
    cacheReadTokens: 800_000,
    cacheWriteTokens: 40_000,
    inputTokens: 90_000,
    outputTokens: 60_000,
    reasoningTokens: 12_000,
    turns: 14,
    ...fields,
  })

  return {
    daily,
    days: 30,
    models: [
      model({
        costSource: 'provider',
        costUsd: 9.87,
        driverKind: 'claude',
        model: 'claude-opus-5-5',
      }),
      model({
        costSource: 'provider',
        costUsd: 0.31,
        driverKind: 'claude',
        model: 'claude-haiku-4-5',
      }),
      model({ costSource: 'none', costUsd: null, driverKind: 'codex', model: 'gpt-6-astra' }),
    ],
    purposes: [
      { costUsd: 10.02, purpose: 'turn', tokens: 2_700_000, turns: 38 },
      { costUsd: 0.12, purpose: 'title', tokens: 40_000, turns: 9 },
      { costUsd: 0.04, purpose: 'commit-message', tokens: 30_000, turns: 3 },
    ],
    since: since.toISOString(),
    totals: { costUsd: 10.18, tokens: 2_970_000, turns: 50, unpricedTokens: 990_000 },
  }
}

async function openUsageSettings(page: Parameters<Scenario['run']>[0]) {
  await selectors.windowToolbar(page).waitFor({ timeout: 45_000 })
  await page.keyboard.press('Control+,')
  await selectors.settingsSearch(page).fill('usage.modelPrices')
}

export const settingsUsage: Scenario = {
  name: 'settings-usage',
  description:
    'Settings › Usage: the real history read answers, then a fixed month drives the headline, day chart, model and purpose rows and the price editor. Writes no prices.',
  async run(page, { step }) {
    const realRead = page.waitForResponse(historyRoute, { timeout: 45_000 })
    await page.reload()
    await openUsageSettings(page)
    const response = await realRead
    strictEqual(response.status(), 200, 'GET /providers/usage/history')
    await selectors.usageSection(page).waitFor({ timeout: 20_000 })
    await step('real-read')

    await page.route(historyRoute, (route) =>
      route.fulfill({ contentType: 'application/json', json: historyFixture() }),
    )
    try {
      await page.reload()
      await openUsageSettings(page)
      await selectors.usageSummary(page).waitFor({ timeout: 20_000 })
      strictEqual(await selectors.usageChartBars(page).count(), 30, 'one bar slot per day')
      strictEqual(await selectors.usageModelRows(page).count(), 3, 'one row per model')
      strictEqual(await selectors.usagePriceRows(page).count(), 1, 'only the unpriced model')
      await page.mouse.move(0, 0)
      await step('month')

      await selectors.usageChartBars(page).nth(29).hover()
      const tooltip = selectors.tooltipPopup(page)
      await tooltip.waitFor({ timeout: 5_000 })
      await settleAnimations(tooltip)
      await step('bar-hover')

      await page.mouse.move(0, 0)
      await selectors.usagePriceRows(page).first().scrollIntoViewIfNeeded()
      await step('prices')
    } finally {
      await page.unroute(historyRoute)
    }
  },
}
