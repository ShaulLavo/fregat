import type { Page } from 'playwright'
import type { Scenario } from './index'
import { ghosttySiteSelectors } from '../selectors'
import { createScriptError } from '../../structured-errors'

async function waitForFit(page: Page): Promise<void> {
  for (let frame = 0; frame < 3; frame += 1) {
    await page.evaluate(() => new Promise<number>(requestAnimationFrame))
  }
}

export const ghosttySiteFit: Scenario = {
  name: 'ghostty-site-fit',
  surface: 'site',
  readOnly: true,
  description: 'Check the terminal phone height and desktop → phone → desktop fitting.',
  async run(page, { evidence, step }) {
    async function fit(width: number, height: number) {
      await page.setViewportSize({ width, height })
      await page.locator(ghosttySiteSelectors.stat).filter({ hasText: 'cells redrawn' }).waitFor()
      await waitForFit(page)
      await page.locator(ghosttySiteSelectors.window).scrollIntoViewIfNeeded()
      return page.locator(ghosttySiteSelectors.screen).evaluate(
        (screen, canvasSelector) => ({
          width: screen.clientWidth,
          height: screen.clientHeight,
          canvasWidth: screen.querySelector<HTMLCanvasElement>(canvasSelector)?.width,
          canvasHeight: screen.querySelector<HTMLCanvasElement>(canvasSelector)?.height,
        }),
        ghosttySiteSelectors.canvas,
      )
    }

    const desktop = await fit(1280, 900)
    await step('desktop')
    const phone = await fit(390, 844)
    await step('phone')
    if (phone.height > 844 * 0.45)
      throw createScriptError('The fitted phone terminal exceeds its viewport share.')
    if (!(await page.locator(ghosttySiteSelectors.backend).isVisible()))
      throw createScriptError('The phone backend label is hidden.')
    const details = page.locator(ghosttySiteSelectors.pty)
    if ((await details.getAttribute('open')) !== null)
      throw createScriptError('The PTY example starts expanded.')
    await details.locator('summary').click()
    const examples = await page.locator(ghosttySiteSelectors.examples).evaluateAll((blocks) =>
      blocks.map((block) => ({
        label: block.getAttribute('aria-label'),
        width: block.clientWidth,
        scrollWidth: block.scrollWidth,
      })),
    )
    await evidence.json('phone-examples.json', examples)
    if (examples.length !== 2 || examples.some((block) => block.scrollWidth > block.width))
      throw createScriptError('The phone code examples overflow horizontally.')
    const ink = await page
      .locator(ghosttySiteSelectors.factLead)
      .first()
      .evaluate((lead) => getComputedStyle(lead).color)
    const headingsMatch = await page
      .locator(ghosttySiteSelectors.sectionHeadings)
      .evaluateAll(
        (headings, color) => headings.every((heading) => getComputedStyle(heading).color === color),
        ink,
      )
    if (!headingsMatch)
      throw createScriptError('The section headings differ from the fact lead ink.')
    await details.scrollIntoViewIfNeeded()
    await step('phone-pty-wiring')
    await details.locator('summary').click()
    const restored = await fit(1280, 900)
    await step('desktop-restored')
    await evidence.json('fit-dimensions.json', { desktop, phone, restored })
    if (JSON.stringify(desktop) !== JSON.stringify(restored))
      throw createScriptError('The desktop terminal dimensions changed after the phone resize.')
    await details.locator('summary').click()
    await details.scrollIntoViewIfNeeded()
    await step('pty-wiring')
    await page.locator(ghosttySiteSelectors.preview).scrollIntoViewIfNeeded()
    await step('preview-and-measured')
  },
}
