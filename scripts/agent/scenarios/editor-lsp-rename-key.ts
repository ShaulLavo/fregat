import { equal } from 'node:assert'
import type { Scenario } from './index'
import { focusEditor, focusedEditorInputText, openFileByName, selectors } from '../selectors'

const NAME = 'renameProbe'
const PROMPT_WAIT_MS = 20_000
const MAX_UNDOS = 10

export const editorLspRenameKey: Scenario = {
  name: 'editor-lsp-rename-key',
  description: 'Press F2 on a TypeScript identifier and check the rename prompt opens on its name.',
  async run(page, { file, step }) {
    await openFileByName(page, file)
    await focusEditor(page)
    await page.keyboard.press('Control+Home')
    const original = await page.evaluate(focusedEditorInputText)
    await page.keyboard.insertText(`const ${NAME} = 1\nconsole.log(${NAME})\n`)
    await page.keyboard.press('ArrowUp')
    await page.keyboard.press('Home')
    for (let move = 0; move < 'console.log('.length + 2; move++) {
      await page.keyboard.press('ArrowRight')
    }

    // F2 is the editor's default rename key, not only the VS Code preset's. A cold language server
    // ignores it until it has answered initialize, so ask until the prompt opens.
    await openRenamePrompt(page)
    equal(await selectors.renameInput(page).inputValue(), NAME, 'the prompt starts from the name')
    await step('prompt')

    await page.keyboard.press('Escape')
    await selectors.renameInput(page).waitFor({ state: 'hidden', timeout: 8000 })
    await undoUntil(page, original)
    await step('restored')
  },
}

async function openRenamePrompt(page: Parameters<Scenario['run']>[0]): Promise<void> {
  const deadline = Date.now() + PROMPT_WAIT_MS
  while (Date.now() < deadline) {
    await page.keyboard.press('F2')
    const opened = await selectors
      .renameInput(page)
      .waitFor({ state: 'visible', timeout: 1000 })
      .then(() => true)
      .catch(() => false)
    if (opened) return
  }
  throw new Error(`F2 opened no rename prompt within ${PROMPT_WAIT_MS} ms`)
}

/** Undoes until the start of the file reads as it did, and fails if it never does. */
async function undoUntil(page: Parameters<Scenario['run']>[0], original: string): Promise<void> {
  for (let undo = 0; undo < MAX_UNDOS; undo++) {
    await page.keyboard.press('Control+Home')
    if ((await page.evaluate(focusedEditorInputText)) === original) return
    await page.keyboard.press('Control+z')
  }
  await page.keyboard.press('Control+Home')
  equal(await page.evaluate(focusedEditorInputText), original, 'undo restored the file')
}
