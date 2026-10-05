import { strictEqual, ok } from 'node:assert/strict'
import type { Route } from 'playwright'
import * as v from 'valibot'
import { runPaletteCommand, selectors, waitForApp } from '../selectors'
import type { Scenario } from './index'

const checkpointSchema = v.object({
  kind: v.picklist(['departure', 'wasm']),
  documentId: v.string(),
  url: v.string(),
})

export const terminalWasmNavigationStartup: Scenario = {
  name: 'terminal-wasm-navigation-startup',
  description: 'Navigate during terminal startup and keep WASM acquisition with its document.',
  requiresIsolatedServer: true,
  async run(page, { evidence, step }) {
    await runPaletteCommand(page, 'Show terminal')
    const terminalCanvas = selectors.terminalSurface(page).first().locator('canvas').first()
    await terminalCanvas.waitFor()
    const checkpoints: v.InferOutput<typeof checkpointSchema>[] = []
    await page.exposeFunction('recordTerminalStartupCheckpoint', (value: unknown) => {
      checkpoints.push(v.parse(checkpointSchema, value))
    })
    await page.addInitScript(() => {
      const documentId = crypto.randomUUID()
      const record = (kind: 'departure' | 'wasm') => {
        const capture = Reflect.get(window, 'recordTerminalStartupCheckpoint')
        if (typeof capture === 'function') void capture({ kind, documentId, url: location.href })
      }
      window.addEventListener('beforeunload', () => record('departure'), true)
      window.fetch = new Proxy(window.fetch, {
        apply(target, owner, args) {
          const input: unknown = args[0]
          if (input instanceof URL && input.pathname.endsWith('.wasm')) record('wasm')
          return Reflect.apply(target, owner, args)
        },
      })
    })
    const held = Promise.withResolvers<Route>()
    let heldRequest: Route | undefined
    const artifact = '**/bridge.wasm'
    await page.route(
      artifact,
      (route) => {
        heldRequest = route
        held.resolve(route)
      },
      { times: 1 },
    )
    try {
      const requested = page.waitForRequest(async (request) => {
        if (!new URL(request.url()).pathname.endsWith('/bridge.wasm')) return false
        return (await held.promise).request() === request
      })
      await Promise.all([requested, page.reload({ waitUntil: 'domcontentloaded' })])
      await waitForApp(page)
      await step('pending-wasm')
      const destination = new URL(page.url())
      destination.searchParams.set('editorPerfTrace', '1')
      await page.goto(destination.href, { waitUntil: 'domcontentloaded' })
      await waitForApp(page)
      await terminalCanvas.waitFor()
      await step('destination-terminal')
      const departure = checkpoints.find((checkpoint) => checkpoint.kind === 'departure')
      ok(departure, 'The held startup document performed a native departure')
      const document = checkpoints.filter(
        (checkpoint) => checkpoint.documentId === departure.documentId,
      )
      strictEqual(
        document
          .slice(0, document.indexOf(departure))
          .filter((checkpoint) => checkpoint.kind === 'wasm').length,
        2,
        'The startup acquired the real native and bridge artifacts',
      )
      strictEqual(
        document.slice(document.indexOf(departure) + 1).length,
        0,
        'A departing document starts no further WASM acquisition',
      )
    } finally {
      try {
        await evidence.json('startup-checkpoints.json', checkpoints)
      } finally {
        await heldRequest?.abort('aborted').catch(() => undefined)
        await page.unroute(artifact)
      }
    }
  },
}
