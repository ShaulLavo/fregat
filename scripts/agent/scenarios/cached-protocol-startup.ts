import { ok, strictEqual } from 'node:assert/strict'
import type { Page, WebSocket } from 'playwright'
import { ORCHESTRATION_WS_PROTOCOL_VERSION } from '../../../packages/contracts/src/index'
import { selectors } from '../selectors'
import type { Scenario } from './index'
import { openChat } from './chat-verification'

async function cachedProtocol(page: Page, next?: number) {
  return page.evaluate((protocol) => {
    const key = Object.keys(localStorage).find((key) =>
      key.endsWith('platform.environments.binding.v1'),
    )
    if (!key) return null
    const record = JSON.parse(localStorage.getItem(key)!)
    if (protocol !== undefined) {
      record.binding.descriptor.protocolVersion = protocol
      localStorage.setItem(key, JSON.stringify(record))
    }
    return record.binding.descriptor.protocolVersion as number
  }, next)
}

export const cachedProtocolStartup: Scenario = {
  name: 'cached-protocol-startup',
  description:
    'Reload a warm profile with the previous cached protocol against the current server, pause fresh health to verify no socket opens, then verify recovery. A second reload with an older fresh server must block despite a compatible cache.',
  async run(page, { step }) {
    const base = await openChat(page)
    await selectors.windowToolbar(page).waitFor()
    const healthUrl = `${base.replace(/\/orchestration$/, '')}/health`
    const response = await page.request.get(healthUrl, {
      headers: { Origin: new URL(page.url()).origin },
    })
    ok(response.ok(), 'Fresh health must answer')
    const descriptor = await response.json()
    const currentProtocol = ORCHESTRATION_WS_PROTOCOL_VERSION
    const previousProtocol = currentProtocol - 1
    strictEqual(descriptor.protocolVersion, currentProtocol)
    await step(`Protocol ${currentProtocol} workbench establishes its warm profile`)
    strictEqual(await cachedProtocol(page, previousProtocol), previousProtocol)
    const gate = Promise.withResolvers<void>()
    const requested = Promise.withResolvers<void>()
    let socketCount = 0
    const observeSocket = (socket: WebSocket) => {
      if (socket.url().endsWith('/orchestration/rpc')) socketCount += 1
    }
    page.on('websocket', observeSocket)
    await page.route(healthUrl, async (route) => {
      requested.resolve()
      await gate.promise
      await route.continue()
    })
    try {
      await page.reload({ waitUntil: 'domcontentloaded' })
      await requested.promise
      await selectors.windowToolbar(page).waitFor()
      strictEqual(socketCount, 0, 'Cached protocol must never open a socket before fresh health')
      await step(
        `Cached protocol ${previousProtocol} retains the workbench while fresh health is pending`,
      )
      const connected = page.waitForEvent('websocket', {
        predicate: (socket) => socket.url().endsWith('/orchestration/rpc'),
      })
      gate.resolve()
      await connected
      await page.waitForFunction((protocol) => {
        const key = Object.keys(localStorage).find((key) =>
          key.endsWith('platform.environments.binding.v1'),
        )
        return (
          key &&
          JSON.parse(localStorage.getItem(key)!).binding.descriptor.protocolVersion === protocol
        )
      }, currentProtocol)
      await selectors.windowToolbar(page).waitFor()
      strictEqual(await selectors.bootstrapFailure(page).count(), 0)
      await step(
        `Fresh protocol ${currentProtocol} replaces cached ${previousProtocol} and reconnects`,
      )
      await page.unroute(healthUrl)
      await page.route(healthUrl, (route) =>
        route.fulfill({ json: { ...descriptor, protocolVersion: previousProtocol } }),
      )
      socketCount = 0
      await page.reload({ waitUntil: 'domcontentloaded' })
      await selectors.bootstrapFailure(page).waitFor()
      strictEqual(socketCount, 0, 'Fresh incompatible health must block before opening a socket')
      await step(
        `Fresh protocol ${previousProtocol} blocks despite compatible cached protocol ${currentProtocol}`,
      )
      await page.unroute(healthUrl)
      await selectors.bootstrapRetry(page).click()
      await selectors.windowToolbar(page).waitFor()
      strictEqual(await selectors.bootstrapFailure(page).count(), 0)
      await step('Retry reconnects after the server protocol becomes compatible')
    } finally {
      gate.resolve()
      page.off('websocket', observeSocket)
      await page.unroute(healthUrl)
    }
  },
}
