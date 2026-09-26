import { waitFor } from '@testing-library/react'
import { healthDescriptorSchema } from '@workspace/contracts'
import { toast } from 'sonner'
import * as v from 'valibot'
import { vi } from 'vitest'
import { expect, test } from '../../../../test/fixtures'
import { createObservedInProcessClient } from '../../../../test/client'
import { scopeAddressEnvironment } from '../../../../test/factories/address-environment'
import { renderAddressHarness, startAt, waitForNavigation } from '../../../../test/address'

// A token minted by a database this server no longer has.
const DEAD_ADDRESS = 'RjKnJca3LpfzgX1Y'

test('a workspace link the server does not know lands on the start page once', async ({
  client,
  server,
}) => {
  const lookups: string[] = []
  const observed = createObservedInProcessClient(server, (request) => {
    const pathname = new URL(request.url).pathname
    if (pathname.startsWith('/fs/workspace-address/')) lookups.push(pathname)
  })
  const descriptor = v.parse(healthDescriptorSchema, (await client.health.get()).data)
  const restoreEnvironment = scopeAddressEnvironment(
    'http://localhost:37911',
    descriptor.environmentId,
    observed,
  )
  const info = vi.spyOn(toast, 'info')
  localStorage.clear()
  startAt(`/~reports.${DEAD_ADDRESS}/chat/t/draft-a2018aa6-db55-42db-994b-b005d5816211`)
  const rendered = await renderAddressHarness()
  try {
    const status = await waitForNavigation(rendered.navigation)
    expect(status.status).toBe('applied')
    expect(rendered.harness.workspace.getState().rootFolder).toBeNull()
    await waitFor(() =>
      expect(rendered.navigation.router.history.location.pathname).not.toContain(DEAD_ADDRESS),
    )
    expect(rendered.navigation.router.history.location.pathname).toMatch(/^\/~-(\/|$)/)
    expect(info).toHaveBeenCalledTimes(1)
    await new Promise((resolve) => setTimeout(resolve, 300))
    expect(lookups).toEqual([`/fs/workspace-address/${DEAD_ADDRESS}`])
    expect(info).toHaveBeenCalledTimes(1)
  } finally {
    info.mockRestore()
    rendered.unmount()
    rendered.application.dispose()
    restoreEnvironment()
  }
})
