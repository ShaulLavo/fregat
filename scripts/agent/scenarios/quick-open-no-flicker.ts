import { ok, strictEqual } from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { Page } from 'playwright'
import type { Scenario } from './index'
import { countBlankFrames, recordFrames } from '../blank-frames'
import {
  createGitFixture,
  fixtureGit,
  openFixtureWorkspace,
  releaseFixture,
} from '../fixture-workspace'
import { chords, selectors } from '../selectors'

/** Search and preview changes must keep their loaded content through the next read. */
export const quickOpenNoFlicker: Scenario = {
  name: 'quick-open-no-flicker',
  description: 'Type a file name, then arrow through delayed previews and count blank frames.',
  async run(page, { step }) {
    const fixture = await createGitFixture('quick-open-no-flicker')
    try {
      for (const name of ['alpha', 'bravo', 'charlie']) {
        await writeFile(path.join(fixture, `preview-switch-${name}.txt`), `${name}\n`.repeat(100))
      }
      await fixtureGit(fixture, ['commit', '--quiet', '-m', 'fixture'])
      await openFixtureWorkspace(page, fixture)
      await page.route('**/fs/head?*', async (route) => {
        await new Promise((resolve) => setTimeout(resolve, 300))
        await route.continue()
      })
      await page.keyboard.press(chords.commandPalette)
      const input = selectors.paletteInput(page)
      await input.waitFor({ timeout: 5_000 })
      await input.fill('')
      await page.locator(selectors.paletteRowSelector).first().waitFor()
      const rowsBlank = await countBlankFrames(page, selectors.paletteRowSelector, async () => {
        await page.keyboard.type('preview-switch', { delay: 70 })
        await page.waitForTimeout(800)
      })
      await step(`list-blank-frames-${rowsBlank}`)
      strictEqual(rowsBlank, 0, 'quick open search blanked its loaded rows')
      await page.locator(selectors.quickOpenPreviewTextSelector).waitFor()
      const initialHeight = (await selectors.quickOpenPreview(page).boundingBox())!.height
      let blank = 0
      const frames = await recordFrames<{ height: number; header: string; body: string }>(
        page,
        `() => {
          const body = document.querySelector(${JSON.stringify(selectors.quickOpenPreviewTextSelector)})
          const header = document.querySelector(${JSON.stringify(selectors.quickOpenPreviewHeaderSelector)})
          return {
            height: body?.closest('section')?.getBoundingClientRect().height ?? 0,
            header: header?.textContent?.trim() ?? '',
            body: body?.textContent?.trim().split('\\n')[0] ?? '',
          }
        }`,
        async () => {
          blank = await countBlankFrames(page, selectors.quickOpenPreviewTextSelector, () =>
            arrowThroughPreviews(page),
          )
        },
      )
      await step(`preview-blank-frames-${blank}`)
      strictEqual(blank, 0, 'quick open blanked its preview between files')
      ok(frames.length > 0, 'preview sampling recorded frames')
      ok(
        frames.every((frame) => frame.height >= initialHeight),
        'preview retained its height',
      )
      ok(
        frames.every((frame) => frame.header === `preview-switch-${frame.body}.txt`),
        'every frame named the shown body',
      )
      ok(new Set(frames.map((frame) => frame.body)).size >= 3, 'all three previews painted')
      await page.keyboard.press('Escape')
    } finally {
      await releaseFixture(fixture)
    }
  },
}

async function arrowThroughPreviews(page: Page) {
  for (let index = 0; index < 2; index += 1) {
    await page.keyboard.press('ArrowDown')
    await page.waitForTimeout(650)
  }
  await page.keyboard.press('ArrowUp')
  await page.waitForTimeout(200)
}
