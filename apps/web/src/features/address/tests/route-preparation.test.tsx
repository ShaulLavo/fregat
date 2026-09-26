import { createMemoryHistory } from '@tanstack/react-router'
import { afterEach, vi } from 'vitest'
import { expect, test } from '../../../../test/fixtures'
import { testWorkspaceToken } from '../../../../test/factories/workspace-address'
import { createApplicationRouter } from '@/state/router'
import { settingsPageQueryOptions } from '@/features/settings/utils/page-query'
import { createResourceQueryClient } from '@/lib/resources/state/query-client'
import { hasAvailableRoute } from '@/features/address/utils/route-options'

const workspace = testWorkspaceToken('/preparation-proof')
const environment = '499c1da4-fd11-4701-a7d1-0d19381e8fd5'

afterEach(() => vi.restoreAllMocks())

test.each([`/~${workspace}`, `/@${environment}/~${workspace}`])(
  'preload prepares settings before activation in %s',
  async (prefix) => {
    const resources = createResourceQueryClient()
    const load = vi.spyOn(settingsPageQueryOptions, 'queryFn')
    const router = createApplicationRouter({ resources, history: createMemoryHistory() })
    await router.preloadRoute({ to: `${prefix}/workbench/settings` })
    expect(router.state.location.pathname).toBe('/')
    const module = await resources.query(settingsPageQueryOptions)
    expect(module.SettingsPage).toBeTypeOf('function')
    expect(load).toHaveBeenCalledTimes(1)
    await router.navigate({ to: `${prefix}/workbench/settings` })
    expect(hasAvailableRoute(router)).toBe(true)
    expect(load).toHaveBeenCalledTimes(1)
    resources.clear()
  },
)

test('an import failure stays in Query and leaves the route available', async () => {
  const resources = createResourceQueryClient()
  resources.setDefaultOptions({ queries: { retry: false } })
  const failure = new Error('fixture chunk failed')
  vi.spyOn(settingsPageQueryOptions, 'queryFn').mockRejectedValue(failure)
  const router = createApplicationRouter({ resources, history: createMemoryHistory() })
  await router.navigate({ to: `/~${workspace}/workbench/settings` })
  await vi.waitFor(() =>
    expect(resources.getQueryState(settingsPageQueryOptions.queryKey)?.status).toBe('error'),
  )
  expect(hasAvailableRoute(router)).toBe(true)
  expect(resources.getQueryState(settingsPageQueryOptions.queryKey)?.error).toBe(failure)
  resources.clear()
})

test('navigation can leave while acquisition is pending without cancelling a shared consumer', async () => {
  const resources = createResourceQueryClient()
  const gate = Promise.withResolvers<void>()
  const original = settingsPageQueryOptions.queryFn
  if (typeof original !== 'function') throw new Error('Settings must have an acquisition function')
  const load = vi.spyOn(settingsPageQueryOptions, 'queryFn').mockImplementation(async (context) => {
    await gate.promise
    return original(context)
  })
  const router = createApplicationRouter({ resources, history: createMemoryHistory() })
  await router.navigate({ to: `/~${workspace}/workbench/settings` })
  expect(hasAvailableRoute(router)).toBe(true)
  expect(resources.getQueryState(settingsPageQueryOptions.queryKey)?.fetchStatus).toBe('fetching')
  const consumer = resources.query(settingsPageQueryOptions)
  await router.navigate({ to: `/~${workspace}/workbench` })
  gate.resolve()
  expect((await consumer).SettingsPage).toBeTypeOf('function')
  expect(load).toHaveBeenCalledTimes(1)
  expect(router.state.location.pathname).toBe(`/~${workspace}/workbench`)
  resources.clear()
})
