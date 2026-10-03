import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import * as v from 'valibot'
import { providerAccountUsageSchema, providerInstanceIdSchema } from '@workspace/contracts'
import { appUsageCollector } from 'server/testing'
import { ResetCreditFixtureAdapter } from '../../../../test/factories/usage'
import { UsageLimitsMeter } from '@/features/chat/components/usage-limits-meter'
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

test('requires confirmation, calls the real route once and settles usage cache', async ({
  server,
  client,
}) => {
  const adapter = new ResetCreditFixtureAdapter()
  await server.restart({ providerAdapter: adapter })
  const response = await client.providers.usage.get()
  expect(response.error).toBeNull()
  const cached = response.data?.accounts.find((item) =>
    item.providerInstanceIds.includes(adapter.adapterKey),
  )
  expect(cached).toBeDefined()
  if (!cached) return
  // The restart retains the previous adapter's cache cooldown; seed the replacement's grant explicitly.
  await appUsageCollector(server.app).refreshAccount(cached.accountKey)
  const actual = (await client.providers.usage.get()).data?.accounts.find((item) =>
    item.providerInstanceIds.includes(adapter.adapterKey),
  )
  expect(actual).toBeDefined()
  if (!actual) return
  expect(actual.resetCredits).toMatchObject({
    available: 1,
    creditId: `fixture-credit-${adapter.adapterKey}`,
  })
  const view = renderWithProviders(<ResetCreditAction account={actual} />)
  try {
    fireEvent.click(await screen.findByRole('button', { name: 'Use reset credit…' }))
    expect(screen.getByRole('dialog')).toBeVisible()
    expect(adapter.keys).toEqual([])
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(adapter.keys).toEqual([])
    fireEvent.click(await screen.findByRole('button', { name: 'Use reset credit…' }))
    fireEvent.click(screen.getByRole('button', { name: 'Use 1 credit' }))
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
    fireEvent.click(screen.getByRole('button', { name: 'Check last reset…' }))
    expect(
      screen.getByText('Sends your last reset request again to see whether it went through.'),
    ).toBeVisible()
  } finally {
    view.unmount()
    view.queryClient.clear()
  }
})

test('a grouped meter consumes the selected second account grant without touching its peer', async ({
  server,
  client,
}) => {
  const first = new ResetCreditFixtureAdapter({
    providerInstanceId: v.parse(providerInstanceIdSchema, 'reset-peer'),
  })
  const second = new ResetCreditFixtureAdapter({
    providerInstanceId: v.parse(providerInstanceIdSchema, 'reset-target'),
  })
  await server.restart({ providerAdapter: first, additionalProviderAdapters: [second] })
  const response = await client.providers.usage.get()
  expect(response.error).toBeNull()
  const firstAccount = response.data!.accounts.find((item) =>
    item.providerInstanceIds.includes(first.adapterKey),
  )!
  const secondAccount = response.data!.accounts.find((item) =>
    item.providerInstanceIds.includes(second.adapterKey),
  )!
  expect(firstAccount.resetCredits?.available).toBe(1)
  expect(secondAccount.resetCredits?.available).toBe(1)
  const view = renderWithProviders(<UsageLimitsMeter accounts={[firstAccount, secondAccount]} />)
  try {
    fireEvent.click(await screen.findByRole('button', { name: 'Account allowances · 2 accounts' }))
    const details = document.querySelector(
      `[data-account-usage="${secondAccount.accountKey}"]`,
    )!.parentElement!
    fireEvent.click(within(details).getByRole('button', { name: 'Use reset credit…' }))
    fireEvent.click(screen.getByRole('button', { name: 'Use 1 credit' }))
    await waitFor(() => expect(second.keys).toHaveLength(1))
    expect(first.keys).toEqual([])
    await waitFor(() => {
      const cache = view.queryClient.getQueryData<{
        accounts: Array<{ accountKey: string; resetCredits?: { available: number } }>
      }>(providerUsageKeys.all)
      expect(
        cache?.accounts.find((item) => item.accountKey === secondAccount.accountKey)?.resetCredits
          ?.available,
      ).toBe(0)
      expect(
        cache?.accounts.find((item) => item.accountKey === firstAccount.accountKey)?.resetCredits
          ?.available,
      ).toBe(1)
    })
  } finally {
    view.unmount()
    view.queryClient.clear()
  }
})
