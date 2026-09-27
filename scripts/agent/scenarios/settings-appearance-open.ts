import { ok } from 'node:assert/strict'
import type { Page } from 'playwright'
import type { Scenario } from './index'
import { selectors } from '../selectors'

const DARK = 'editor.codeTheme.dark'
const LIGHT = 'editor.codeTheme.light'

// Inside the settings scroller's visible box, which ends above the bottom panel.
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
    'Open Settings with Ctrl+,: the code theme rows sit below the fold and highlight nothing. Scrolling to the top of Appearance shows the dark row, whose preview paints while the light row below stays unhighlighted; scrolling to the light row paints its preview. Trace it to see what the previews cost the main thread.',
  capture: { width: 1440, height: 1000 },
  async run(page, { step }) {
    await page.keyboard.press('Control+,')
    await selectors.settingsRow(page, DARK).waitFor()
    // Long enough for a preview that started on mount to paint.
    await page.waitForTimeout(1_000)
    await offScreenWithoutPreview(page, DARK)
    await offScreenWithoutPreview(page, LIGHT)
    await step('settings-open')

    await selectors
      .settingsRow(page, 'workbench.theme')
      .evaluate((element) => element.scrollIntoView({ block: 'start' }))
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
