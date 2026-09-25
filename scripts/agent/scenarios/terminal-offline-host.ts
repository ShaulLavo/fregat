import type { WebSocketRoute } from 'playwright'
import { ok } from 'node:assert/strict'
import {
  createGitFixture,
  fixtureGit,
  openFixtureWorkspace,
  releaseFixture,
} from '../fixture-workspace'
import { runPaletteCommand, selectors } from '../selectors'
import type { Scenario } from './index'

export const terminalOfflineHost: Scenario = {
  name: 'terminal-offline-host',
  description:
    'Disconnect and reconnect with a terminal open; the unavailable notice overlays the same host.',
  async run(page, { step }) {
    const fixture = await createGitFixture('terminal-offline')
    let blocked = false
    const connection: { current: WebSocketRoute | null } = { current: null }
    await page.routeWebSocket('**/orchestration/rpc', (socket) => {
      if (blocked) return void socket.close({ code: 1001, reason: 'Fixture connection offline' })
      connection.current = socket
      socket.connectToServer()
    })
    await page.reload()
    try {
      await fixtureGit(fixture, ['commit', '--quiet', '-m', 'initial'])
      await openFixtureWorkspace(page, fixture)
      await runPaletteCommand(page, 'Show terminal')
      const terminal = selectors.terminalSurface(page).first()
      await terminal.locator('canvas').first().waitFor()
      const host = await terminal
        .locator('canvas')
        .first()
        .evaluateHandle((canvas) => canvas.closest('.font-mono'))
      ok(host, 'Terminal host is mounted')
      await step('terminal-online')
      blocked = true
      await page.context().setOffline(true)
      if (connection.current)
        await connection.current.close({ code: 1001, reason: 'Fixture connection offline' })
      await terminal
        .getByRole('status')
        .filter({ hasText: 'is unreachable' })
        .waitFor({ timeout: 12_000 })
      ok(await host.evaluate((node) => node?.isConnected), 'Host stays mounted while unavailable')
      await step('terminal-unavailable')
      blocked = false
      await page.context().setOffline(false)
      await terminal
        .getByRole('status')
        .filter({ hasText: 'is unreachable' })
        .waitFor({ state: 'hidden', timeout: 20_000 })
      await terminal.locator('canvas').first().waitFor()
      ok(await host.evaluate((node) => node?.isConnected), 'Reconnect keeps the host')
      await terminal.locator('canvas').first().click()
      ok(
        await host.evaluate((node) => node?.contains(document.activeElement)),
        'Reconnected terminal accepts focus',
      )
      await step('terminal-reconnected')
    } finally {
      blocked = false
      await page.context().setOffline(false)
      await releaseFixture(fixture)
    }
  },
}
