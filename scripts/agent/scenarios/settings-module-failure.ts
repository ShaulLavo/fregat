import type { Scenario } from './index'
import { selectors, waitForApp } from '../selectors'

export const settingsModuleFailure: Scenario = {
  name: 'settings-module-failure',
  description: 'Fail a module import, keep settings reachable and recover with Reload.',
  async run(page, { step }) {
    const route = '**/src/features/settings/components/page.tsx*'
    await page.route(route, (request) => request.abort('failed'))
    try {
      await page.reload()
      await waitForApp(page)
      await page.keyboard.press('Control+,')
      await page.getByText('Unable to load settings', { exact: true }).waitFor()
      await step('module-failure-contained')
      await page.unroute(route)
      await page.getByRole('button', { name: 'Retry', exact: true }).click()
      await page.getByText('Unable to load settings', { exact: true }).waitFor()
      await step('failed-module-url-retained')
      await page.getByRole('button', { name: 'Reload', exact: true }).click()
      await selectors.settingsSearch(page).waitFor()
      await step('module-recovered-after-reload')
    } finally {
      await page.unroute(route)
    }
  },
}
