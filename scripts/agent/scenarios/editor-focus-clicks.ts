import type { Scenario } from './index'
import { focusEditor, openFileByName, selectors } from '../selectors'

export const editorFocusClicks: Scenario = {
  name: 'editor-focus-clicks',
  description: 'Compare editor clicks, drag selection, and terminal-to-editor focus changes.',
  async run(page, { file, step }) {
    await openFileByName(page, file)
    await focusEditor(page)
    await page.keyboard.press('Control+Home')
    await page.waitForTimeout(1500)
    const editor = selectors.editorSurface(page).first()
    await step('ready')
    for (let index = 0; index < 20; index++) {
      await editor.click({ position: { x: 90 + (index % 3) * 35, y: 12 + (index % 10) * 24 } })
      await page.waitForTimeout(50)
    }
    await step('clicked')
    await editor.hover({ position: { x: 100, y: 12 } })
    await page.mouse.down()
    await editor.hover({ position: { x: 220, y: 12 } })
    await page.mouse.up()
    await step('dragged')
    await selectors
      .terminalSurface(page)
      .first()
      .click({ position: { x: 100, y: 40 } })
    await step('terminal-focused')
    await editor.click({ position: { x: 100, y: 12 } })
    await step('editor-refocused')
  },
}
