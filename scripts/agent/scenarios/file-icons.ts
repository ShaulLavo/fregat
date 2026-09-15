import type { Scenario } from './index'
import { chords, fileIconSelector, openFileByName, selectors } from '../selectors'

export const fileIcons: Scenario = {
  name: 'file-icons',
  description: 'Open tabs, breadcrumbs, palette and search with standalone icon requests blocked.',
  inspect: async (page) => ({
    // A string: this package types without the DOM, and the callback runs in the page.
    icons: await page.evaluate(`((selector) =>
      Array.from(document.querySelectorAll(selector)).map((element) => ({
        name: element.getAttribute('data-file-icon'),
        tag: element.tagName,
        mask: getComputedStyle(element).maskImage,
        color: getComputedStyle(element).color,
        paths: element.querySelectorAll('path').length,
        width: element.getBoundingClientRect().width,
        height: element.getBoundingClientRect().height,
      })))(${JSON.stringify(fileIconSelector)})`),
  }),
  async run(page, { step }) {
    await page.route('**/vscode-icons/*.svg', (route) => route.abort())
    await openFileByName(page, 'package.json')
    await openFileByName(page, 'README.md')
    await step('tabs-and-breadcrumbs')
    await page.reload()
    await selectors.editorInput(page).first().waitFor({ timeout: 15_000 })
    await step('restored-tabs')
    await page.keyboard.press(chords.commandPalette)
    await selectors.paletteInput(page).fill('package.json')
    await page.waitForTimeout(500)
    await step('palette')
    await page.keyboard.press('Escape')
    await selectors.sidebarTab(page, 'Search').click()
    await selectors.workspaceSearch(page).fill('VSCODE_ICON')
    await page.waitForTimeout(1500)
    await step('search')
  },
}
