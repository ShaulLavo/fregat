import { mkdtemp, writeFile } from 'node:fs/promises'
import { strictEqual } from 'node:assert'
import path from 'node:path'
import type { Page } from 'playwright'
import {
  fixtureGit,
  openFixtureWorkspace,
  releaseFixture,
  waitForFileContent,
} from '../fixture-workspace'
import { focusEditor, openFileFromTree, selectors } from '../selectors'
import type { Scenario } from './index'

const INITIAL = 'export const count = 1\n'
const EDITED = 'export const count = 1 // kept\n'

export const editorUndoReopen: Scenario = {
  name: 'editor-undo-reopen',
  description: 'Type, save, close the tab, reopen and undo; then reload the window and undo again.',
  async run(page, { step }) {
    const fixture = await mkdtemp('/work/tmp/fregat-undo-reopen-')
    const diskPath = path.join(fixture, 'a.ts')
    try {
      await writeFile(diskPath, INITIAL)
      await fixtureGit(fixture, ['init', '--quiet'])
      await openFixtureWorkspace(page, fixture)
      await openFileFromTree(page, 'a.ts')
      await focusEditor(page)
      await page.keyboard.press('Control+Home')
      await page.keyboard.press('End')
      await page.keyboard.type(' // kept')
      await page.keyboard.press('Control+s')
      await waitForFileContent(diskPath, EDITED)
      await step('saved')

      await closeTab(page)
      await selectors.editorInput(page).first().waitFor({ state: 'detached', timeout: 10_000 })
      await openFileFromTree(page, 'a.ts')
      await pressUntil(page, 'Control+z', INITIAL.trimEnd())
      await step('undone-after-reopen')

      // Redo back to the saved text, so the reload leaves nothing unsaved behind.
      await pressUntil(page, 'Control+y', EDITED.trimEnd())
      await page.reload()
      await openFileFromTree(page, 'a.ts')
      await pressUntil(page, 'Control+z', INITIAL.trimEnd())
      await step('undone-after-reload')
      await pressUntil(page, 'Control+y', EDITED.trimEnd())
    } finally {
      await releaseFixture(fixture)
    }
  },
}

// Typing lands as several states, and the stored history arrives a moment after the
// file does, so the chord repeats until the row reads as expected.
async function pressUntil(page: Page, chord: string, expected: string) {
  const deadline = Date.now() + 8000
  while (Date.now() < deadline) {
    await focusEditor(page)
    await page.keyboard.press(chord)
    if ((await firstRowText(page)) === expected) return
    await page.waitForTimeout(150)
  }
  strictEqual(await firstRowText(page), expected, `${chord} reaches the expected text`)
}

async function firstRowText(page: Page) {
  return (await selectors.editorRows(page).first().textContent())?.trimEnd()
}

async function closeTab(page: Page) {
  await selectors.editorGroupTabs(page, 0).first().click({ button: 'right' })
  await selectors.menuItem(page, 'Close').click()
}
