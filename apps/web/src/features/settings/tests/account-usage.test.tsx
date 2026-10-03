import { act, screen, waitFor } from '@testing-library/react'
import { vi } from 'vitest'
import { focusManager } from '@tanstack/react-query'
import { providerInstanceIdSchema } from '@workspace/contracts'
import * as v from 'valibot'
import { appUsageCollector } from 'server/testing'

import { expect, test } from '../../../../test/fixtures'
import { useProviderUsage } from '@/features/chat/hooks/use-provider-usage'
import { accountUsageFixture } from '../../../../test/factories/account-usage'
import { UsageObservationFixtureAdapter } from '../../../../test/factories/usage'
import { renderHookWithProviders, renderWithProviders } from '../../../../test/render'
import { TranscriptCoverage } from '@/features/settings/components/transcript-coverage'
import { usageSourceLabel } from '@/features/settings/utils/usage-source-label'
import { ProviderAccountUsageDetails } from '@/components/provider-account-usage-details'
import { composerUsageReadout } from '@/features/chat/utils/usage-meter'
import {
  accountsUsageFor,
  observedUsageLabel,
  usageAccountLabel,
  usageWindowState,
} from '@/lib/provider-usage'

const instance = v.parse(providerInstanceIdSchema, 'usage-group-fixture')
const now = Date.parse('2026-10-03T12:00:00.000Z')

test('a mapped rotating group retains every account including configured unseen accounts', () => {
  const fixture = accountUsageFixture(now)
  expect(accountsUsageFor(fixture, instance).map((account) => account.accountKey)).toEqual([
    'first',
    'second',
  ])
  expect(accountsUsageFor(fixture, null)).toEqual([])
  expect(accountsUsageFor(fixture, v.parse(providerInstanceIdSchema, 'unmapped'))).toEqual([])
})

test('window age comes from its own observation and reset passing retains the historical value', ({
  client,
}) => {
  expect(client).toBeDefined()
  const view = renderWithProviders(
    <ProviderAccountUsageDetails
      account={accountUsageFixture(now).accounts[0]!}
      label='Codex account 1'
      nowMs={now}
    />,
  )
  expect(view.container).toHaveTextContent('81% used')
  expect(view.container).toHaveTextContent('Reset passed')
  expect(view.container).toHaveTextContent('Observed 2h ago')
  expect(view.container).not.toHaveTextContent('Observed 2m ago')
  view.unmount()
})

test('no-data stays explicit and unknown age never reads as a fresh zero', ({ client }) => {
  expect(client).toBeDefined()
  expect(observedUsageLabel(null, now)).toBe('Observation time unavailable')
  const view = renderWithProviders(
    <ProviderAccountUsageDetails
      account={accountUsageFixture(now).accounts[1]!}
      label='Codex account 2'
      nowMs={now}
    />,
  )
  expect(screen.getByText('No allowance observation')).toBeInTheDocument()
  expect(view.container).not.toHaveTextContent('0%')
  view.unmount()
})

test('mounted idle composer receives a passive cache observation while repeated GET reads leave provider calls unchanged', async ({
  server,
  client,
}) => {
  expect(client).toBeDefined()
  const adapter = new UsageObservationFixtureAdapter()
  await server.restart({ providerAdapter: adapter })
  const baseline = await client.providers.usage.get()
  expect(baseline.error).toBeNull()
  expect(accountsUsageFor(baseline.data ?? undefined, adapter.adapterKey)).toHaveLength(1)
  await waitFor(() => expect(adapter.usageReads).toBeGreaterThan(0))
  const reads = adapter.usageReads
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
  focusManager.setFocused(true)
  const view = renderHookWithProviders(() => useProviderUsage(adapter.adapterKey, null))
  try {
    await waitFor(() =>
      expect(view.queryClient.getQueryData(['providers', 'usage'])).toMatchObject({
        accounts: expect.arrayContaining([
          expect.objectContaining({ providerInstanceIds: [adapter.adapterKey] }),
        ]),
      }),
    )
    await waitFor(() =>
      expect(view.result.current.accounts, 'mounted hook exposes its queried account').toHaveLength(
        1,
      ),
    )
    expect(view.result.current.accounts[0]?.windows).toEqual([])
    const checkedAt = accountsUsageFor(baseline.data ?? undefined, adapter.adapterKey)[0]?.checkedAt
    expect(checkedAt).toBeTruthy()
    appUsageCollector(server.app).accept(adapter.usageObservation(checkedAt!))
    const published = await client.providers.usage.get()
    expect(
      accountsUsageFor(published.data ?? undefined, adapter.adapterKey)[0]?.windows[0]?.usedPercent,
    ).toBe(42)
    // The source updates the real server cache; only the query's idle interval updates the UI.
    expect(view.result.current.accounts[0]?.windows).toEqual([])
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000)
    })
    await waitFor(() =>
      expect(
        accountsUsageFor(
          view.queryClient.getQueryData(['providers', 'usage']),
          adapter.adapterKey,
        )[0]?.windows[0]?.usedPercent,
        'polled cache contains the new window',
      ).toBe(42),
    )
    await waitFor(() =>
      expect(
        view.result.current.accounts[0]?.windows[0]?.usedPercent,
        'hook exposes the polled window',
      ).toBe(42),
    )
    for (let index = 0; index < 5; index += 1) {
      const response = await client.providers.usage.get()
      expect(
        accountsUsageFor(response.data ?? undefined, adapter.adapterKey)[0]?.windows[0]
          ?.usedPercent,
      ).toBe(42)
    }
    expect(adapter.usageReads).toBe(reads)
  } finally {
    view.unmount()
    focusManager.setFocused(undefined)
    vi.useRealTimers()
  }
})

test('native credits and reset grants keep separate units, and status-only windows stay unknown', ({
  client,
}) => {
  expect(client).toBeDefined()
  const account = accountUsageFixture(now).accounts[0]!
  const statusOnly = {
    ...account,
    windows: [{ ...account.windows[0]!, usedPercent: null, status: 'warning' as const }],
  }
  const view = renderWithProviders(
    <ProviderAccountUsageDetails account={statusOnly} label='Codex account 1' nowMs={now} />,
  )
  expect(view.container).toHaveTextContent('Usage percentage unknown')
  expect(view.container).toHaveTextContent('Provider status: warning')
  expect(view.container).toHaveTextContent('Provider credits: 2.5')
  expect(view.container).toHaveTextContent('Usage-reset grants: 1')
  expect(view.container).not.toHaveTextContent('$2.5')
  view.unmount()
})

test('freshness ages under the configured policy and grouped composer readout never sums allowances', () => {
  const fixture = accountUsageFixture(now)
  expect(composerUsageReadout(fixture.accounts, now, 900_000)).toBe('2 accounts')
  expect(composerUsageReadout([], now, 900_000)).toBe('Unknown')
  const current = {
    ...fixture.accounts[0]!,
    windows: [
      {
        ...fixture.accounts[0]!.windows[0]!,
        observedAt: new Date(now - 60_000).toISOString(),
        resetsAt: null,
        freshness: 'fresh' as const,
      },
    ],
  }
  expect(composerUsageReadout([current], now, 900_000)).toBe('81%')
  expect(composerUsageReadout([current], now + 900_000, 900_000)).toBe('Unknown')
  expect(usageWindowState(current.windows[0]!, now + 900_000, 900_000)).toBe('Stale observation')
})

test('partial local coverage names unreadable sources and unidentified records', ({ client }) => {
  expect(client).toBeDefined()
  const view = renderWithProviders(
    <TranscriptCoverage
      coverage={{
        scope: 'local-transcripts',
        accountAttribution: 'unverified',
        costMeaning: 'api-equivalent-estimate',
        status: 'partial',
        scannedAt: null,
        bytesRead: 0,
        sources: [
          {
            id: 'fixture-source',
            hostId: 'fixture-host',
            sourceKind: 'native-transcript',
            driverKind: 'codex',
            status: 'unreadable',
            scannedAt: null,
            latestEventAt: null,
            files: 1,
            records: 2,
            malformedLines: 1,
            oversizedLines: 0,
            unidentifiedRecords: 2,
          },
        ],
      }}
    />,
  )
  expect(view.container).toHaveTextContent('Coverage is limited to this host')
  expect(view.container).toHaveTextContent('Codex transcripts · unreadable')
  expect(view.container).toHaveTextContent('2 source-scoped records with unknown billing identity')
  expect(view.container).toHaveTextContent('Scan status: partial')
  view.unmount()
})

test('source labels keep Fregat session and utility coverage separate from native stores', () => {
  expect(usageSourceLabel('fregat-session', 'opencode')).toBe('Fregat sessions')
  expect(usageSourceLabel('fregat-utility', 'fregat')).toBe('Fregat utility generations')
  expect(usageSourceLabel('native-transcript', 'claude')).toBe('Claude transcripts')
})

test('unclassified and future-dated observations never acquire a current composer percentage', () => {
  const account = accountUsageFixture(now).accounts[0]!
  const window = {
    ...account.windows[0]!,
    resetsAt: null,
    observedAt: null,
    freshness: 'unknown' as const,
  }
  expect(usageWindowState(window, now, 900_000)).toBe('Freshness unknown')
  expect(composerUsageReadout([{ ...account, windows: [window] }], now, 900_000)).toBe('Unknown')
  const future = {
    ...window,
    observedAt: new Date(now + 60_000).toISOString(),
    freshness: 'fresh' as const,
  }
  expect(observedUsageLabel(future.observedAt, now)).toBe('Observation time unavailable')
  expect(usageWindowState(future, now, 900_000)).toBe('Freshness unknown')
})

test('two windows on one account retain separate ages and freshness', ({ client }) => {
  expect(client).toBeDefined()
  const account = accountUsageFixture(now).accounts[0]!
  const currentWindow = {
    ...account.windows[0]!,
    id: 'five-hour',
    label: 'Five-hour',
    usedPercent: 19,
    resetsAt: new Date(now + 60_000).toISOString(),
    observedAt: account.checkedAt,
    freshness: 'fresh' as const,
  }
  const view = renderWithProviders(
    <ProviderAccountUsageDetails
      account={{ ...account, windows: [currentWindow, ...account.windows] }}
      label='Codex account 1'
      nowMs={now}
    />,
  )
  expect(view.container).toHaveTextContent('Observed 2m ago')
  expect(view.container).toHaveTextContent('Observed 2h ago')
  expect(view.container).toHaveTextContent('Current observation')
  expect(view.container).toHaveTextContent('Reset passed')
  view.unmount()
})

test('account labels prefer sanitized metadata and keep numbered fallbacks', () => {
  const account = accountUsageFixture(now).accounts[0]!
  expect(usageAccountLabel({ ...account, label: 'fixture.person' }, 0)).toBe('fixture.person')
  expect(usageAccountLabel({ ...account, label: 'fixture.person' }, 1)).toBe('fixture.person')
  expect(usageAccountLabel(account, 1)).toBe('Codex account 2')
})
