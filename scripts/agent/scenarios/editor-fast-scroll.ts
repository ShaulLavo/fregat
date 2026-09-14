import type { Scenario } from './index'
import { openFileByName, selectors } from '../selectors'

export const editorFastScroll: Scenario = {
  name: 'editor-fast-scroll',
  description: 'Open a file and wheel-scroll to the bottom and back in large steps.',
  async run(page, { file, step }) {
    await openFileByName(page, file)
    await step('opened')
    const box = await selectors.editorSurface(page).first().boundingBox()
    if (box) await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    for (let i = 0; i < 40; i++) {
      await page.mouse.wheel(0, 1_200)
      await page.waitForTimeout(16)
    }
    await step('scrolled-down')
    for (let i = 0; i < 40; i++) {
      await page.mouse.wheel(0, -1_200)
      await page.waitForTimeout(16)
    }
    await step('scrolled-up')
  },
}
