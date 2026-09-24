import { deepStrictEqual } from 'node:assert'
import type { Scenario } from './index'
import { focusEditor, highlightTexts, openFileByName } from '../selectors'
import { createScriptError } from '../../structured-errors'

export const editorLspDeprecated: Scenario = {
  name: 'editor-lsp-deprecated',
  description: 'Call a deprecated API and check the diagnostic strikes through exactly its name.',
  async run(page, { file, step }) {
    await openFileByName(page, file)
    await focusEditor(page)
    await page.keyboard.press('Control+Home')
    await page.keyboard.insertText(`void 'deprecated'.substr(1)\n`)
    await page
      .waitForFunction(
        `[...CSS.highlights].some(([name, h]) => name.endsWith('-deprecated') && h.size > 0)`,
        undefined,
        { timeout: 10000 },
      )
      .catch(async () => {
        const registered = await page.evaluate(
          `[...CSS.highlights].map(([name, h]) => name + ':' + h.size)`,
        )
        throw createScriptError(`No deprecated strike; registered: ${JSON.stringify(registered)}`)
      })
    deepStrictEqual(await highlightTexts(page, '-deprecated'), ['substr'])
    await step('struck')
    await page.keyboard.press('Control+z')
    await page.waitForFunction(
      `![...CSS.highlights].some(([name, h]) => name.endsWith('-deprecated') && h.size > 0)`,
      undefined,
      { timeout: 10000 },
    )
    await step('restored')
  },
}
