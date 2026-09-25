import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ProviderUsageHistory } from '@workspace/contracts'

import { UsageSection } from '@/features/settings/components/usage-section'
import { settingsQueryKeys } from '@/features/settings/utils/query-keys'
import { expect, test } from '../../../../test/fixtures'

function history(models: string[], days: 7 | 30 = 30): ProviderUsageHistory {
  return {
    daily: [],
    days,
    purposes: [],
    since: '2026-09-01T00:00:00.000Z',
    totals: { costUsd: 3, tokens: 300, turns: 3, unpricedTokens: 0 },
    models: models.map((model) => ({
      model,
      driverKind: 'claude',
      costUsd: 1,
      costSource: 'provider',
      rates: null,
      inputTokens: 100,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      reasoningTokens: 0,
      turns: 1,
    })),
  }
}

const key = (days: 7 | 30) => settingsQueryKeys.usageHistory(days, -new Date().getTimezoneOffset())

test.each(['range', 'refetch'] as const)(
  'keeps a model visible after a %s removes the only visible model',
  async (change) => {
    const client = new QueryClient()
    client.setQueryData(key(30), history(['A', 'B', 'C']))
    client.setQueryData(key(7), history(['A', 'B'], 7))
    const view = render(
      <QueryClientProvider client={client}>
        <UsageSection />
      </QueryClientProvider>,
    )
    fireEvent.click(screen.getByRole('button', { name: /^A / }))
    fireEvent.click(screen.getByRole('button', { name: /^B / }))
    expect(screen.getByRole('button', { name: /^C / })).toHaveAttribute('aria-pressed', 'true')

    if (change === 'range') fireEvent.click(screen.getByRole('button', { name: '7 days' }))
    if (change === 'refetch') act(() => client.setQueryData(key(30), history(['A', 'B'])))
    await waitFor(() => expect(screen.queryByRole('button', { name: /^C / })).toBeNull())

    const a = screen.getByRole('button', { name: /^A / })
    const b = screen.getByRole('button', { name: /^B / })
    expect([a, b].some((row) => row.getAttribute('aria-pressed') === 'true')).toBe(true)
    fireEvent.click(a)
    fireEvent.click(b)
    expect([a, b].some((row) => row.getAttribute('aria-pressed') === 'true')).toBe(true)
    view.unmount()
    client.clear()
  },
)
