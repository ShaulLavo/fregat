import type { Scenario } from './index'
import { openFileByName, selectors } from '../selectors'

export const editorFastScroll: Scenario = {
  name: 'editor-fast-scroll',
  description:
    'After startup settles, wheel-scroll in 1,200px sweeps and alternating 6,000px jumps.',
  async run(page, { file, step }) {
    await openFileByName(page, file)
    await step('opened')
    await page.waitForTimeout(2_000)
    await step('ready')
    const box = await selectors.editorSurface(page).first().boundingBox()
    if (box) await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    for (let i = 0; i < 40; i++) {
      await page.mouse.wheel(0, Math.floor(i / 8) % 2 === 0 ? 1_200 : -1_200)
      await page.waitForTimeout(16)
    }
    await step('scrolled-down')
    for (let i = 0; i < 40; i++) {
      await page.mouse.wheel(0, i % 2 === 0 ? 6_000 : -6_000)
      await page.waitForTimeout(16)
    }
    await step('scrolled-up')
  },
}
