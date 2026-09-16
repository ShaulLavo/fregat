import { strictEqual } from 'node:assert'
import type { Scenario } from './index'
import { focusEditor, openFileFromTree, runPaletteCommand, selectors } from '../selectors'

/** Any workspace file works; `--workspace work/tmp/plan121-undo --file a.ts` keeps the repo clean. */
export const editorUndoBranch: Scenario = {
  name: 'editor-undo-branch',
  description:
    'Type A, type B, undo, type C, open History, compare B with C, restore B, check the buffer.',
  async run(page, { file, step }) {
    await openFileFromTree(page, file)
    await focusEditor(page)
    await page.keyboard.press('Control+End')
    await page.keyboard.type('A')
    await page.keyboard.press('Control+z')
    await page.keyboard.type('B')
    await page.keyboard.press('Control+z')
    await page.keyboard.type('C')
    await page.keyboard.press('Control+z')
    await page.keyboard.type('CC')
    await step('typed')

    await runPaletteCommand(page, 'Show history')
    const states = selectors.historyStates(page)
    await states.waitFor({ timeout: 10_000 })
    strictEqual(await states.getByRole('option').count(), 5, 'root, A, B, C and CC are retained')
    await step('history')

    // Keyboard first: Left walks back in sequence order, Shift+Right adds the next state to the
    // selection, Escape clears it, Enter restores the focused state.
    await states.focus()
    await page.keyboard.press('ArrowLeft')
    await page.keyboard.press('ArrowLeft')
    await selectors.diffRows(page).first().waitFor({ timeout: 10_000 })
    await step('compared-b-with-current')
    await page.keyboard.press('Shift+ArrowRight')
    await selectors.diffRows(page).filter({ hasText: 'C' }).first().waitFor({ timeout: 10_000 })
    await step('compared-b-with-c')
    await page.keyboard.press('Escape')

    // A real pointer click on the C node, at its own centre: the diff becomes C against CC.
    const box = await selectors.historyState(page, 3).boundingBox()
    if (!box) throw new Error('state 3 is not on screen')
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
    await selectors.diffRows(page).filter({ hasText: 'CC' }).first().waitFor({ timeout: 10_000 })
    await step('clicked')

    await states.focus()
    await page.keyboard.press('ArrowLeft')
    await page.keyboard.press('Enter')
    await page.getByText('This is the current state.').waitFor({ timeout: 10_000 })
    await step('restored')

    // The file's own tab shows the restored text: B, not CC.
    await selectors
      .editorTabNamed(page, /^a\.ts$/)
      .first()
      .click()
    await selectors.editorRows(page).filter({ hasText: /^B$/ }).first().waitFor({ timeout: 10_000 })
    strictEqual(await selectors.editorRows(page).filter({ hasText: 'CC' }).count(), 0)
    await step('editor-text')
  },
}
