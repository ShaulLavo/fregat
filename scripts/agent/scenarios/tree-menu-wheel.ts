import { ok, strictEqual } from 'node:assert/strict'
import { mkdtemp, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { openFixtureWorkspace, releaseFixture } from '../fixture-workspace'
import { scratchPath } from '../paths'
import { selectors, treeScrollSelectors } from '../selectors'
import type { Scenario } from './index'

export const treeMenuWheel: Scenario = {
  name: 'tree-menu-wheel',
  description:
    'The first wheel closes a row menu and keeps the tree still; the next wheel scrolls.',
  requiresIsolatedServer: true,
  async run(page, { step, evidence }) {
    const fixture = await mkdtemp(scratchPath('fregat-menu-wheel-'))
    try {
      for (let index = 0; index < 80; index += 1) {
        await writeFile(
          path.join(fixture, `item-${String(index).padStart(2, '0')}.ts`),
          'export {}\n',
        )
      }
      await openFixtureWorkspace(page, fixture)
      const scroll = selectors.folderTree(page).locator(treeScrollSelectors.scroll)
      const row = selectors.treeItem(page, 'item-00.ts')
      await row.waitFor()
      ok(await scroll.evaluate((node) => node.scrollHeight > node.clientHeight))
      const before = await scroll.evaluate((node) => node.scrollTop)
      await row.click({ button: 'right' })
      await selectors.popupMenu(page).waitFor()
      await step('menu-open')
      const box = await scroll.boundingBox()
      ok(box)
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
      await page.mouse.wheel(0, 72)
      await selectors.popupMenu(page).waitFor({ state: 'hidden' })
      await step('dismissed-tree-still')
      const dismissed = await scroll.evaluate((node) => node.scrollTop)
      strictEqual(dismissed, before)
      await page.mouse.wheel(0, 72)
      await page.waitForFunction(
        ({ selector, before }) => (document.querySelector(selector)?.scrollTop ?? 0) > before,
        { selector: treeScrollSelectors.scroll, before },
      )
      const resumed = await scroll.evaluate((node) => node.scrollTop)
      await evidence.json('tree-menu-wheel.json', { before, dismissed, resumed })
      await step('next-wheel-scrolls')
    } finally {
      await releaseFixture(fixture)
    }
  },
}
