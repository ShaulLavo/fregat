import { strictEqual } from 'node:assert/strict'
import { runPaletteCommand, selectors, waitForApp } from '../selectors'
import type { Scenario } from './index'

export const terminalScreenReader: Scenario = {
  name: 'terminal-screen-reader',
  description:
    'Change the screen-reader setting while a terminal is mounted and check its text mirror follows without replacing the terminal.',
  requiresIsolatedServer: true,
  async run(page, { step }) {
    await waitForApp(page)
    await runPaletteCommand(page, 'Show terminal')
    await selectors.terminalLiveCanvas(page).waitFor()
    const canvas = await selectors.terminalLiveCanvas(page).elementHandle()
    const mirror = selectors.terminalAccessibilityMirror(page)
    await mirror.waitFor({ state: 'attached' })
    await step('terminal-screen-reader-default-on')

    await page.keyboard.press('Control+,')
    await selectors.settingsSearch(page).fill('terminal.integrated.screenReader')
    const toggle = selectors.settingsSwitch(page, 'Screen reader')
    await toggle.waitFor()
    strictEqual(await toggle.getAttribute('aria-checked'), 'true')
    await step('terminal-screen-reader-setting')
    await toggle.click()
    await mirror.waitFor({ state: 'detached' })
    strictEqual(await canvas?.evaluate((element) => element.isConnected), true)
    await step('terminal-screen-reader-off')
    await toggle.click()
    await mirror.waitFor({ state: 'attached' })
    strictEqual(await canvas?.evaluate((element) => element.isConnected), true)
    await step('terminal-screen-reader-on')
  },
}
