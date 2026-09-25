import { equal } from 'node:assert'
import type { Scenario } from './index'
import { focusEditor, openFileByName, selectors } from '../selectors'

const NAME = 'renameProbe'

export const editorLspRenameKey: Scenario = {
  name: 'editor-lsp-rename-key',
  description: 'Press F2 on a TypeScript identifier and check the rename prompt opens on its name.',
  async run(page, { file, step }) {
    await openFileByName(page, file)
    await focusEditor(page)
    await page.keyboard.press('Control+Home')
    await page.keyboard.insertText(`const ${NAME} = 1\nconsole.log(${NAME})\n`)
    await page.keyboard.press('ArrowUp')
    await page.keyboard.press('Home')
    for (let move = 0; move < 'console.log('.length + 2; move++)
      await page.keyboard.press('ArrowRight')
    await page.waitForTimeout(2500)

    // F2 is the editor's default rename key, not only the VS Code preset's.
    await page.keyboard.press('F2')
    await selectors.renameInput(page).waitFor({ state: 'visible', timeout: 8000 })
    equal(await selectors.renameInput(page).inputValue(), NAME, 'the prompt starts from the name')
    await step('prompt')

    await page.keyboard.press('Escape')
    await selectors.renameInput(page).waitFor({ state: 'hidden', timeout: 8000 })
    for (let undo = 0; undo < 4; undo++) await page.keyboard.press('Control+z')
    await step('restored')
  },
}
