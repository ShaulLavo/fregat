import { strictEqual } from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import type { Scenario } from './index'
import {
  createGitFixture,
  fixtureGit,
  openFixtureWorkspace,
  releaseFixture,
} from '../fixture-workspace'
import { focusEditor, openFileByName, runPaletteCommand, selectors } from '../selectors'

const files = ['a.txt', 'b.txt', 'c.txt']
const initial = 'renameMe\n'

export const searchReplaceRefresh: Scenario = {
  name: 'search-replace-refresh',
  description:
    'Replace a dirty open buffer and disk matches, then undo and redo the multi-file edit.',
  async run(page, { step }) {
    const fixture = await createGitFixture('search-replace-refresh')
    const originalUrl = page.url()
    try {
      await Promise.all(files.map((file) => writeFile(join(fixture, file), initial)))
      await fixtureGit(fixture, ['add', '--all'])
      await fixtureGit(fixture, ['commit', '--quiet', '-m', 'fixture'])
      await openFixtureWorkspace(page, fixture)
      await openFileByName(page, 'a.txt')
      await focusEditor(page)
      await page.keyboard.press('Control+End')
      await page.keyboard.insertText('// dirty\n')
      await selectors.sidebarTab(page, 'Search').click()
      await selectors.workspaceSearch(page).fill('renameMe')
      const first = selectors
        .searchResultTree(page)
        .getByRole('treeitem')
        .filter({ hasText: 'a.txt' })
      await first.waitFor()
      await selectors.replaceToggle(page).click()
      await selectors.replaceBox(page).fill('renamedValue')
      await step('original-matches')
      await page.route(
        '**/fs/workspace-edit/finalize',
        async (route) => {
          await first.waitFor({ state: 'hidden' })
          await route.continue()
        },
        { times: 1 },
      )
      await selectors.workspaceReplaceAll(page).click()
      await selectors.workspaceEditApplyAll(page).click()
      await selectors.textAnywhere(page, '3 matches replaced.').waitFor()
      await expectDisk(fixture, true)
      await step('replacement-settled-after-refresh')
      const undoFinalized = page.waitForResponse(
        (response) =>
          response.url().endsWith('/fs/workspace-edit/finalize') && response.status() === 200,
      )
      await runPaletteCommand(page, 'Undo multi-file edit')
      await undoFinalized
      await first.waitFor()
      await expectDisk(fixture, false)
      await step('undo-restored-matches')
      const redoFinalized = page.waitForResponse(
        (response) =>
          response.url().endsWith('/fs/workspace-edit/finalize') && response.status() === 200,
      )
      await runPaletteCommand(page, 'Redo multi-file edit')
      await redoFinalized
      await first.waitFor({ state: 'hidden' })
      await expectDisk(fixture, true)
      await step('redo-refreshed-matches')
    } finally {
      await page.unroute('**/fs/workspace-edit/finalize')
      await page.goto(originalUrl)
      await releaseFixture(fixture)
    }
  },
}

async function expectDisk(fixture: string, replaced: boolean) {
  const contents = await Promise.all(files.map((file) => readFile(join(fixture, file), 'utf8')))
  for (const [index, content] of contents.entries()) {
    const expected =
      replaced && files[index] !== 'a.txt' ? initial.replace('renameMe', 'renamedValue') : initial
    strictEqual(content, expected)
  }
}
