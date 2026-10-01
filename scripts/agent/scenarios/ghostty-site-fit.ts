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
  capture: { scale: 1.3 },
  readOnly: true,
  description: 'Check the terminal phone height and desktop → phone → desktop fitting.',
  async run(page, { evidence, step }) {
    async function fit(width: number, height: number) {
      await page.setViewportSize({ width, height })
      await page.locator(ghosttySiteSelectors.stat).filter({ hasText: 'cells redrawn' }).waitFor()
      await waitForFit(page)
      await page.locator(ghosttySiteSelectors.window).scrollIntoViewIfNeeded()
      const geometry = await page
        .locator(ghosttySiteSelectors.screen)
        .evaluate((screen, selectors) => {
          const canvas = screen.querySelector<HTMLCanvasElement>(selectors.canvas)
          const composition = screen.querySelector<HTMLElement>(selectors.composition)
          // Composition sizing exposes the renderer's committed cell dimensions.
          const ratio = window.devicePixelRatio
          const cellWidth = Math.round(Number.parseFloat(composition?.style.minWidth ?? '') * ratio)
          const cellHeight = Math.round(
            Number.parseFloat(composition?.style.minHeight ?? '') * ratio,
          )
          return {
            width: screen.clientWidth,
            height: screen.clientHeight,
            pixelRatio: ratio,
            canvasWidth: canvas?.width,
            canvasHeight: canvas?.height,
            columns: canvas ? canvas.width / cellWidth : 0,
            rows: canvas ? canvas.height / cellHeight : 0,
          }
        }, ghosttySiteSelectors)
      await evidence.json(`grid-${width}.json`, geometry)
      if (!geometry.canvasWidth || !geometry.canvasHeight)
        throw createScriptError('The terminal renderer canvas is missing.')
      if (!Number.isInteger(geometry.columns) || geometry.columns < 78 || geometry.rows !== 40)
        throw createScriptError('The rendered terminal grid cannot show the whole ghost.')
      return geometry
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
