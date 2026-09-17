import { rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

import type { Scenario } from './index'
import { chords, selectors } from '../selectors'

const probeName = 'quick-open-probe-file.ts'
const probePath = path.join(import.meta.dirname, '../../../apps/web/src', probeName)

async function searchPalette(page: Parameters<Scenario['run']>[0]) {
  await page.keyboard.press(chords.commandPalette)
  const input = selectors.paletteInput(page)
  await input.waitFor({ timeout: 5_000 })
  await input.fill('quick-open-probe')
  await page.waitForTimeout(1_200)
  const found = await selectors.commandOption(page, probeName).count()
  return found
}

/** A file created after its name was already searched must show up on the next search. */
export const quickOpenNewFile: Scenario = {
  name: 'quick-open-new-file',
  description:
    'Search a missing file name, create the file on disk, and search the same name again.',
  async run(page, { step }) {
    await rm(probePath, { force: true })
    try {
      const before = await searchPalette(page)
      await step(`before-create-found-${before}`)
      await page.keyboard.press('Escape')
      await writeFile(probePath, '')
      await page.waitForTimeout(1_500)
      const soon = await searchPalette(page)
      await step(`after-create-1s-found-${soon}`)
      await page.keyboard.press('Escape')
      await page.waitForTimeout(6_000)
      const later = await searchPalette(page)
      await step(`after-create-8s-found-${later}`)
      await page.keyboard.press('Escape')
    } finally {
      await rm(probePath, { force: true })
    }
  },
}
