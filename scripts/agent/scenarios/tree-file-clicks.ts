import { strictEqual } from 'node:assert'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { openFixtureWorkspace, releaseFixture } from '../fixture-workspace'
import { openFileFromTree, selectors } from '../selectors'
import type { Scenario } from './index'

export const treeFileClicks: Scenario = {
  name: 'tree-file-clicks',
  description: 'Keep nested folders expanded while clicking files and refreshing their ancestors.',
  async run(page, { step }) {
    const fixture = await mkdtemp('/work/tmp/fregat-tree-clicks-')
    try {
      await mkdir(path.join(fixture, 'src', 'nested'), { recursive: true })
      await writeFile(path.join(fixture, 'src', 'sibling.txt'), 'Sibling\n')
      await writeFile(path.join(fixture, 'src', 'nested', 'a.txt'), 'A\n')
      await writeFile(path.join(fixture, 'src', 'nested', 'b.txt'), 'B\n')
      await openFixtureWorkspace(page, fixture)
      await selectors.treeItem(page, 'src').click()
      await selectors.treeItem(page, 'nested').click()
      await openFileFromTree(page, 'a.txt')
      await step('nested-file-open')
      await writeFile(path.join(fixture, 'new-root-file.txt'), 'Root update\n')
      await selectors.treeItem(page, 'new-root-file.txt').waitFor({ timeout: 10000 })
      await step('root-refreshed')
      strictEqual(await selectors.treeItem(page, 'nested').getAttribute('aria-expanded'), 'true')
      await selectors.treeItem(page, 'b.txt').click({ timeout: 3000 })
      await step('second-file-open')
      await writeFile(path.join(fixture, 'src', 'new-sibling.txt'), 'Nested update\n')
      await selectors.treeItem(page, 'new-sibling.txt').waitFor({ timeout: 10000 })
      strictEqual(await selectors.treeItem(page, 'nested').getAttribute('aria-expanded'), 'true')
      await selectors.treeItem(page, 'a.txt').click({ timeout: 3000 })
      await rm(path.join(fixture, 'src', 'sibling.txt'))
      await selectors.treeItem(page, 'sibling.txt').waitFor({ state: 'hidden', timeout: 10000 })
      strictEqual(await selectors.treeItem(page, 'nested').getAttribute('aria-expanded'), 'true')
      await step('nested-refresh-and-deletion')
    } finally {
      await releaseFixture(fixture)
    }
  },
}
