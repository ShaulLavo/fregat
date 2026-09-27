import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { openFixtureWorkspace, releaseFixture } from '../fixture-workspace'
import { selectors } from '../selectors'
import type { Scenario } from './index'

const FOLDERS = 20
const FILES_PER_FOLDER = 2500
const EXPANDED = 4
const EXTENSIONS = ['ts', 'tsx', 'md', 'json', 'css']

function folderName(index: number) {
  return `folder-${String(index).padStart(2, '0')}`
}

/** `src/` holds 20 folders of 2,500 files each: 50,000 entries. */
async function largeTreeFixture() {
  const root = await mkdtemp('/work/tmp/fregat-tree-large-')
  for (let folder = 0; folder < FOLDERS; folder += 1) {
    const directory = path.join(root, 'src', folderName(folder))
    await mkdir(directory, { recursive: true })
    const names = Array.from(
      { length: FILES_PER_FOLDER },
      (_, file) => `file-${String(file).padStart(4, '0')}.${EXTENSIONS[file % EXTENSIONS.length]}`,
    )
    await Promise.all(names.map((name) => writeFile(path.join(directory, name), '')))
  }
  return root
}

export const treeLargeScroll: Scenario = {
  name: 'tree-large-scroll',
  description:
    'Wheel-scroll a 50,000-entry tree with 10,000 rows expanded: steady small steps, long jumps and a reversal.',
  async run(page, { step }) {
    const root = await largeTreeFixture()
    try {
      await openFixtureWorkspace(page, root)
      await selectors.treeItem(page, 'src').click()
      for (let folder = EXPANDED - 1; folder >= 0; folder -= 1) {
        await selectors.treeItem(page, folderName(folder)).click()
        await selectors.treeItem(page, 'file-0000.ts').first().waitFor()
      }
      await page.waitForTimeout(1500)
      await step('expanded')
      await selectors.folderTree(page).hover()
      const deltas = [...Array(16).fill(100), ...Array(4).fill(2000), ...Array(4).fill(-100)]
      for (const [index, delta] of deltas.entries()) {
        await page.mouse.wheel(0, delta)
        await page.waitForTimeout(250)
        await step(`scroll-${index + 1}`)
      }
    } finally {
      await releaseFixture(root)
    }
  },
}
