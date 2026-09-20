import { deepStrictEqual } from 'node:assert/strict'
import type { Page } from 'playwright'
import { runPaletteCommand, selectors } from '../selectors'
import type { Scenario } from './index'

async function backgrounds(page: Page) {
  return selectors
    .terminalSurface(page)
    .first()
    .evaluate((terminal) => {
      const layers: string[] = []
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
    await runPaletteCommand(page, 'Show terminal')
    await selectors.terminalSurface(page).first().waitFor()
    const code = await backgrounds(page)
    await step('code-terminal')
    await runPaletteCommand(page, 'Chat mode')
    await selectors.terminalTool(page).click()
    await selectors.terminalSurface(page).first().waitFor()
    const chat = await backgrounds(page)
    await step('chat-terminal')
    console.log(JSON.stringify({ code, chat }))
    deepStrictEqual(chat, code, 'Chat and code terminals must use the same background layers')
  },
}
