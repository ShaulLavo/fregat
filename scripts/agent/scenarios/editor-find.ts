import type { Scenario } from './index'
import { focusEditor, openFileByName, selectors } from '../selectors'

const EXACT_COUNT = /^(\d+|\?) of \d+$/

async function countText(page: Parameters<Scenario['run']>[0]): Promise<string> {
  return (await selectors.editorFindCount(page).first().textContent()) ?? ''
}

export const editorFind: Scenario = {
  name: 'editor-find',
  description:
    'Open find in a file, type a dense and a sparse query, step through matches, jump to one off screen, then search for text that is not there.',
  async run(page, { file, step }) {
    await openFileByName(page, file)
    await focusEditor(page)
    await page.keyboard.press('Control+Home')
    await page.keyboard.press('Control+f')
    const input = selectors.editorFindInput(page).first()
    await input.waitFor({ timeout: 5_000 })

    await input.fill('e')
    await page.waitForTimeout(200)
    const dense = await countText(page)
    if (!EXACT_COUNT.test(dense)) throw new Error(`dense count is not exact: "${dense}"`)
    await step(`dense ${dense}`)

    await input.fill('const')
    await page.waitForTimeout(200)
    await page.keyboard.press('Enter')
    await page.keyboard.press('Enter')
    const forward = await countText(page)
    await page.keyboard.press('Shift+Enter')
    const back = await countText(page)
    if (!EXACT_COUNT.test(forward) || forward === back)
      throw new Error(`navigation did not move the position: "${forward}" then "${back}"`)
    await step(`stepped ${forward} then ${back}`)

    // Far enough down that the match starts off screen: it should land mid-viewport.
    await input.fill('queryClient')
    await page.waitForTimeout(200)
    for (let press = 0; press < 12; press += 1) await page.keyboard.press('Enter')
    await step(`jumped ${await countText(page)}`)

    await input.fill('zzqqzz-not-here')
    await page.waitForTimeout(200)
    const absent = await countText(page)
    if (absent !== 'No results') throw new Error(`absent query shows "${absent}"`)
    await step('absent')
  },
}
