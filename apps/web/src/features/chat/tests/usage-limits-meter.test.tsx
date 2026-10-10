import { fireEvent, screen } from '@testing-library/react'
import { vi } from 'vitest'
import { coarseClockStore } from '@/state/coarse-clock'
import { TranscriptCoverage } from '@/features/settings/components/transcript-coverage'
import { UsageLimitsMeter } from '@/features/chat/components/usage-limits-meter'
import { accountUsageFixture } from '../../../../test/factories/account-usage'
import { expect, test } from '../../../../test/fixtures'
import { renderWithProviders } from '../../../../test/render'

test('the rendered meter retains independent mapped accounts when management order changes', async ({
  client,
}) => {
  expect(client).toBeDefined()
  const accounts = accountUsageFixture(Date.now()).accounts
  const view = renderWithProviders(<UsageLimitsMeter accounts={accounts} />)
  try {
    fireEvent.click(await screen.findByRole('button', { name: 'Account allowances · 2 accounts' }))
    expect(
      await screen.findByText('Allowances apply independently.', { exact: false }),
    ).toBeVisible()
    expect(screen.getByText('No allowance observation')).toBeVisible()
    expect(screen.getAllByText('Account selection unknown')).toHaveLength(2)
    expect(screen.queryByText('Selected by source')).not.toBeInTheDocument()
    view.rerender(<UsageLimitsMeter accounts={[accounts[1]!, accounts[0]!]} />)
    expect(screen.getByRole('button', { name: 'Account allowances · 2 accounts' })).toBeVisible()
    expect(document.querySelectorAll('[data-account-usage]')).toHaveLength(2)
    expect(document.querySelector('[data-account-usage="first"]')).toHaveTextContent('81% used')
    expect(document.querySelector('[data-account-usage="second"]')).toHaveTextContent(
      'No allowance observation',
    )
    expect(screen.getAllByText('Account selection unknown')).toHaveLength(2)
  } finally {
    view.unmount()
  }
})

test('stale exhausted and reset-passed rows remain historical while the rendered trigger uses the fresh window', async ({
  client,
}) => {
  expect(client).toBeDefined()
  const now = Date.now()
  const account = accountUsageFixture(now).accounts[0]!
  const stale = {
    ...account.windows[0]!,
    id: 'stale-weekly',
    usedPercent: 100,
    status: 'rejected' as const,
    freshness: 'stale' as const,
    resetsAt: new Date(now + 60_000).toISOString(),
  }
  const fresh = {
    ...stale,
    id: 'five-hour',
    label: 'Five-hour',
    usedPercent: 19,
    status: 'allowed' as const,
    freshness: 'fresh' as const,
    observedAt: new Date(now - 120_000).toISOString(),
  }
  const windows: Parameters<typeof UsageLimitsMeter>[0]['accounts'][number]['windows'] = [
    stale,
    fresh,
  ]
  const view = renderWithProviders(
    <UsageLimitsMeter accounts={[{ ...account, windows: windows.concat(account.windows) }]} />,
  )
  try {
    fireEvent.click(await screen.findByRole('button', { name: 'Account allowances · 19%' }))
    await screen.findByText('100% used')
    const staleRow = document.querySelector('[data-account-window="stale-weekly"]')!
    const freshRow = document.querySelector('[data-account-window="five-hour"]')!
    const expiredRow = document.querySelector('[data-account-window="primary"]')!
    expect(staleRow).toHaveTextContent(/Observed 2h(?: 1m)? ago/)
    expect(staleRow).toHaveTextContent('Stale observation')
    expect(staleRow).toHaveTextContent('Provider status: rejected')
    expect(staleRow).not.toHaveTextContent('Observed just now')
    expect(freshRow).toHaveTextContent('19% used')
    expect(freshRow).toHaveTextContent(/Observed [23]m ago/)
    expect(freshRow).toHaveTextContent('Current observation')
    expect(expiredRow).toHaveTextContent('81% used')
    expect(expiredRow).toHaveTextContent('Reset passed')
    expect(
      screen.queryByRole('button', { name: 'Account allowances · 100%' }),
    ).not.toBeInTheDocument()
  } finally {
    view.unmount()
  }
})

test('native credits, unidentified reset grants and status-only windows stay separate in the real popover', async ({
  client,
}) => {
  expect(client).toBeDefined()
  const account = accountUsageFixture(Date.now()).accounts[0]!
  const view = renderWithProviders(
    <UsageLimitsMeter
      accounts={[
        {
          ...account,
          windows: [{ ...account.windows[0]!, usedPercent: null, status: 'warning' }],
        },
      ]}
    />,
  )
  try {
    fireEvent.click(await screen.findByRole('button', { name: 'Account allowances · Unknown' }))
    await screen.findByText('Usage percentage unknown')
    const details = document.querySelector('[data-account-usage="first"]') as HTMLElement
    expect(details).toHaveTextContent('Provider credits: 2.5')
    expect(details).toHaveTextContent('Usage-reset grants: 1')
    expect(details).not.toHaveTextContent('$2.5')
    expect(details).not.toHaveTextContent('0%')
    expect(screen.queryByRole('button', { name: 'Use reset credit…' })).not.toBeInTheDocument()
  } finally {
    view.unmount()
  }
})

test('query receipts expose fresh observations between clock ticks while future timestamps remain unknown', async ({
  client,
}) => {
  expect(client).toBeDefined()
  const mountedAt = Date.now()
  vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] })
  vi.setSystemTime(mountedAt)
  const account = accountUsageFixture(mountedAt).accounts[0]!
  const initialCoverage = {
    scope: 'local-transcripts' as const,
    accountAttribution: 'unverified' as const,
    costMeaning: 'api-equivalent-estimate' as const,
    status: 'ready' as const,
    scannedAt: null,
    bytesRead: 0,
    sources: [],
  }
  const view = renderWithProviders(
    <>
      <UsageLimitsMeter accounts={[{ ...account, windows: [] }]} receivedAtMs={mountedAt} />
      <TranscriptCoverage coverage={initialCoverage} receivedAtMs={mountedAt} />
    </>,
  )
  try {
    expect(coarseClockStore.getState().nowMs).toBe(mountedAt)
    const receivedAtMs = mountedAt + 10_000
    vi.setSystemTime(receivedAtMs)
    const currentWindow = {
      ...account.windows[0]!,
      usedPercent: 19,
      observedAt: new Date(receivedAtMs).toISOString(),
      resetsAt: new Date(receivedAtMs + 60_000).toISOString(),
      freshness: 'fresh' as const,
    }
    const coverage = { ...initialCoverage, scannedAt: currentWindow.observedAt }
    view.rerender(
      <>
        <UsageLimitsMeter
          accounts={[{ ...account, windows: [currentWindow] }]}
          receivedAtMs={receivedAtMs}
        />
        <TranscriptCoverage coverage={coverage} receivedAtMs={receivedAtMs} />
      </>,
    )
    expect(coarseClockStore.getState().nowMs).toBe(mountedAt)
    fireEvent.click(await screen.findByRole('button', { name: 'Account allowances · 19%' }))
    expect(await screen.findByText('Current observation')).toBeVisible()
    expect(screen.getAllByText('Observed just now', { exact: false })).toHaveLength(2)
    expect(
      screen.queryByText('Observation time unavailable', { exact: false }),
    ).not.toBeInTheDocument()
    const future = new Date(receivedAtMs + 60_000).toISOString()
    view.rerender(
      <>
        <UsageLimitsMeter
          accounts={[{ ...account, windows: [{ ...currentWindow, observedAt: future }] }]}
          receivedAtMs={receivedAtMs}
        />
        <TranscriptCoverage
          coverage={{ ...coverage, scannedAt: future }}
          receivedAtMs={receivedAtMs}
        />
      </>,
    )
    expect(screen.getByRole('button', { name: 'Account allowances · Unknown' })).toBeVisible()
    expect(screen.getByText('Freshness unknown')).toBeVisible()
    expect(screen.getAllByText('Observation time unavailable', { exact: false })).toHaveLength(2)
  } finally {
    view.unmount()
    vi.useRealTimers()
  }
})
