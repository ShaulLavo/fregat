import { strictEqual } from 'node:assert/strict'
import type { Route } from 'playwright'
import { runPaletteCommand, selectors, waitForApp } from '../selectors'
import type { Scenario } from './index'

type CacheClient = {
  getQueryCache(): {
    getAll(): readonly { queryKey: readonly unknown[]; state: { status: string } }[]
  }
  getQueryState(
    key: readonly unknown[],
  ): { status: string; fetchStatus: string; error: unknown } | undefined
}

export const terminalWasmCancelledStartup: Scenario = {
  name: 'terminal-wasm-cancelled-startup',
  description: 'Cancel a pending terminal WASM fetch on page departure and restore the mount.',
  requiresIsolatedServer: true,
  async run(page, { step, evidence }) {
    await selectors.workspaceMode(page, 'Workbench').click()
    await runPaletteCommand(page, 'Show terminal')
    await selectors.terminalSurface(page).first().locator('canvas').first().waitFor()
    const requested = Promise.withResolvers<Route>()
    const artifact = '**/bridge.wasm'
    await page.route(artifact, (route) => requested.resolve(route), { times: 1 })
    await page.addInitScript(() => {
      Reflect.deleteProperty(Navigator.prototype, 'gpu')
      for (const key of Object.keys(localStorage)) {
        if (key.includes('terminal.display.v1')) localStorage.removeItem(key)
      }
    })
    try {
      await page.reload({ waitUntil: 'domcontentloaded' })
      await waitForApp(page)
      const request = await requested.promise
      await selectors.terminalSurface(page).first().waitFor()
      // Settle checkout first so its cancellation cannot conceal the loader failure.
      await page.waitForFunction(() => {
        const clients = Reflect.get(globalThis, '__fregatQueryClients') as Map<string, CacheClient>
        return [...clients.values()].some((client) =>
          client
            .getQueryCache()
            .getAll()
            .some(
              (query) =>
                query.queryKey[0] === 'terminal' &&
                query.queryKey[1] === 'checkout' &&
                query.state.status === 'success',
            ),
        )
      })
      const pending = await page.evaluate(() => {
        const client = Reflect.get(globalThis, '__fregatResourceQueryClient') as CacheClient
        return client.getQueryState(['terminal', 'runtime'])?.fetchStatus
      })
      strictEqual(pending, 'fetching', 'The terminal is waiting for the held WASM request')
      await step('wasm-startup-held')
      await page.evaluate(() => window.dispatchEvent(new Event('pagehide')))
      await request.abort('failed')
      await page.waitForFunction(() => {
        const client = Reflect.get(globalThis, '__fregatResourceQueryClient') as CacheClient
        return client.getQueryState(['terminal', 'runtime'])?.fetchStatus === 'idle'
      })
      const state = await page.evaluate(() => {
        const client = Reflect.get(globalThis, '__fregatResourceQueryClient') as CacheClient
        const query = client.getQueryState(['terminal', 'runtime'])
        const error = query?.error
        if (!(error instanceof Error)) return { status: query?.status, error }
        const cause =
          error.cause instanceof Error
            ? { name: error.cause.name, message: error.cause.message }
            : null
        return { status: query?.status, error: { name: error.name, message: error.message, cause } }
      })
      await evidence.json('cancelled-runtime.json', state)
      await step('wasm-startup-departure')
      strictEqual(state.status, 'pending', 'Page departure cancels the runtime query')
      strictEqual(state.error, null, 'Departure retains no actionable loader failure')
      await page.evaluate(() => window.dispatchEvent(new Event('pageshow')))
      await page.waitForFunction(() => {
        const client = Reflect.get(globalThis, '__fregatResourceQueryClient') as CacheClient
        return client.getQueryState(['terminal', 'runtime'])?.status === 'success'
      })
      await selectors.terminalSurface(page).first().locator('canvas').first().waitFor()
      await selectors.terminalOpening(page).waitFor({ state: 'hidden' })
      await step('wasm-startup-restored')
    } finally {
      await page.unroute(artifact)
      await page.evaluate(() => window.dispatchEvent(new Event('pageshow')))
    }
  },
}
