import type { Scenario } from './index'
import { chords, selectors } from '../selectors'

const linkedFile = 'tokenStore.ts'

async function searchPalette(page: Parameters<Scenario['run']>[0], query: string) {
  await page.keyboard.press(chords.commandPalette)
  const input = selectors.paletteInput(page)
  await input.waitFor({ timeout: 5_000 })
  await input.fill(query)
  await page.waitForTimeout(1_200)
  return selectors.commandOption(page, linkedFile).count()
}

/** `packages/editor-core` is a symlink out of the workspace, so the index never scans it. */
export const quickOpenLinkedFile: Scenario = {
  name: 'quick-open-linked-file',
  description: 'Search by name for a file that sits behind a symlinked package folder.',
  async run(page, { step }) {
    const byName = await searchPalette(page, 'tokenStore')
    await step(`by-file-name-found-${byName}`)
    await page.keyboard.press('Escape')
  },
}
