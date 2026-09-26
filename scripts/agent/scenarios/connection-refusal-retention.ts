import { ok } from 'node:assert/strict'
import type { WebSocketRoute } from 'playwright'
import { installCaptureSocketPrefix } from '../product-terminal'
import { runPaletteCommand, selectors } from '../selectors'
import { openChat } from './chat-verification'
import type { Scenario } from './index'

export const connectionRefusalRetention: Scenario = {
  name: 'connection-refusal-retention',
  description:
    'Keep the workbench and terminal pane through a later protocol refusal, then reconnect the same shell through the notice Retry.',
  async run(page, { step }) {
    const base = await openChat(page)
    const response = await page.request.get(`${base.replace(/\/orchestration$/, '')}/health`, {
      headers: { Origin: new URL(page.url()).origin },
    })
    const descriptor = await response.json()
    const sockets = new Set<WebSocketRoute>()
    let refused = false
    await page.routeWebSocket(/\/orchestration\/rpc(?:\?|$)/, (route) => {
      const server = route.connectToServer()
      sockets.add(route)
      server.onMessage((raw) => {
        const message = JSON.parse(raw.toString())
        if (message.kind === 'connected' && refused) message.config.protocolVersion += 1
        route.send(JSON.stringify(message))
      })
    })
    const prefix = `refusal-${crypto.randomUUID()}-`
    await page.addInitScript(installCaptureSocketPrefix, prefix)
    const owners = new Map<string, URL>()
    let output = ''
    let ready = false
    page.on('websocket', (socket) => {
      const url = new URL(socket.url())
      if (!url.pathname.endsWith('/terminal')) return
      ok(url.searchParams.get('terminalId')?.startsWith(prefix))
      owners.set(socket.url(), url)
      socket.on('framereceived', ({ payload }) => {
        if (typeof payload !== 'string') {
          output += payload.toString('utf8')
          return
        }
        if (JSON.parse(payload).type === 'ready') ready = true
      })
    })
    try {
      await page.reload()
      await selectors.machineLiveStatus(page, descriptor.label).waitFor()
      await runPaletteCommand(page, 'Chat mode')
      await selectors.terminalTool(page).click()
      const terminal = selectors.terminalSurface(page).first()
      await terminal.waitFor()
      for (let attempt = 0; attempt < 100 && !ready; attempt++) await page.waitForTimeout(50)
      ok(ready, 'Owned terminal is ready')
      const retained = await terminal.elementHandle()
      ok(retained)
      await step('live-terminal-before-refusal')
      refused = true
      for (const route of sockets)
        await route.close({ code: 4000, reason: 'Verification reconnect' })
      sockets.clear()
      const notice = selectors.machineConnectionNotice(page, descriptor.label, 'Protocol mismatch')
      await notice.waitFor()
      await selectors.windowToolbar(page).waitFor()
      ok(await retained.evaluate((element) => element.isConnected), 'Terminal DOM survives refusal')
      await step('protocol-refusal-keeps-terminal-pane')
      refused = false
      ready = false
      await notice.getByRole('button', { name: 'Retry', exact: true }).click()
      await selectors.machineLiveStatus(page, descriptor.label).waitFor()
      for (let attempt = 0; attempt < 100 && !ready; attempt++) await page.waitForTimeout(50)
      ok(ready, 'Terminal reconnects after compatibility is restored')
      ok(await retained.evaluate((element) => element.isConnected))
      await terminal.click({ position: { x: 100, y: 60 } })
      await page.keyboard.type(`printf '\\nRETAINED_%s\\n' 'PROTOCOL'`)
      await page.keyboard.press('Enter')
      for (let attempt = 0; attempt < 100 && !output.includes('RETAINED_PROTOCOL'); attempt++)
        await page.waitForTimeout(50)
      ok(output.includes('RETAINED_PROTOCOL'), 'Retained shell still executes input')
      await step('protocol-retry-recovers-without-remount')
    } finally {
      refused = false
      await page.goto('about:blank')
      for (const url of owners.values()) {
        const target = `${url.protocol === 'wss:' ? 'https:' : 'http:'}//${url.host}${url.pathname}/kill`
        const response = await page.request.post(target, {
          headers: { Origin: new URL(target).origin },
          data: {
            worktreeId: url.searchParams.get('worktreeId'),
            terminalId: url.searchParams.get('terminalId'),
          },
        })
        ok(response.ok(), 'Owned terminal cleaned')
      }
    }
  },
}
