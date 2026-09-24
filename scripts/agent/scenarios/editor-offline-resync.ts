import { mkdtemp, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { Page } from 'playwright'

import { openFixtureWorkspace, releaseFixture } from '../fixture-workspace'
import { focusEditor, openFileFromTree, selectors } from '../selectors'
import type { Scenario } from './index'

const inspections = new WeakMap<Page, { phases: string[] }>()

export const editorOfflineResync: Scenario = {
  name: 'editor-offline-resync',
  description:
    'Go offline with a clean and a dirty file open, change both and add a file on disk, then come back: the clean file updates, the dirty one raises a conflict, the tree lists the new file.',
  async run(page, { step }) {
    const inspection = { phases: new Array<string>() }
    inspections.set(page, inspection)
    const fixture = await mkdtemp('/work/tmp/fregat-offline-resync-')
    try {
      await writeFile(path.join(fixture, 'clean.txt'), 'CLEAN_BEFORE\n')
      await writeFile(path.join(fixture, 'dirty.txt'), 'DIRTY_BEFORE\n')
      await openFixtureWorkspace(page, fixture)
      await openFileFromTree(page, 'clean.txt')
      await openFileFromTree(page, 'dirty.txt')
      await focusEditor(page)
      await page.keyboard.press('Control+End')
      await page.keyboard.insertText('UNSAVED_WHILE_OFFLINE')
      await step('before-offline')

      await page.context().setOffline(true)
      // Long enough for the event streams to notice and schedule their retry.
      await page.waitForTimeout(1500)
      await writeFile(path.join(fixture, 'clean.txt'), 'CLEAN_CHANGED_OFFLINE\n')
      await writeFile(path.join(fixture, 'dirty.txt'), 'DIRTY_CHANGED_OFFLINE\n')
      await writeFile(path.join(fixture, 'added-offline.txt'), 'new\n')
      await page.waitForTimeout(500)
      await page.context().setOffline(false)

      await selectors.fileConflict(page, 'dirty.txt').waitFor({ timeout: 20_000 })
      await selectors.editorRows(page).filter({ hasText: 'UNSAVED_WHILE_OFFLINE' }).waitFor()
      inspection.phases.push('dirty-conflict')
      await selectors.treeItem(page, 'added-offline.txt').waitFor({ timeout: 20_000 })
      inspection.phases.push('tree-resynced')
      await step('back-online')

      await openFileFromTree(page, 'clean.txt')
      await selectors.editorRows(page).filter({ hasText: 'CLEAN_CHANGED_OFFLINE' }).waitFor()
      inspection.phases.push('clean-updated')
      await step('clean-updated')
    } finally {
      await page.context().setOffline(false)
      await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide')))
      await releaseFixture(fixture)
    }
  },
  async inspect(page) {
    return inspections.get(page)
  },
}
