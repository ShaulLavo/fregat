import type { Scenario } from './index'
import { focusEditor, openFileByName, selectors } from '../selectors'
import { createScriptError } from '../../structured-errors'

const MARKER = 'demo-verification-saved'

export const demoWorkspace: Scenario = {
  name: 'demo-workspace',
  surface: 'demo',
  description:
    'Edit and save a simulated file in the real app, search it, and read it from the terminal.',
  inspect: (page) => page.evaluate('window.__fregatDemo ?? null'),
  async run(page, { step }) {
    await selectors.editorInput(page).first().waitFor({ timeout: 30_000 })
    await focusEditor(page)
    await step('workspace')
    await openFileByName(page, 'garden.ts')
    await focusEditor(page)
    await page.keyboard.press('Control+End')
    await page.keyboard.type(`\n// ${MARKER}\n`, { delay: 15 })
    await page.keyboard.press('Control+s')
    await page.waitForFunction(
      `async () => {
      const demo = window.__fregatDemo;
      if (!demo) return false;
      const response = await fetch(demo.apiOrigin + '/fs/read?path=' + encodeURIComponent('/garden/src/garden.ts'));
      return response.ok() && (await response.text()).includes(${JSON.stringify(MARKER)});
    }`,
      undefined,
      { timeout: 15_000 },
    )
    await step('saved')
    await selectors.sidebarTab(page, 'Search').click()
    await selectors.workspaceSearch(page).fill(MARKER)
    await page.waitForTimeout(1_500)
    await step('searched')
    await selectors
      .terminalSurface(page)
      .first()
      .click({ position: { x: 110, y: 60 } })
    await page.keyboard.type('cat src/garden.ts', { delay: 25 })
    await page.keyboard.press('Enter')
    await page.waitForTimeout(500)
    await step('terminal')
    const diagnostics = await page.evaluate('window.__fregatDemo ?? null')
    if (!diagnostics) throw createScriptError('The demo did not expose its request evidence.')
  },
}
