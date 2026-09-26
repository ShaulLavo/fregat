import { deepStrictEqual, ok } from 'node:assert/strict'
import type { Page } from 'playwright'
import { runPaletteCommand, selectors } from '../selectors'
import type { Scenario } from './index'

async function backgrounds(page: Page) {
  return selectors
    .terminalSurface(page)
    .first()
    .evaluate(async (terminal) => {
      const layers: string[] = []
      // The pane body is reused between tools, so its fill animates in; read it once that ends.
      for (let element = terminal.parentElement; element; element = element.parentElement)
        await Promise.all(element.getAnimations().map((animation) => animation.finished))
      for (let element = terminal.parentElement; element; element = element.parentElement) {
        const color = getComputedStyle(element).backgroundColor
        if (color !== 'rgba(0, 0, 0, 0)') layers.push(color)
      }
      return layers
    })
}

export const terminalBackground: Scenario = {
  name: 'terminal-background',
  description: 'Compare terminal background layers in code and chat modes.',
  async run(page, { step }) {
    await selectors.workspaceMode(page, 'Workbench').click()
    await runPaletteCommand(page, 'Show terminal')
    await selectors.terminalSurface(page).first().waitFor()
    const canvas = selectors.terminalSurface(page).first().locator('canvas').first()
    await canvas.waitFor()
    const originalCanvas = await canvas.elementHandle()
    const code = await backgrounds(page)
    await step('code-terminal')
    await selectors.workspaceMode(page, 'Chat').click()
    await selectors.terminalTool(page).click()
    await selectors.terminalSurface(page).first().waitFor()
    ok(
      await originalCanvas?.evaluate((node) => node.isConnected),
      'Mode change retains the terminal renderer',
    )
    const chat = await backgrounds(page)
    await step('chat-terminal')
    console.log(JSON.stringify({ code, chat }))
    deepStrictEqual(chat, code, 'Chat and code terminals must use the same background layers')
  },
}
