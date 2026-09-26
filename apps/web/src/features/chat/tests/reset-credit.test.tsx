import { fireEvent, screen, waitFor } from '@testing-library/react'
import * as v from 'valibot'
import { providerAccountUsageSchema, type ProviderUsageWindow } from '@workspace/contracts'
import { MockProviderAdapter } from 'server/testing'
import { ResetCreditAction } from '@/features/chat/components/reset-credit-action'
import { providerUsageKeys } from '@/features/chat/utils/query-keys'
import { expect, test } from '../../../../test/fixtures'
import { renderWithProviders } from '../../../../test/render'

const account = v.parse(providerAccountUsageSchema, {
  accountKey: 'fixture-account',
  driverKind: 'codex',
  providerInstanceIds: ['codex'],
  planType: 'pro',
  windows: [],
  checkedAt: '2026-09-25T10:00:00.000Z',
  resetCredits: { available: 1, accountKey: 'fixture-account', creditId: 'fixture-credit' },
})

class ResetCreditFixture extends MockProviderAdapter {
  readonly keys: string[] = []
  async consumeResetCredit(input: { idempotencyKey: string }) {
    this.keys.push(input.idempotencyKey)
    return 'reset' as const
  }
  async readUsage() {
    const window: ProviderUsageWindow = {
      id: 'primary',
      kind: 'session',
      label: 'Session',
      usedPercent: this.keys.length ? 0 : 100,
      resetsAt: new Date(Date.now() + 60_000).toISOString(),
      windowMinutes: 5,
      status: 'allowed',
    }
    return {
      kind: 'reading' as const,
      update: { planType: 'pro', windows: [window] },
      resetCredits: {
        available: this.keys.length ? 0 : 1,
        accountKey: 'fixture-account',
        creditId: 'fixture-credit',
      },
    }
  }
}

test('requires confirmation, calls the real route once and settles usage cache', async ({
  server,
  client,
}) => {
  const adapter = new ResetCreditFixture()
  await server.restart({ providerAdapter: adapter })
  const response = await client.providers.usage.get()
  expect(response.error).toBeNull()
  const actual = response.data?.accounts[0]
  expect(actual).toBeDefined()
  if (!actual) return
  const view = renderWithProviders(<ResetCreditAction account={actual} />)
  try {
    fireEvent.click(screen.getByRole('button', { name: 'Use reset credit…' }))
    expect(screen.getByRole('dialog')).toBeVisible()
    expect(adapter.keys).toEqual([])
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(adapter.keys).toEqual([])
    fireEvent.click(screen.getByRole('button', { name: 'Use reset credit…' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    await waitFor(() => expect(adapter.keys).toHaveLength(1))
    await waitFor(() =>
      expect(view.queryClient.getQueryData(providerUsageKeys.all)).toMatchObject({
        accounts: [{ resetCredits: { available: 0 }, windows: [{ usedPercent: 0 }] }],
      }),
    )
  } finally {
    view.unmount()
    view.queryClient.clear()
  }
})

test('a pending reset remains retryable after the last available credit disappears', () => {
  const view = renderWithProviders(
    <ResetCreditAction
      account={{
        ...account,
        resetCredits: { available: 0, accountKey: 'fixture-account', creditId: 'fixture-credit' },
        resetPending: true,
      }}
    />,
  )
  try {
    fireEvent.click(screen.getByRole('button', { name: 'Check reset attempt…' }))
    expect(screen.getByText('This retries the same reset attempt.')).toBeVisible()
  } finally {
    view.unmount()
    view.queryClient.clear()
  }
})
