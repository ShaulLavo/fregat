import { deepStrictEqual } from 'node:assert/strict'
import type { Scenario } from './index'
import { selectors, waitForApp } from '../selectors'

export const settingsColdLoad: Scenario = {
  name: 'settings-cold-load',
  description: 'Hold the settings import until Suspense renders, then resume without React errors.',
  async run(page, { step }) {
    const errors: string[] = []
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text())
    })
    page.on('pageerror', (error) => errors.push(error.message))
    const gate = Promise.withResolvers<void>()
    const route = '**/src/features/settings/components/page.tsx*'
    await page.route(route, async (request) => {
      await gate.promise
      await request.continue()
    })
    try {
      await page.reload()
      await waitForApp(page)
      await page.keyboard.press('Control+,')
      await selectors.settingsLoading(page).waitFor()
      await step('settings-suspended')
      gate.resolve()
      await selectors.settingsSearch(page).waitFor()
      await step('settings-resumed')
      deepStrictEqual(errors, [], 'Cold settings load must not report React errors')
      await page.keyboard.press('Escape')
    } finally {
      gate.resolve()
      await page.unroute(route)
    }
  },
}
