import { deepStrictEqual, strictEqual } from 'node:assert/strict'
import type { Page } from 'playwright'

import { selectors, waitForApp } from '../selectors'
import type { Scenario } from './index'

type SampleWidths = Record<string, number>

/** Each suggested row's sample width: a row redrawn in another face changes width. */
const sampleWidths = (page: Page) =>
  page.evaluate(() => {
    const widths: Record<string, number> = {}
    for (const row of document.querySelectorAll('[role="option"]')) {
      const spans = row.querySelectorAll('span')
      const sample = spans[1]
      if (!sample) continue
      widths[spans[0]?.textContent ?? ''] = Math.round(sample.getBoundingClientRect().width * 10)
    }
    return widths
  })

/** Counts frames whose interface font names a face the browser has not loaded yet. */
const startFallbackWatch = (page: Page) =>
  page.evaluate(() => {
    const state = { frames: 0, fallbackFrames: 0, families: [] as string[] }
    ;(window as unknown as { __fontWatch: typeof state }).__fontWatch = state
    const tick = () => {
      const stack = getComputedStyle(document.documentElement).getPropertyValue('--font-ui')
      const first = stack.split(',')[0]?.trim() ?? ''
      state.frames += 1
      if (!document.fonts.check(`1em ${first}`)) {
        state.fallbackFrames += 1
        if (!state.families.includes(first)) state.families.push(first)
      }
      requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  })

const readFallbackWatch = (page: Page) =>
  page.evaluate(
    () =>
      (
        window as unknown as {
          __fontWatch: { frames: number; fallbackFrames: number; families: string[] }
        }
      ).__fontWatch,
  )

async function hover(page: Page, name: RegExp, family: string) {
  await selectors.fontPickerOption(page, name).first().hover()
  await page.waitForFunction(
    (expected) =>
      getComputedStyle(document.documentElement).getPropertyValue('--font-ui').includes(expected),
    family,
  )
}

let report: unknown = null

export const fontPickerHover: Scenario = {
  name: 'font-picker-hover',
  description:
    'Hover through suggested interface fonts: the app never falls back to another face while the hovered one downloads, and the row samples stay in their own fonts.',
  async run(page, { step }) {
    await waitForApp(page)
    await selectors.sidebarSettingsButton(page).click()
    await selectors.settingsSearch(page).fill('font')
    await selectors.settingsFontPicker(page, 'Interface font').click()
    await selectors.fontPickerGroup(page, 'Suggested').waitFor()
    await page.waitForFunction(
      () => document.querySelector('[role="option"] [data-slot="shimmer"]') === null,
    )
    await page.evaluate(() => document.fonts.ready)
    // The popup zooms in; measuring mid-animation reads a scaled row.
    await page.waitForFunction(
      () => document.querySelector('[data-slot="combobox-content"]')?.getAnimations().length === 0,
    )
    const before: SampleWidths = await sampleWidths(page)
    await step('suggested')

    await startFallbackWatch(page)
    await hover(page, /^Geist\b/u, 'geist Fontsource')
    await hover(page, /^IBM Plex Sans\b/u, 'ibm-plex-sans Fontsource')
    await hover(page, /^Manrope\b/u, 'manrope Fontsource')
    await page.evaluate(() => document.fonts.ready)
    await step('hovered-manrope')
    const watch = await readFallbackWatch(page)
    const after: SampleWidths = await sampleWidths(page)

    report = { before, after, watch }
    strictEqual(
      watch.fallbackFrames,
      0,
      `fell back for ${watch.fallbackFrames} frames: ${watch.families.join(', ')}`,
    )
    deepStrictEqual(after, before, 'row samples changed when the app font changed')
  },
  inspect: async () => report,
}
