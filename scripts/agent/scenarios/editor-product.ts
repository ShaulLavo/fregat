import type { Scenario } from './index'
import { inspectTreeOcclusion } from '../tree-occlusion'
import { chords, focusEditor, openFileByName, selectors } from '../selectors'

export const editorProduct: Scenario = {
  name: 'editor-product',
  inspect: inspectTreeOcclusion,
  description: 'Open real workbench source files for a high-resolution product capture.',
  async run(page, { file, step }) {
    await openFileByName(page, 'code-panel.tsx')
    await openFileByName(page, 'syntax-highlighting.ts')
    await openFileByName(page, 'save-service.ts')
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
    if (file === 'plugins.ts') {
      await page.keyboard.press(chords.commandPalette)
      await selectors.paletteInput(page).fill(':67')
      await page.keyboard.press('Enter')
    }
    await page.waitForTimeout(1500)
    await selectors.windowToolbar(page).hover()
    await step('editor')
  },
}
