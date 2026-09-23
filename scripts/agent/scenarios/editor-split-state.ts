import { openFixtureWorkspace, releaseFixture, waitForFileContent } from '../fixture-workspace'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { strictEqual, ok } from 'node:assert'
import path from 'node:path'
import type { Page } from 'playwright'
import { createScriptError } from '../../structured-errors'
import { openFileFromTree, runPaletteCommand, selectors } from '../selectors'
import type { Scenario } from './index'

const inspections = new WeakMap<Page, { savedFromRight: boolean; savedLastView: boolean }>()

export const editorSplitState: Scenario = {
  name: 'editor-split-state',
  description:
    'Save from the focused split, close one dirty copy without a prompt, then cancel and save the final dirty view.',
  async run(page, { step }) {
    const fixture = await mkdtemp('/work/tmp/fregat-split-state-')
    const diskPath = path.join(fixture, 'a.ts')
    const originalUrl = page.url()
    const initial = 'export const count = 1\n'
    const saved = '// saved from the right pane\n'
    const dirty = '// unsaved shared change\n'
    const result = { savedFromRight: false, savedLastView: false }
    inspections.set(page, result)
    try {
      await writeFile(diskPath, initial)
      const git = Bun.spawn(['git', 'init', '--quiet', fixture], {
        stdout: 'ignore',
        stderr: 'pipe',
      })
      if (await git.exited) throw createScriptError('Could not initialize split probe')
      const commit = Bun.spawn(
        [
          'git',
          '-C',
          fixture,
          '-c',
          'user.name=Split probe',
          '-c',
          'user.email=split-probe@example.invalid',
          'commit',
          '--quiet',
          '--allow-empty',
          '-m',
          `Split probe ${path.basename(fixture)}`,
        ],
        { stdout: 'ignore', stderr: 'pipe' },
      )
      if (await commit.exited) throw createScriptError('Could not identify split probe repository')
      await openFixtureWorkspace(page, fixture)
      await openFileFromTree(page, 'a.ts')
      await runPaletteCommand(page, 'Split Editor Right')
      await selectors.editorGroupInput(page, 1).waitFor()
      await step('two-file-views')
      ok(
        await selectors
          .editorGroups(page)
          .nth(1)
          .evaluate((element) => element.contains(document.activeElement)),
        'split command focuses its new view',
      )
      await page.keyboard.press('Control+f')
      await selectors.editorGroupFind(page, 1).waitFor()
      await selectors.editorGroupFind(page, 1).fill('count')
      strictEqual(
        await selectors.editorGroupFind(page, 0).count(),
        0,
        'Find opens only in focused pane',
      )
      await step('find-in-right-pane')
      await page.keyboard.press('Escape')
      await page.keyboard.press('Control+End')
      await page.keyboard.type(saved)
      await page.keyboard.press('Control+s')
      await waitForFileContent(diskPath, initial + saved)
      result.savedFromRight = true
      await step('saved-from-right')

      await selectors.editorGroupInput(page, 0).focus()
      await page.keyboard.press('Control+End')
      await page.keyboard.type(dirty)
      await selectors
        .editorGroupRows(page, 1)
        .filter({ hasText: 'unsaved shared change' })
        .first()
        .waitFor()
      await step('dirty-shared-buffer')
      await closeTab(page, 1)
      await selectors.editorGroups(page).nth(1).waitFor({ state: 'hidden' })
      strictEqual(
        await selectors.unsavedChangesDialog(page).count(),
        0,
        'closing one occurrence keeps shared dirty buffer without a prompt',
      )
      await selectors
        .editorGroupRows(page, 0)
        .filter({ hasText: 'unsaved shared change' })
        .first()
        .waitFor()
      await step('first-dirty-view-closed')

      await closeTab(page, 0)
      await selectors.unsavedChangesDialog(page).waitFor()
      await page.waitForTimeout(200)
      await step('last-view-prompt')
      await selectors
        .unsavedChangesDialog(page)
        .getByRole('button', { name: 'Cancel', exact: true })
        .click()
      await selectors.unsavedChangesDialog(page).waitFor({ state: 'hidden' })
      strictEqual(await selectors.editorGroupTabs(page, 0).count(), 1)
      await closeTab(page, 0)
      await selectors
        .unsavedChangesDialog(page)
        .getByRole('button', { name: 'Save', exact: true })
        .click()
      await selectors.unsavedChangesDialog(page).waitFor({ state: 'hidden' })
      await waitForFileContent(diskPath, initial + saved + dirty)
      result.savedLastView = true
      strictEqual(await selectors.editorGroupTabs(page, 0).count(), 0)
      strictEqual(
        await selectors.editorGroups(page).count(),
        1,
        'last empty group remains available',
      )
      await step('last-view-saved-and-closed')
    } finally {
      await page.goto(originalUrl)
      await releaseFixture(fixture)
    }
  },
  async inspect(page) {
    return inspections.get(page)
  },
}

async function closeTab(page: Page, group: number) {
  await selectors.editorGroupTabs(page, group).first().click({ button: 'right' })
  await selectors.menuItem(page, 'Close').click()
}
