import { deepStrictEqual, ok } from 'node:assert/strict'
import type { Scenario } from './index'
import type { Page } from 'playwright'
import { morphSelectors, openFileByName, selectors } from '../selectors'

type Motion = {
  /** First-row text of each painted frame while the edit lands, when it changed. */
  readonly firstRowFrames: readonly string[]
  readonly overlay: boolean
  readonly slidingRows: number
}

const reports = new WeakMap<Page, Motion>()

/** Page-side: records the first row's text each frame until stopped. */
function watchFirstRow(): void {
  const frames: string[] = []
  const host = globalThis as unknown as { __firstRowFrames: string[]; __stopWatch: boolean }
  host.__firstRowFrames = frames
  host.__stopWatch = false
  const tick = () => {
    const text = document.querySelector('.editor-virtualized-row')?.textContent ?? ''
    if (frames.at(-1) !== text) frames.push(text)
    if (!host.__stopWatch) requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
}

function stopWatching(): string[] {
  const host = globalThis as unknown as { __firstRowFrames: string[]; __stopWatch: boolean }
  host.__stopWatch = true
  return host.__firstRowFrames
}

/** Page-side: rendered rows moving as whole rows, then every animation frozen at `ms`. */
function slidingRowsAt(ms: number): number {
  let sliding = 0
  for (const animation of document.getAnimations()) {
    const effect = animation.effect as KeyframeEffect | null
    const target = effect?.target
    if (target instanceof HTMLElement && target.classList.contains('editor-virtualized-row')) {
      if (effect?.getKeyframes().some((frame) => frame.translate)) sliding += 1
    }
    const end = effect?.getComputedTiming().endTime
    if (typeof end !== 'number' || !Number.isFinite(end)) continue
    animation.pause()
    animation.currentTime = ms
  }
  return sliding
}

export const editorMarkdownMorph: Scenario = {
  name: 'editor-markdown-morph',
  description:
    'Open docs/releasing.md in Markdown preview and move a line up: the preview stays rendered through the edit, plain rows morph on the overlay and rendered rows slide whole.',
  inspect: async (page) => reports.get(page),
  async run(page, { step }) {
    // The rows this scenario names are in this file of the checkout.
    await openFileByName(page, 'docs/releasing.md')
    await selectors
      .editorSurface(page)
      .locator('.editor-virtualized-row', { hasText: 'Changesets applies the pending' })
      .first()
      .waitFor()
    await page.waitForTimeout(1000)
    await step('opened')
    await selectors
      .editorSurface(page)
      .locator('.editor-virtualized-row', { hasText: 'Changesets applies the pending' })
      .first()
      .click()
    await page.evaluate(watchFirstRow)
    await page.keyboard.press('Alt+ArrowUp')
    await page.locator(morphSelectors.piece).first().waitFor({ state: 'attached' })
    const overlay = (await page.locator(morphSelectors.layer).count()) > 0
    const slidingRows = await page.evaluate(slidingRowsAt, 200)
    await step('moved-mid-flight')
    await page.evaluate(() => {
      for (const animation of document.getAnimations()) animation.play()
    })
    await page.locator(morphSelectors.layer).waitFor({ state: 'detached', timeout: 10_000 })
    await page.waitForTimeout(600)
    const firstRowFrames = await page.evaluate(stopWatching)
    await step('settled')
    reports.set(page, { firstRowFrames, overlay, slidingRows })

    deepStrictEqual(firstRowFrames, ['Releasing packages'], 'the preview stays rendered')
    ok(overlay, 'plain rows morph on the overlay')
    ok(slidingRows > 0, `rendered rows slide whole: ${slidingRows}`)
  },
}
