import { act, screen, waitFor } from '@testing-library/react'
import { vi } from 'vitest'
import { formatContextTokens } from '@workspace/client-core/chat/context-usage'
import { usageTokenCount } from '@workspace/contracts'
import { createFederationHarness } from '../../../../test/factories/federation'
import { recordUtilityUsageFixture } from '../../../../test/factories/usage'
import { renderWithProviders } from '../../../../test/render'
import { expect, test } from '../../../../test/fixtures'
import { UsageSection } from '@/features/settings/components/usage-section'
import { queryClientFor } from '@/lib/environments/state/query-clients'
import { usageHistoryQueryOptions } from '@/features/settings/utils/usage-history-query'
import { settingsQueryKeys } from '@/features/settings/utils/query-keys'
import { usageCacheSavings, usageCacheSavingsTotal } from '@/features/settings/utils/usage'

test('usage page reads its selected owner and refreshes real recorded history without changing the other machine', async ({
  server,
  client,
}) => {
  expect(client).toBeDefined()
  const federation = await createFederationHarness(server)
  await recordUtilityUsageFixture(server, 2)
  const remote = await recordUtilityUsageFixture(federation.serverB, 8)
  remote.record('unknown', 'unknown-model')
  const owner = queryClientFor(federation.originB)
  const primary = queryClientFor(federation.originA)
  const options = usageHistoryQueryOptions(30, -new Date().getTimezoneOffset())
  const beforeA = await primary.query(options)
  const beforeB = await owner.query(options)
  expect(beforeA.totals).toMatchObject({ tokens: 1_600_000, costUsd: 3.25, turns: 1 })
  expect(beforeB.totals).toMatchObject({
    tokens: 3_200_000,
    costUsd: 9.25,
    turns: 2,
    unpricedTokens: 1_600_000,
  })
  const priced = beforeB.models.find((row) => row.model === 'fixture-model')!
  expect(usageTokenCount(priced)).toBe(1_600_000)
  expect(usageCacheSavings(priced)).toBe(3.75)
  expect(usageCacheSavings(beforeB.models.find((row) => row.model === 'unknown-model')!)).toBeNull()
  const view = renderWithProviders(<UsageSection />, { settingsOwner: owner })
  try {
    await waitFor(() =>
      expect(view.container.querySelector('[data-usage-summary]')).toHaveTextContent('$9.25'),
    )
    expect(view.container.querySelector('[data-usage-summary]')).toHaveTextContent(
      'Cache savings $3.75',
    )
    expect(view.container.querySelector('[data-usage-summary]')).toHaveTextContent(
      `Excludes ${formatContextTokens(500_000)} cached tokens`,
    )
    expect(screen.getByText('Price unavailable', { exact: true })).toBeInTheDocument()
    remote.record('refreshed')
    await act(async () => {
      await owner.invalidateQueries({ queryKey: settingsQueryKeys.usageHistoryAll })
    })
    await waitFor(() =>
      expect(view.container.querySelector('[data-usage-summary]')).toHaveTextContent('$18.50'),
    )
    expect(view.container.querySelector('[data-usage-summary]')).toHaveTextContent(
      'Cache savings $7.50',
    )
    const afterB = await owner.query(options)
    expect(afterB.totals).toMatchObject({ tokens: 4_800_000, costUsd: 18.5, turns: 3 })
    expect(await primary.query(options)).toEqual(beforeA)
  } finally {
    view.unmount()
  }
  const local = renderWithProviders(<UsageSection />, { settingsOwner: primary })
  try {
    await waitFor(() =>
      expect(local.container.querySelector('[data-usage-summary]')).toHaveTextContent('$3.25'),
    )
    expect(local.container.querySelector('[data-usage-summary]')).toHaveTextContent(
      'Cache savings $0.75',
    )
  } finally {
    local.unmount()
  }
})

test('cache savings stay unavailable when recorded prices differ inside the selected range', async ({
  server,
  client,
}) => {
  expect(client).toBeDefined()
  const recordedAt = new Date().toISOString()
  await recordUtilityUsageFixture(server, 2, recordedAt)
  try {
    // Expire catalog freshness while keeping both recorded events inside the server's range.
    vi.setSystemTime(Date.now() + 25 * 60 * 60_000)
    await recordUtilityUsageFixture(server, 4, recordedAt)
    const view = renderWithProviders(<UsageSection />)
    try {
      await waitFor(() =>
        expect(view.container.querySelector('[data-usage-summary]')).toHaveTextContent(
          'Cache savings unavailable',
        ),
      )
      const row = view.container.querySelector('[data-usage-model="fixture-model"]')
      expect(row).toHaveTextContent('Cache savings unavailable')
      const history = await view.queryClient.query(
        usageHistoryQueryOptions(30, -new Date().getTimezoneOffset()),
      )
      expect(history.models[0]?.rates).toBeNull()
      expect(history.totals.costUsd).toBe(8.5)
      expect(usageCacheSavings(history.models[0]!)).toBeNull()
    } finally {
      view.unmount()
    }
  } finally {
    vi.useRealTimers()
  }
})

test('cache savings count only cached reads at recorded input and cache-read rates', () => {
  const rates = { input: 2, output: 10, cacheRead: 0.5, cacheWrite: 5 }
  const known = { cacheReadTokens: 500_000, rates }
  const unknown = { cacheReadTokens: 700_000, rates: null }
  expect(usageCacheSavings(known)).toBe(0.75)
  expect(usageCacheSavings({ ...known, cacheReadTokens: 0 })).toBe(0)
  expect(usageCacheSavings({ ...known, rates: { ...rates, cacheRead: null } })).toBeNull()
  expect(usageCacheSavings(unknown)).toBeNull()
  expect(usageCacheSavingsTotal([known, unknown])).toEqual({
    costUsd: 0.75,
    excludedCachedTokens: 700_000,
  })
  expect(usageCacheSavingsTotal([unknown])).toEqual({
    costUsd: null,
    excludedCachedTokens: 700_000,
  })
})
