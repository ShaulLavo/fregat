import type { Scenario } from './index'
import { openFileByName, selectors } from '../selectors'
import { inspectTreeOcclusion } from '../tree-occlusion'

export const treeStickyScroll: Scenario = {
  name: 'tree-sticky-scroll',
  description: 'Scroll a transparent file tree through partial rows and sticky folder boundaries.',
  inspect: inspectTreeOcclusion,
  async run(page, { step }) {
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
  },
}
