import { ok } from 'node:assert/strict'
import type { Scenario } from './index'
import { selectors, openFileByName } from '../selectors'

export const settingsRoutePreparation: Scenario = {
  name: 'settings-route-preparation',
  description: 'Open settings by URL and command, then traverse browser history.',
  async run(page, { step }) {
    const base = new URL(page.url())
    base.pathname = base.pathname.replace(/\/workbench.*$/, '/workbench')
    base.search = ''
    const settings = new URL(base)
    settings.pathname += '/settings'
    await page.goto(settings.href)
    await selectors.settingsSearch(page).waitFor()
    await step('direct-settings-route')
    await openFileByName(page, 'README.md')
    await page.keyboard.press('Control+,')
    await selectors.settingsSearch(page).waitFor()
    await page.waitForURL((url) => url.pathname.endsWith('/settings'))
    await step('command-settings-route')
    await page.goBack()
    await page.waitForURL((url) => !url.pathname.endsWith('/settings'))
    await page.goForward()
    await selectors.settingsSearch(page).waitFor()
    ok(new URL(page.url()).pathname.endsWith('/settings'), 'Forward returns to the settings route')
    await step('settings-history-restored')
  },
}
