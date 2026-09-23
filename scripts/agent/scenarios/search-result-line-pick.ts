import { strictEqual } from 'node:assert'
import { mkdtemp, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { Page } from 'playwright'
import type { Scenario } from './index'
import { openFixtureWorkspace, releaseFixture } from '../fixture-workspace'
import { selectedEditorFileTabSelector, selectors } from '../selectors'
import { paintVisualSearch } from './visual-search-drive'
import { createScriptError } from '../../structured-errors'

// Source line 3 does not match, so the third excerpt row is source line 4: rows are not lines.
const fixtureText = [
  "export const one = 'linepick one'",
  "export const two = 'linepick two'",
  'export const pad = 0',
  "export const three = 'linepick three'",
  '',
].join('\n')

/** The search editor asks the editor which row a pointer is on, including beside it. */
export const searchResultLinePick: Scenario = {
  name: 'search-result-line-pick',
  description:
    'Hover and click excerpt lines in the search editor, from the text, the gap, the source-line gutter and the action column, and prove the picked line by opening it.',
  async run(page, { step }) {
    const originalUrl = page.url()
    const fixture = await mkdtemp('/work/tmp/fregat-search-line-pick-')
    const file = path.join(fixture, 'picks.ts')
    try {
      await writeFile(file, fixtureText)
      await openFixtureWorkspace(page, fixture)
      await selectors.sidebarTab(page, 'Search').click()
      await selectors.workspaceSearch(page).fill('linepick')
      await selectors.searchResultTree(page).waitFor({ timeout: 30_000 })
      await selectors.openSearchEditor(page).click()
      await selectors.searchEditorRowWithText(page, 'linepick three').waitFor()
      await paintVisualSearch(page)

      const two = await rowCentre(page, 'linepick two')
      const three = await rowCentre(page, 'linepick three')
      const actions = await boxOf(selectors.searchEditorLineOpen(page, 4).boundingBox())

      await page.mouse.move(two.x, two.y)
      await expectHoveredLine(page, 2)
      await step('hover-text-line-2')

      await page.mouse.move(actions.x + actions.width / 2, three.y)
      await expectHoveredLine(page, 4)
      await step('hover-action-column-line-4')

      await page.mouse.move(two.x, (two.y + three.y) / 2)
      await paintVisualSearch(page)
      strictEqual(await selectors.searchEditorHoveredLineActions(page).count(), 0)
      await step('hover-row-gap-none')

      const host = await boxOf(selectors.searchEditorHosts(page).first().boundingBox())
      await page.mouse.click(host.x - 8, three.y)
      await paintVisualSearch(page)
      await selectors.searchEditor(page).focus()
      await page.keyboard.press('Enter')
      await page.waitForFunction(
        ({ selector, path }) =>
          document.querySelector(selector)?.getAttribute('data-editor-tab-path') === path,
        { selector: selectedEditorFileTabSelector, path: file.slice(1) },
      )
      await selectors
        .editorCursorLineRow(page)
        .filter({ hasText: "export const three = 'linepick three'" })
        .waitFor()
      await step('gutter-pick-opened-at-line-4')
    } finally {
      await page.goto(originalUrl)
      await releaseFixture(fixture)
    }
  },
}

async function rowCentre(page: Page, text: string) {
  const box = await boxOf(selectors.searchEditorRowWithText(page, text).first().boundingBox())
  return { x: box.x + 40, y: box.y + box.height / 2 }
}

async function boxOf(box: Promise<{ x: number; y: number; width: number; height: number } | null>) {
  const resolved = await box
  if (!resolved) throw createScriptError('Expected a laid-out element')
  return resolved
}

async function expectHoveredLine(page: Page, sourceLine: number) {
  const hovered = selectors.searchEditorHoveredLineActions(page)
  await hovered.first().waitFor()
  strictEqual(await hovered.count(), 1)
  strictEqual(
    await hovered
      .getByRole('button', { name: new RegExp(`^Open result at line ${sourceLine}\\b`) })
      .count(),
    1,
  )
}
