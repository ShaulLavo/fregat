import { strictEqual } from 'node:assert'
import type { Scenario } from './index'
import { focusEditor, openFileByName, selectors } from '../selectors'

const OPENERS: readonly (readonly [string, string])[] = [
  ['(', '()'],
  ['[', '[]'],
  ['{', '{}'],
  ['"', '""'],
]

export const editorAutoClose: Scenario = {
  name: 'editor-auto-close',
  description:
    'Type each opening bracket and a quote on an empty line and check its closer appears.',
  async run(page, { file, step }) {
    await openFileByName(page, file)
    await focusEditor(page)
    await page.keyboard.press('Control+Home')
    await page.keyboard.press('End')
    await page.keyboard.insertText('\n')
    const results: string[] = []
    for (const [opener, expected] of OPENERS) {
      await page.keyboard.type(opener, { delay: 60 })
      await page.waitForTimeout(300)
      const line = (await selectors.editorRows(page).nth(1).innerText()).trim()
      results.push(`${opener} → ${line}`)
      await page.keyboard.press('Home')
      await page.keyboard.press('Shift+End')
      await page.keyboard.press('Backspace')
      if (line !== expected) results.push(`  expected ${expected}`)
    }
    console.log(results.join('\n'))
    await step('typed')
    await page.keyboard.press('Control+z')
    strictEqual(
      results.some((row) => row.startsWith('  expected')),
      false,
      'every opener closes',
    )
  },
}
