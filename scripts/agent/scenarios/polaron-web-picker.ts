import { strictEqual } from 'node:assert/strict'
import { chromiumBridge } from '../../../apps/desktop/src/launcher/chromium'
import { createGitFixture, fixtureGit, releaseFixture } from '../fixture-workspace'
import { selectors, waitForApp } from '../selectors'
import type { Scenario } from './index'
import { observePolaronTerminal } from '../polaron-continuity'

export const polaronWebPicker: Scenario = {
  name: 'polaron-web-picker',
  description: 'Open a fixture folder through the web picker with the Chromium desktop bridge.',
  requiresIsolatedServer: true,
  async run(page, { step, evidence }) {
    const fixture = await createGitFixture('polaron-picker')
    let continuity: Awaited<ReturnType<typeof observePolaronTerminal>> | undefined
    try {
      continuity = await observePolaronTerminal(page)
      await fixtureGit(fixture, ['commit', '--quiet', '-m', 'fixture'])
      await page.exposeBinding('platformShellCall', () => {})
      const script = chromiumBridge(page.url())
      await page.addInitScript({ content: script })
      await page.evaluate(script)
      await selectors.projectMenu(page).click()
      await selectors.openFolderMenu(page).click()
      await selectors.pickerGoToFolder(page).click()
      await selectors.pickerFolderPath(page).fill(fixture)
      await page.keyboard.press('Enter')
      await selectors.pickerRow(page, 'a.txt').waitFor()
      await step('chromium-web-picker')
      await selectors.pickerChoose(page).click()
      await selectors.pickerDialog(page).waitFor({ state: 'hidden' })
      await waitForApp(page)
      await selectors.treeItem(page, 'a.txt').waitFor()
      strictEqual(
        await page.evaluate(
          () =>
            (window as Window & { platformBridge?: { titlebar: string } }).platformBridge?.titlebar,
        ),
        'native',
      )
      strictEqual(
        await page.evaluate(
          () =>
            typeof (window as Window & { platformBridge?: { pickEntry?: unknown } }).platformBridge
              ?.pickEntry,
        ),
        'undefined',
      )
      await step('fixture-folder-open')
      await continuity.prove(fixture, evidence, step)
    } finally {
      try {
        await page.goto('about:blank')
        await continuity?.dispose()
      } finally {
        await releaseFixture(fixture)
      }
    }
  },
}
