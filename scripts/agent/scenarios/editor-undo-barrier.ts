import { match } from 'node:assert'
import type { Scenario } from './index'
import { focusEditor, openFileFromTree, runPaletteCommand, selectors } from '../selectors'

const BARRIER_TOAST = 'Undo stopped at a workspace edit'
const RENAMED = 'renamedValue'

/**
 * Needs a workspace where `renameMe` is exported from `a.ts` and imported in `b.ts`, so the
 * rename spans two files and lands as a workspace group: `--workspace work/tmp/plan121-undo`.
 */
export const editorUndoBarrier: Scenario = {
  name: 'editor-undo-barrier',
  description:
    'Type, rename a symbol across two files, then Ctrl+Z to the barrier and undo the rename from the toast.',
  async run(page, { file, step }) {
    await openFileFromTree(page, file)
    await focusEditor(page)
    await page.keyboard.press('Control+End')
    await page.keyboard.insertText(' // note')
    await page.waitForTimeout(6000)
    await page.keyboard.press('Control+Home')
    for (let i = 0; i < 'export const '.length; i++) await page.keyboard.press('ArrowRight')
    await runPaletteCommand(page, 'Rename symbol')
    const rename = selectors.renameInput(page)
    await rename.waitFor({ state: 'visible', timeout: 8000 })
    await rename.fill(RENAMED)
    await page.keyboard.press('Enter')
    await selectors.workspaceEditApplyAll(page).click({ timeout: 8000 })
    await page.getByText(RENAMED).first().waitFor({ timeout: 8000 })
    await step('renamed')
    await focusEditor(page)
    await page.keyboard.press('Control+z')
    await page.keyboard.press('Control+z')
    const toast = selectors.toast(page, BARRIER_TOAST)
    await toast.waitFor({ state: 'visible', timeout: 5000 })
    match(await toast.innerText(), /Undo workspace edit/)
    // Sonner's enter animation: wait until the toast rests before the screenshot.
    await page.waitForTimeout(400)
    await step('barrier')
    await selectors.toastAction(page, BARRIER_TOAST, 'Undo workspace edit').click()
    await page.getByText('renameMe').first().waitFor({ timeout: 8000 })
    await step('restored')
  },
}
