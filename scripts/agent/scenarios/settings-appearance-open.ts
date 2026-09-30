import { ok } from 'node:assert/strict'
import type { Page } from 'playwright'
import type { Scenario } from './index'
import { chords, pressShortcut, selectors } from '../selectors'

const DARK = 'editor.codeTheme.dark'
const LIGHT = 'editor.codeTheme.light'

function onScreen(element: Element) {
  const rect = element.getBoundingClientRect()
  let scroller = element.parentElement
  while (scroller && !/auto|scroll/.test(getComputedStyle(scroller).overflowY))
    scroller = scroller.parentElement
  const box = scroller?.getBoundingClientRect() ?? { top: 0, bottom: window.innerHeight }
  return rect.top < box.bottom && rect.bottom > box.top
}

async function offScreenWithoutPreview(page: Page, id: string) {
  ok(!(await selectors.settingsRow(page, id).evaluate(onScreen)), `${id} starts off screen`)
  ok(
    (await selectors.settingsCodeThemePreview(page, id).count()) === 0,
    `${id} highlights no preview until its row is on screen`,
  )
}

export const settingsAppearanceOpen: Scenario = {
  name: 'settings-appearance-open',
  description:
    'Open Settings with its keyboard shortcut: the code theme rows sit below the fold and highlight nothing. Scrolling to the dark row paints its preview while the light row below stays unhighlighted; scrolling to the light row paints its preview. Trace it to see what the previews cost the main thread.',
  capture: { width: 1440, height: 1000 },
  async run(page, { step }) {
    await pressShortcut(page, chords.settings)
    await selectors.settingsRow(page, DARK).waitFor()
    // Long enough for a preview that started on mount to paint.
    await page.waitForTimeout(1_000)
    await offScreenWithoutPreview(page, DARK)
    await offScreenWithoutPreview(page, LIGHT)
    await step('settings-open')

    await selectors.settingsRow(page, DARK).evaluate((element) => {
      element.scrollIntoView({ block: 'end' })
      let scroller = element.parentElement
      while (scroller && !/auto|scroll/.test(getComputedStyle(scroller).overflowY))
        scroller = scroller.parentElement
      // Show half this row, keeping the following row fully below every viewport.
      scroller?.scrollBy(0, -element.getBoundingClientRect().height / 2)
    })
    await selectors.settingsCodeThemePreview(page, DARK).waitFor()
    await offScreenWithoutPreview(page, LIGHT)
    await step('appearance-shown')

    await selectors
      .settingsRow(page, LIGHT)
      .evaluate((element) => element.scrollIntoView({ block: 'center' }))
    await selectors.settingsCodeThemePreview(page, LIGHT).waitFor()
    await step('light-row-shown')
  },
}
