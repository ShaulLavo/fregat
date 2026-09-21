import { ok } from 'node:assert/strict'
import type { Page } from 'playwright'
import { selectors } from '../selectors'
import type { Scenario } from './index'

/**
 * The two seam looks, driven through the real setting. Resize handles are
 * transparent, so the toggle decides whether each panel paints its own surface
 * (wallpaper shows in the gap) or the region around them paints once (the gap
 * carries the surface). Restores the setting it found.
 */
export const panelSeams: Scenario = {
  name: 'panel-seams',
  description: 'Capture both panel seam looks in each mode and restore the setting.',
  async run(page, { step }) {
    const before = await seamPaints(page)
    ok(before.panels > 0, 'With the toggle off each panel paints its own surface')
    ok(before.region === 0, 'With the toggle off the region around the panels paints nothing')
    await step('workbench-wallpaper-seams')
    await selectors.workspaceMode(page, 'Chat').click()
    await page.waitForTimeout(800)
    await step('chat-wallpaper-seams')

    await selectors.workspaceMode(page, 'Workbench').click()
    await page.waitForTimeout(600)
    await setContinuousSeams(page, true)
    const after = await seamPaints(page)
    ok(after.region > 0, 'With the toggle on the region paints the surface')
    ok(after.panels === 0, 'With the toggle on no panel paints its own')
    await step('workbench-continuous-seams')
    await selectors.workspaceMode(page, 'Chat').click()
    await page.waitForTimeout(800)
    await step('chat-continuous-seams')

    await selectors.workspaceMode(page, 'Workbench').click()
    await page.waitForTimeout(600)
    await setContinuousSeams(page, false)
  },
}

/** Settings is an editor tab inside a workspace, not the first-run dialog. */
async function setContinuousSeams(page: Page, next: boolean) {
  await page.keyboard.press('Control+,')
  await selectors.settingsSearch(page).waitFor({ timeout: 15_000 })
  await selectors.settingsSearch(page).fill('continuous panel background')
  const toggle = selectors.settingsContinuousSeams(page)
  await toggle.waitFor({ timeout: 15_000 })
  if ((await toggle.getAttribute('aria-checked')) !== String(next)) await toggle.click()
  await page.waitForTimeout(600)
}

/** How many painted surfaces sit on panels versus on the region around them. */
function seamPaints(page: Page) {
  return page.evaluate(() => {
    const painted = (node: Element | null) => {
      if (!node) return false
      const color = getComputedStyle(node).backgroundColor
      return color !== 'rgba(0, 0, 0, 0)' && color !== 'transparent'
    }
    const panels = Array.from(document.querySelectorAll('[data-slot="resizable-panel"]'))
    const sidebar = document.querySelector('[data-workbench] aside, [data-chat-mode] aside')
    const group = document.querySelector('[data-slot="resizable-panel-group"]')
    return {
      panels: [...panels, sidebar].filter(painted).length,
      region: [group?.parentElement ?? null, group].filter(painted).length,
    }
  })
}
