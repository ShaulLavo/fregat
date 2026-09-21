import { match } from 'node:assert'
import type { Scenario } from './index'
import { focusEditor, openFileByName, selectors } from '../selectors'

const CALL = 'console.log'

export const editorLspSignatureHelp: Scenario = {
  name: 'editor-lsp-signature-help',
  description: 'Open an argument list and check the signature surface, which loads on that first.',
  async run(page, { file, step }) {
    await openFileByName(page, file)
    await focusEditor(page)
    await page.keyboard.press('Control+Home')
    await page.keyboard.insertText(`${CALL}\n`)
    await page.keyboard.press('ArrowUp')
    await page.keyboard.press('End')
    await page.waitForTimeout(2500)

    // The opening paren, which auto-close writes as '()'. The trigger reads the keystroke, so the
    // two-character edit does not hide it — and this is also what loads the surface and its
    // Markdown renderer, neither of which is in the entry chunk before now.
    await page.keyboard.type('(', { delay: 60 })
    await selectors.editorSignatureHelp(page).waitFor({ state: 'visible', timeout: 8000 })
    match(
      await selectors.editorSignatureHelp(page).innerText(),
      /log/,
      'the signature names the call',
    )
    await step('argument-list')

    // Typing over the closer auto-close inserted changes no text at all, so this dismissal is the
    // other half of reading the keystroke rather than the edit.
    await page.keyboard.type(')', { delay: 60 })
    await selectors.editorSignatureHelp(page).waitFor({ state: 'hidden', timeout: 8000 })
    await step('closed')

    await page.keyboard.press('Escape')
    for (let undo = 0; undo < 6; undo++) await page.keyboard.press('Control+z')
    await step('restored')
  },
}
