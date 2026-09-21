import type { Page } from 'playwright'
import { openFileByName, selectors, waitForApp } from '../selectors'
import type { Scenario } from './index'

/**
 * Every step writes a JSON beside its screenshot: the distinct stacks of painted
 * backgrounds under a grid of points, with the alpha the stack composites to. A
 * surface painted twice shows up as two layers, which a screenshot cannot say.
 */
export const surfaceAudit: Scenario = {
  name: 'surface-audit',
  description:
    'Grid-sample both modes with an editor, settings and a terminal open, and list every stack of painted surfaces.',
  async run(page, { file, step }) {
    await forceWallpaperOn(page)
    await openFileByName(page, file)
    await page.waitForTimeout(600)
    await step('workbench-editor')
    await page.keyboard.press('Control+,')
    await selectors.settingsSearch(page).waitFor({ timeout: 15_000 })
    await step('workbench-settings')

    await selectors.workspaceMode(page, 'Chat').click()
    const editorTool = selectors.chatToolTab(page, 'Editor')
    if ((await editorTool.getAttribute('aria-pressed')) !== 'true') await editorTool.click()
    await page.waitForTimeout(800)
    await step('chat-editor')
    await selectors.chatToolTab(page, 'Terminal').click()
    await page.waitForTimeout(1_200)
    await step('chat-terminal')
    await selectors.workspaceMode(page, 'Workbench').click()
  },
  inspect: (page) => page.evaluate(auditSurfaces),
}

/** This browser only: a surface audit over no wallpaper proves nothing, and the user's setting stays theirs. */
async function forceWallpaperOn(page: Page) {
  await page.route(/\/settings$/, async (route) => {
    const response = await route.fetch()
    const body = (await response.text()).replaceAll('"enabled":false', '"enabled":true')
    await route.fulfill({ response, body })
  })
  await page.reload()
  await waitForApp(page)
}

function auditSurfaces() {
  const COLUMNS = 32
  const ROWS = 18
  const alphaOf = (color: string) => {
    const parts = color.match(/[\d.]+%?/g) ?? []
    if (parts.length < 4) return 1
    const raw = parts[3] ?? '1'
    return raw.endsWith('%') ? Number.parseFloat(raw) / 100 : Number.parseFloat(raw)
  }
  const describe = (element: Element) => {
    const surface = Array.from(element.classList).filter((name) => /^(bg-|backdrop-)/.test(name))
    const slot = element.getAttribute('data-slot')
    return [
      element.tagName.toLowerCase(),
      slot ? `[${slot}]` : '',
      ...surface.map((name) => `.${name}`),
    ].join('')
  }
  const stacks = new Map<
    string,
    { alpha: number; count: number; layers: string[]; point: string }
  >()
  for (let row = 0; row < ROWS; row += 1) {
    for (let column = 0; column < COLUMNS; column += 1) {
      const x = Math.round(((column + 0.5) / COLUMNS) * innerWidth)
      const y = Math.round(((row + 0.5) / ROWS) * innerHeight)
      const layers: string[] = []
      let through = 1
      for (const element of document.elementsFromPoint(x, y)) {
        // The wallpaper's parent is the floor under it; nothing from there down is a pane surface.
        if (element.querySelector(':scope > [data-workbench-wallpaper]')) break
        const style = getComputedStyle(element)
        const alpha = alphaOf(style.backgroundColor)
        if (alpha === 0) continue
        const blur = style.backdropFilter === 'none' ? '' : ' +blur'
        layers.push(`${describe(element)} ${Math.round(alpha * 100)}%${blur}`)
        through *= 1 - alpha
      }
      const key = layers.join(' > ')
      const entry = stacks.get(key)
      if (entry) entry.count += 1
      else
        stacks.set(key, {
          alpha: Math.round((1 - through) * 1000) / 10,
          count: 1,
          layers,
          point: `${x},${y}`,
        })
    }
  }
  return Array.from(stacks.values()).sort((left, right) => right.count - left.count)
}
