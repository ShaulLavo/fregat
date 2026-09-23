import { ok } from 'node:assert/strict'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { openFixtureWorkspace, releaseFixture } from '../fixture-workspace'
import { focusEditor, openFileFromTree, selectors } from '../selectors'
import type { Scenario } from './index'

const filename = 'conflict-probe.txt'

export const editorConflictMerge: Scenario = {
  name: 'editor-conflict-merge',
  description:
    'Compare an unsaved edit against an external write, keep the local side from the conflict lens, and check the file on disk.',
  async run(page, { step }) {
    const fixture = await mkdtemp('/work/tmp/fregat-conflict-merge-')
    const disk = path.join(fixture, filename)
    try {
      await writeFile(disk, 'shared first line\nbase line\n')
      await openFixtureWorkspace(page, fixture)
      await openFileFromTree(page, filename)
      await selectors.editorRows(page).filter({ hasText: 'base line' }).waitFor()
      // A clean external write that reaches the editor proves the file watch is live before the
      // conflicting one, which would otherwise race the subscription.
      await writeFile(disk, 'shared first line\nbase line\nWATCH_READY\n')
      await selectors.editorRows(page).filter({ hasText: 'WATCH_READY' }).waitFor({ timeout: 8000 })
      await focusEditor(page)
      await page.keyboard.press('Control+End')
      await page.keyboard.type('LOCAL_EDIT')
      await writeFile(disk, 'shared first line\nREMOTE_EDIT\n')

      const dialog = selectors.fileConflict(page, filename)
      await dialog.waitFor({ timeout: 8000 })
      await step('conflict-offered')
      await dialog.getByRole('button', { name: 'Compare', exact: true }).click()
      const accept = selectors.mergeConflictLensAction(page, 'Accept Current Change').first()
      await accept.waitFor({ timeout: 8000 })
      await step('conflict-document')

      await accept.click()
      const saved = await waitForResolvedFile(disk)
      ok(saved.includes('LOCAL_EDIT'), `the local side was not kept: ${JSON.stringify(saved)}`)
      ok(!saved.includes('REMOTE_EDIT'), `the incoming side survived: ${JSON.stringify(saved)}`)
      await step('resolved-and-saved')
    } finally {
      await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide')))
      await releaseFixture(fixture)
    }
  },
}

/** The resolution is saved once no marker is left, so wait for a marker-free file on disk. */
async function waitForResolvedFile(file: string): Promise<string> {
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    const text = await readFile(file, 'utf8')
    if (text.includes('LOCAL_EDIT') && !text.includes('<<<<<<<')) return text

    await Bun.sleep(100)
  }
  return readFile(file, 'utf8')
}
