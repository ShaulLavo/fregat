import { accountUsageFixture } from '../../../apps/web/test/factories/account-usage'
import { providerDriverKindSchema } from '../../../packages/contracts/src/index'
import * as v from 'valibot'
import type {
  ProviderUsageDayRow,
  ProviderUsageHistory,
  ProviderUsageModelRow,
  ProviderUsageResult,
} from '../../../packages/contracts/src/index'
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
function historyFixture(): ProviderUsageHistory {
  const since = rangeStart(30)
  const day = (offset: number) => localDay(new Date(since.getTime() + offset * DAY_MS + DAY_MS / 2))
  const daily: ProviderUsageDayRow[] = [2, 5, 6, 12, 20, 21, 27, 29].map((offset, index) => {
    const costUsd = 0.4 + index * 0.35
    const tokens = 120_000 + index * 40_000
    return {
      costUsd,
      day: day(offset),
      models: [{ costUsd, driverKind: 'claude', model: 'claude-opus-5-5', tokens }],
      tokens,
      unpricedTokens: 0,
    }
  })
  // A day of only unpriced usage: measured by cost it draws no bar, so it gets a marker.
  daily.splice(4, 0, {
    costUsd: null,
    day: day(15),
    models: [{ costUsd: null, driverKind: 'codex', model: 'unknown-model', tokens: 4_100_000 }],
    tokens: 4_100_000,
    unpricedTokens: 4_100_000,
  })
  const model = (
    fields: Pick<ProviderUsageModelRow, 'costSource' | 'costUsd' | 'driverKind' | 'model'>,
  ): ProviderUsageModelRow => ({
    cacheReadTokens: 800_000,
    cacheWriteTokens: 40_000,
    inputTokens: 90_000,
    outputTokens: 60_000,
    rates: null,
    reasoningTokens: 12_000,
    turns: 14,
    ...fields,
  })

  return {
    daily,
    coverage: {
      scope: 'local-transcripts',
      accountAttribution: 'unverified',
      costMeaning: 'api-equivalent-estimate',
      status: 'partial',
      scannedAt: new Date(Date.now() - 5 * 60_000).toISOString(),
      bytesRead: 2048,
      sources: [
        {
          id: 'local-claude',
          hostId: 'fixture-host',
          sourceKind: 'native-transcript',
          driverKind: 'claude',
          status: 'ready',
          scannedAt: new Date(Date.now() - 5 * 60_000).toISOString(),
          latestEventAt: new Date().toISOString(),
          files: 4,
          records: 24,
          malformedLines: 0,
          oversizedLines: 0,
          unidentifiedRecords: 0,
        },
        {
          id: 'local-codex',
          hostId: 'fixture-host',
          sourceKind: 'native-transcript',
          driverKind: 'codex',
          status: 'unreadable',
          scannedAt: null,
          latestEventAt: null,
          files: 0,
          records: 0,
          malformedLines: 0,
          oversizedLines: 0,
          unidentifiedRecords: 0,
        },
        {
          id: 'local-utility',
          hostId: 'fixture-host',
          sourceKind: 'fregat-utility',
          driverKind: 'fregat',
          status: 'ready',
          scannedAt: new Date().toISOString(),
          latestEventAt: new Date().toISOString(),
          files: 0,
          records: 12,
          malformedLines: 0,
          oversizedLines: 0,
          unidentifiedRecords: 3,
        },
      ],
    },
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
      model({ costSource: 'catalog', costUsd: 1.82, driverKind: 'codex', model: 'gpt-6-astra' }),
      model({
        costSource: 'provider',
        costUsd: 0.21,
        driverKind: 'claude',
        model: 'claude-sonnet-5',
      }),
      model({
        costSource: 'provider',
        costUsd: 0.0042,
        driverKind: 'claude',
        model: 'claude-fable-5-1',
      }),
      model({ costSource: 'catalog', costUsd: 0.003, driverKind: 'codex', model: 'gpt-5.5-mini' }),
      model({ costSource: 'none', costUsd: null, driverKind: 'codex', model: 'unknown-model' }),
    ],
    purposes: [
      { costUsd: 10.02, purpose: 'turn', tokens: 2_700_000, turns: 38 },
      { costUsd: 0.12, purpose: 'title', tokens: 40_000, turns: 9 },
      { costUsd: 0.04, purpose: 'commit-message', tokens: 30_000, turns: 3 },
    ],
    since: since.toISOString(),
    totals: { costUsd: 12.0, tokens: 3_960_000, turns: 50, unpricedTokens: 990_000 },
  }
}

function allowanceFixture(): ProviderUsageResult {
  const now = Date.now()
  const at = (minutes: number) => new Date(now + minutes * 60_000).toISOString()
  return {
    accounts: [
      {
        accountKey: 'owner-native',
        label: 'fixture.native',
        driverKind: v.parse(providerDriverKindSchema, 'claude'),
        providerInstanceIds: [],
        planType: 'max',
        checkedAt: at(-2),
        source: 'claude-local-cache',
        routing: { mode: 'unknown', active: null, lastServedAt: null },
        windows: [
          {
            id: 'five_hour',
            kind: 'session',
            label: 'Five-hour',
            usedPercent: 42,
            resetsAt: at(120),
            windowMinutes: 300,
            status: 'allowed',
            observedAt: at(-2),
            source: 'claude-local-cache',
            freshness: 'fresh',
          },
          {
            id: 'seven_day',
            kind: 'weekly',
            label: 'Weekly',
            usedPercent: 83,
            resetsAt: at(3000),
            windowMinutes: 10080,
            status: 'warning',
            observedAt: at(-120),
            source: 'claude-local-cache',
            freshness: 'stale',
          },
        ],
      },
      ...accountUsageFixture(now).accounts.map((account, index) =>
        index === 0 ? { ...account, label: 'fixture.person' } : account,
      ),
    ],
  }
}

async function openUsageSettings(page: Parameters<Scenario['run']>[0]) {
  const search = selectors.settingsSearch(page)
  await search.or(selectors.settingsOpen(page)).first().waitFor({ timeout: 45_000 })
  if (!(await search.isVisible())) await selectors.settingsOpen(page).click()
  await search.fill('usage')
}

export const settingsUsage: Scenario = {
  name: 'settings-usage',
  readOnly: true,
  description:
    'Settings › Usage: the real history read answers, then a fixed month drives the headline, day chart, model and purpose rows with automatic estimates and unknown costs.',
  async run(page, { step, evidence }) {
    const realRead = page.waitForResponse(historyRoute, { timeout: 45_000 })
    await page.reload()
    await openUsageSettings(page)
    const response = await realRead
    strictEqual(response.status(), 200, 'GET /providers/usage/history')
    await selectors.usageSection(page).waitFor({ timeout: 20_000 })
    await step('real-read')

    const accountRoute = /\/providers\/usage(\?|$)/
    const reads: { method: string; path: string }[] = []
    const track = (request: import('playwright').Request) => {
      if (/\/providers\/usage(?:\/history)?(?:\?|$)/.test(request.url()))
        reads.push({ method: request.method(), path: new URL(request.url()).pathname })
    }
    page.on('request', track)
    await page.route(accountRoute, (route) =>
      route.fulfill({ contentType: 'application/json', json: allowanceFixture() }),
    )
    let unpricedOnly = false
    let holdRange = false
    let releaseRange!: () => void
    const rangeReady = new Promise<void>((resolve) => {
      releaseRange = resolve
    })
    await page.route(historyRoute, async (route) => {
      const sevenDays = new URL(route.request().url()).searchParams.get('days') === '7'
      if (sevenDays && holdRange) await rangeReady
      let json = historyFixture()
      if (sevenDays) json = sevenDayHistoryFixture()
      if (unpricedOnly) json = unpricedHistoryFixture()
      await route.fulfill({ contentType: 'application/json', json })
    })
    try {
      await page.reload()
      await openUsageSettings(page)
      await selectors.usageSummary(page).waitFor({ timeout: 20_000 })
      strictEqual(await selectors.allowanceAccounts(page).count(), 3, 'three independent accounts')
      await selectors.accountAllowances(page).getByText('fixture.native', { exact: true }).waitFor()
      await selectors.accountAllowances(page).getByText('fixture.person', { exact: true }).waitFor()
      await selectors
        .accountAllowances(page)
        .getByText('Codex account 2', { exact: true })
        .waitFor()
      await selectors
        .accountAllowances(page)
        .getByText('No allowance observation', { exact: true })
        .waitFor()
      await selectors
        .accountAllowances(page)
        .getByText(/Observed 2h(?: 1m)? ago/)
        .first()
        .waitFor()
      await selectors
        .transcriptCoverage(page)
        .getByText('Codex transcripts · unreadable', { exact: true })
        .waitFor()
      await selectors
        .accountAllowances(page)
        .getByRole('heading', { name: 'Account allowances', exact: true })
        .evaluate((heading) => heading.scrollIntoView({ block: 'start' }))
      await step('accounts-mixed-age-no-data')
      await selectors
        .accountAllowances(page)
        .getByText('No allowance observation', { exact: true })
        .scrollIntoViewIfNeeded()
      await step('configured-no-data')
      await selectors.transcriptCoverage(page).scrollIntoViewIfNeeded()
      await step('local-source-coverage')
      strictEqual(await selectors.usageChartBars(page).count(), 30, 'one bar slot per day')
      strictEqual(await selectors.usageModelRows(page).count(), 5, 'top five, the rest folded')
      await selectors
        .usageSection(page)
        .getByRole('button', { name: /^2 more · / })
        .click()
      strictEqual(await selectors.usageModelRows(page).count(), 7, 'the fold opens in place')
      await selectors.usageSection(page).getByText('$0.0042', { exact: true }).waitFor()
      strictEqual(
        await selectors.usageSection(page).getByRole('spinbutton').count(),
        0,
        'no manual price fields',
      )
      strictEqual(
        await selectors.usageSection(page).getByText('Price unavailable', { exact: true }).count(),
        1,
        'unknown model stays unpriced',
      )
      strictEqual(
        await selectors
          .usageSummary(page)
          .getByText('API-equivalent cost estimate', { exact: true })
          .count(),
        1,
      )
      await page.mouse.move(0, 0)
      await step('month')

      await selectors.usageChartBars(page).nth(29).hover()
      const tooltip = selectors.tooltipPopup(page)
      await tooltip.waitFor({ timeout: 5_000 })
      await settleAnimations(tooltip)
      await step('bar-hover')

      await page.mouse.move(0, 0)
      await selectors.usageModelRows(page).last().scrollIntoViewIfNeeded()
      await step('automatic-pricing')

      holdRange = true
      const rangeRead = page.waitForRequest(
        (request) =>
          historyRoute.test(request.url()) &&
          new URL(request.url()).searchParams.get('days') === '7',
      )
      await selectors.usageSection(page).getByRole('tab', { name: '7 days', exact: true }).click()
      await rangeRead
      strictEqual(
        await selectors
          .usageSection(page)
          .getByRole('tab', { name: '30 days', exact: true })
          .getAttribute('aria-selected'),
        'true',
        'held range header stays with the displayed response',
      )
      await selectors.usageSummary(page).getByText('$12.00', { exact: true }).waitFor()
      await selectors.transcriptCoverage(page).getByText('4 files · 24 records').waitFor()
      strictEqual(await selectors.usageChartBars(page).count(), 30, 'held body keeps month slots')
      await selectors.transcriptCoverage(page).scrollIntoViewIfNeeded()
      await step('held-range-pending')
      releaseRange()
      await selectors.usageSummary(page).getByText('$7.00', { exact: true }).waitFor()
      strictEqual(
        await selectors
          .usageSection(page)
          .getByRole('tab', { name: '7 days', exact: true })
          .getAttribute('aria-selected'),
        'true',
        'settled range header swaps with its body',
      )
      await selectors.transcriptCoverage(page).getByText('4 files · 7 records').waitFor()
      strictEqual(await selectors.usageChartBars(page).count(), 7, 'settled body shows week slots')
      await step('held-range-settled')
      holdRange = false
      unpricedOnly = true
      await page.reload()
      await openUsageSettings(page)
      await selectors.usageSummary(page).getByText('Price unavailable', { exact: true }).waitFor()
      strictEqual(
        await selectors.usageSection(page).getByText('$0.00', { exact: true }).count(),
        0,
        'unknown usage never looks free',
      )
      await step('unknown-prices')
    } finally {
      await page.unroute(historyRoute)
      await page.unroute(accountRoute)
      page.off('request', track)
      strictEqual(
        reads.every((read) => read.method === 'GET'),
        true,
        'Settings requests only cached GET projections',
      )
      await evidence.json('usage-read-counters.json', {
        reads,
        fixtureTransport: 'playwright route fulfilment for allowance and history display states',
        providerRequestsFromBrowser: 0,
        sourceRequestCountsVerifiedBy: 'real-server cache-only component test',
      })
    }
  },
}

function sevenDayHistoryFixture(): ProviderUsageHistory {
  const history = historyFixture()
  const source = history.coverage!.sources[0]!
  return {
    ...history,
    days: 7,
    since: rangeStart(7).toISOString(),
    daily: history.daily.slice(-2),
    totals: { ...history.totals, costUsd: 7 },
    coverage: { ...history.coverage!, sources: [{ ...source, records: 7 }] },
  }
}

function unpricedHistoryFixture(): ProviderUsageHistory {
  const history = historyFixture()
  return {
    ...history,
    daily: history.daily.map((day) => ({ ...day, costUsd: null })),
    models: history.models.filter((row) => row.costSource === 'none'),
    purposes: [{ costUsd: null, purpose: 'turn', tokens: 990_000, turns: 14 }],
    totals: { costUsd: null, tokens: 990_000, turns: 14, unpricedTokens: 990_000 },
  }
}
