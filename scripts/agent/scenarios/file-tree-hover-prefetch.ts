import { ok } from 'node:assert/strict'
import { mkdtemp, writeFile } from 'node:fs/promises'
import path from 'node:path'

import type { Scenario } from './index'
import { openFixtureWorkspace, releaseFixture } from '../fixture-workspace'
import { selectors } from '../selectors'

const FILENAME = 'hover-me.ts'

export const fileTreeHoverPrefetch: Scenario = {
  name: 'file-tree-hover-prefetch',
  description:
    'Moving the pointer onto a file row reads the file ahead of the click, and opens nothing.',
  async run(page, { step }) {
    const fixture = await mkdtemp('/work/tmp/fregat-hover-prefetch-')
    try {
      await writeFile(path.join(fixture, FILENAME), 'export const hovered = true\n')
      await writeFile(path.join(fixture, 'other.ts'), 'export const other = true\n')
      await openFixtureWorkspace(page, fixture)
      const row = selectors.treeItem(page, FILENAME)
      await row.waitFor({ timeout: 15_000 })
      await step('tree')

      const read = page.waitForRequest(
        (request) => request.url().includes('/fs/read') && request.url().includes(FILENAME),
        { timeout: 8_000 },
      )
      const box = await row.boundingBox()
      ok(box, 'The row must be laid out')
      await page.mouse.move(box.x + box.width + 200, box.y + 200)
      await page.mouse.move(box.x + 30, box.y + box.height / 2, { steps: 25 })
      await read
      await step('prefetched')
      ok((await selectors.editorTabs(page).count()) === 0, 'A hover must not open the file')
    } finally {
      await releaseFixture(fixture)
    }
  },
}
