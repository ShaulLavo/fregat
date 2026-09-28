import type { Scenario } from './index'
import { openFileByName, selectors } from '../selectors'
import { inspectTreeOcclusion } from '../tree-occlusion'
import { captureTreeScroll } from '../tree-scroll-frames'

export const treeStickyScroll: Scenario = {
  name: 'tree-sticky-scroll',
  description: 'Scroll a transparent file tree through partial rows and sticky folder boundaries.',
  inspect: inspectTreeOcclusion,
  async run(page, { step, evidence }) {
    await openFileByName(page, 'syntax-highlighting.ts')
    await openFileByName(page, 'save-service.ts')
    await openFileByName(page, 'plugins.ts')
    await page.waitForTimeout(1500)
    await step('revealed')
    await selectors.folderTree(page).hover()
    for (const [index, delta] of [9, 1, 70, 10, 10, 10, 10, -120].entries()) {
      await page.mouse.wheel(0, delta)
      await page.waitForTimeout(350)
      await step(`scroll-${index + 1}`)
    }
    for (const [direction, delta] of [
      ['down', 120],
      ['up', -120],
    ] as const) {
      for (let burst = 0; burst < 4; burst++) await page.mouse.wheel(0, delta)
      await step(`fast-${direction}`)
    }
    await captureTreeScroll(page, evidence)
    await step('throttled-scroll')
  },
}
