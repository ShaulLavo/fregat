import type { Scenario } from './index'
import { focusEditor, openFileByName, selectors } from '../selectors'

export const editorProduct: Scenario = {
  name: 'editor-product',
  description: 'Open real workbench source files for a high-resolution product capture.',
  async run(page, { file, step }) {
    await openFileByName(page, 'code-panel.tsx')
    await openFileByName(page, 'bar-tabs.ts')
    await openFileByName(page, 'use-symbol-revision.ts')
    await openFileByName(page, file)
    await selectors
      .terminalSurface(page)
      .first()
      .click({ position: { x: 100, y: 60 } })
    await page.keyboard.type('bun run --filter web typecheck', { delay: 30 })
    await page.keyboard.press('Enter')
    await page.waitForTimeout(4000)
    await step('terminal-command')
    await focusEditor(page)
    await page.keyboard.press('Control+Home')
    await page.waitForTimeout(1500)
    await selectors.windowToolbar(page).hover()
    await step('editor')
  },
}
