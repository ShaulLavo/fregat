import type { Scenario } from './index'
import { createScriptError } from '../../structured-errors'
import { chords, selectors } from '../selectors'

const editorFile = 'tokenStore.ts'

async function searchPalette(page: Parameters<Scenario['run']>[0], query: string) {
  await page.keyboard.press(chords.commandPalette)
  const input = selectors.paletteInput(page)
  await input.waitFor({ timeout: 5_000 })
  await input.fill(query)
  await page.waitForTimeout(1_200)
  return selectors.commandOption(page, editorFile).count()
}

/** Editor source is indexed with the other workspace files. */
export const quickOpenEditorSource: Scenario = {
  name: 'quick-open-editor-source',
  readOnly: true,
  description: 'Search for Editor source in the workspace and open it.',
  async run(page, { step }) {
    const byName = await searchPalette(page, 'tokenStore')
    if (byName === 0) throw createScriptError('Editor source did not appear in quick open.')
    await step(`by-file-name-found-${byName}`)
    await selectors.commandOption(page, editorFile).first().click()
    await selectors.editorInput(page).first().waitFor({ state: 'attached' })
    await step('editor-source-opened')
  },
}
