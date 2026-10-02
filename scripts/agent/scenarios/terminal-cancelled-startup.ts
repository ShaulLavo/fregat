import { strictEqual } from 'node:assert/strict'
import { runPaletteCommand, selectors } from '../selectors'
import type { Scenario } from './index'

export const terminalCancelledStartup: Scenario = {
  name: 'terminal-cancelled-startup',
  description: 'Restore a retained terminal after its checkout query is cancelled.',
  async run(page, { step }) {
    await selectors.workspaceMode(page, 'Workbench').click()
    await runPaletteCommand(page, 'Show terminal')
    await selectors.terminalSurface(page).first().locator('canvas').first().waitFor()

    let markRequested!: () => void
    let release!: () => void
    const requested = new Promise<void>((resolve) => {
      markRequested = resolve
    })
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    await page.route('**/orchestration/commands**', async (route) => {
      markRequested()
      await held
      await route.continue().catch(() => undefined)
    })
    try {
      await page.reload({ waitUntil: 'domcontentloaded' })
      await requested
      await selectors.terminalOpening(page).waitFor()
      await page.evaluate(() => window.dispatchEvent(new Event('pagehide')))
      await selectors.terminalOpening(page).waitFor()
      await step('cancelled-opening')
      strictEqual(await page.getByText('CancelledError', { exact: true }).count(), 0)
      await page.evaluate(() => window.dispatchEvent(new Event('pageshow')))
      release()
      await selectors.terminalSurface(page).first().locator('canvas').first().waitFor()
      await selectors.terminalOpening(page).waitFor({ state: 'hidden' })
      await step('restored-terminal')
    } finally {
      release()
    }
  },
}
