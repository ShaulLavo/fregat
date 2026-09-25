import { mkdtemp, writeFile } from 'node:fs/promises'
import path from 'node:path'

import type { Page } from 'playwright'
import type { Scenario } from './index'
import { openFixtureWorkspace, releaseFixture } from '../fixture-workspace'
import { focusEditor, openFileFromTree, selectors } from '../selectors'
import { createScriptError } from '../../structured-errors'

async function composerText(page: Page, expected: string, what: string) {
  const composer = selectors.chatMessage(page)
  await composer.waitFor({ timeout: 15_000 })
  await page
    .waitForFunction(
      ({ element, text }) => (element?.textContent ?? '').includes(text),
      { element: await composer.elementHandle(), text: expected },
      { timeout: 5_000 },
    )
    .catch(async () => {
      throw createScriptError(
        `${what} did not reach the composer: ${JSON.stringify(await composer.textContent())}`,
      )
    })
}

export const editorAddToChat: Scenario = {
  name: 'editor-add-to-chat',
  description:
    "Mod+L puts the editor's selected lines in the workspace composer, quoted under path and lines; Add File to Chat from the text menu mentions the file.",
  async run(page, { step }) {
    const fixture = await mkdtemp('/work/tmp/fregat-add-to-chat-')
    try {
      await writeFile(
        path.join(fixture, 'a.ts'),
        ['const one = 1', 'const two = 2', 'const three = 3', 'const four = 4', ''].join('\n'),
      )
      await openFixtureWorkspace(page, fixture)
      await openFileFromTree(page, 'a.ts')
      await focusEditor(page)
      await page.keyboard.press('Control+Home')
      await page.keyboard.press('ArrowDown')
      await page.keyboard.press('Shift+ArrowDown')
      await page.keyboard.press('Shift+End')
      await page.keyboard.press('Control+L')
      await composerText(page, 'About `a.ts`, lines 2–3:', 'The selection')
      await composerText(page, 'const three = 3', 'The selected text')
      await step('selection-in-composer')

      await selectors.chatMessage(page).click()
      await page.keyboard.press('Control+A')
      await page.keyboard.press('Delete')
      await focusEditor(page)
      await selectors.editorSurface(page).first().click({ button: 'right' })
      await selectors.menuItem(page, 'Add File to Chat').click()
      await composerText(page, 'a.ts', 'The file mention')
      await step('file-mention-in-composer')
    } finally {
      await releaseFixture(fixture)
    }
  },
}
