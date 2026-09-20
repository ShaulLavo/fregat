import { ok } from 'node:assert/strict'
import type { Page } from 'playwright'
import { selectors } from '../selectors'
import type { Scenario } from './index'

async function headerGeometry(page: Page) {
  const header = await selectors.settingsHeader(page).boundingBox()
  const scope = await selectors.settingsScopeTab(page, 'User').boundingBox()
  const search = await selectors.settingsSearch(page).evaluate((element) => {
    const { x, y, width, height } = element.getBoundingClientRect()
    return { x, y, width, height, fontSize: Number.parseFloat(getComputedStyle(element).fontSize) }
  })
  ok(header && scope, 'Settings header and scope tab must be visible')
  return { header, scope, search }
}

export const settingsResponsive: Scenario = {
  name: 'settings-responsive',
  description:
    'Check narrow Settings touch controls, scope/search order and the wide header layout.',
  async run(page, { step }) {
    const viewport = page.viewportSize()
    try {
      await page.setViewportSize({ width: 700, height: 1000 })
      await page.keyboard.press('Control+,')
      await selectors.settingsSearch(page).waitFor()
      const narrow = await headerGeometry(page)
      ok(narrow.header.width < 768, 'The narrow check must exercise the Settings container query')
      ok(
        narrow.search.fontSize >= 16,
        'Narrow Settings search must retain readable 16px input text',
      )
      ok(narrow.search.height >= 40, 'Narrow Settings search must retain its 40px touch target')
      ok(
        narrow.scope.height >= 40,
        'Narrow Settings scope tabs must retain their 40px touch target',
      )
      ok(
        narrow.search.y >= narrow.scope.y + narrow.scope.height,
        'Narrow Settings search must occupy its own row after the scope tabs',
      )
      await step('narrow-settings-header')

      await page.setViewportSize({ width: 1960, height: 1100 })
      const wide = await headerGeometry(page)
      ok(wide.header.width >= 768, 'The wide check must leave the Settings container query')
      ok(wide.search.x > wide.scope.x, 'Wide Settings search must follow the scope tabs')
      ok(
        Math.abs(wide.search.y + wide.search.height / 2 - wide.scope.y - wide.scope.height / 2) < 1,
        'Wide Settings search and scope tabs must share a bar',
      )
      await step('wide-settings-header')
    } finally {
      if (viewport) await page.setViewportSize(viewport)
    }
  },
  inspect: headerGeometry,
}
