import '@workspace/ui/globals.css'
import { screen, waitFor } from '@testing-library/react'
import { expect, test } from 'vitest'
import { page } from 'vitest/browser'
import * as v from 'valibot'
import { providerAccountUsageSchema } from '@workspace/contracts'
import { createEnvironmentClient } from '@workspace/client-core/transport/client'
import { ResetCreditAction } from '@/features/chat/components/reset-credit-action'
import { activeServerOrigin } from '@/lib/client'
import { installTestClient } from '../../../../test/factories/client-binding'
import { renderWithProviders } from '../../../../test/render'

// Only the spending boundary is replaced. This test cannot reach a real credit endpoint.
test('reset credit confirmation and pending state work in Chromium', async () => {
  const account = v.parse(providerAccountUsageSchema, {
    accountKey: 'fixture-credential-home',
    driverKind: 'codex',
    providerInstanceIds: ['codex'],
    planType: 'pro',
    windows: [],
    checkedAt: new Date().toISOString(),
    resetCredits: {
      available: 1,
      accountKey: 'fixture-native-account',
      creditId: 'fixture-credit',
    },
  })
  const requests: unknown[] = []
  const response = Promise.withResolvers<Response>()
  const fetcher: typeof fetch = Object.assign(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init)
      if (!new URL(request.url).pathname.endsWith('/reset-credit')) return fetch(request)
      requests.push(await request.json())
      return response.promise
    },
    { preconnect: fetch.preconnect },
  )
  const restore = installTestClient(
    createEnvironmentClient({ origin: activeServerOrigin(), fetcher }),
  )
  const view = renderWithProviders(<ResetCreditAction account={account} />)
  try {
    await page.getByRole('button', { name: 'Use reset credit…' }).click()
    expect(requests).toEqual([])
    await page.screenshot({ path: 'reset-credit-confirmation.png' })
    await page.getByRole('button', { name: 'Cancel' }).click()
    expect(requests).toEqual([])
    await page.getByRole('button', { name: 'Use reset credit…' }).click()
    await page.getByRole('button', { name: 'Confirm' }).click()
    await waitFor(() => expect(requests).toHaveLength(1))
    expect(requests[0]).toEqual({
      accountKey: 'fixture-native-account',
      creditId: 'fixture-credit',
      checkedAt: account.checkedAt,
      confirmed: true,
    })
    expect(screen.getByRole('button', { name: 'Use reset credit…' })).toBeDisabled()
    response.resolve(
      Response.json({ outcome: 'reset', refresh: 'confirmed', usage: { accounts: [] } }),
    )
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Usage limits reset.'))
  } finally {
    view.unmount()
    view.queryClient.clear()
    restore()
  }
})
