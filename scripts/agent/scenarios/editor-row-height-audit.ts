import type { Page } from 'playwright'

import type { Scenario } from './index'
import { chords, openFileByName, selectors } from '../selectors'

const STACKED_ROWS_STYLE_ID = 'agent-stacked-rows'

/** Row geometry as the audit reads it: the pitch rows were placed at and the height CSS painted. */
async function rowGeometry(page: Page) {
  return selectors.editorRows(page).evaluateAll((rows) => {
    const tops = rows.map((row) => row.getBoundingClientRect().top).sort((a, b) => a - b)
    const gaps = tops
      .slice(1)
      .map((top, index) => top - tops[index]!)
      .filter((gap) => gap > 0)
    return {
      mounted: rows.length,
      rowHeight: rows[0]?.getBoundingClientRect().height ?? null,
      pitch: gaps.length > 0 ? Math.min(...gaps) : 0,
    }
  })
}

export const editorRowHeightAudit: Scenario = {
  name: 'editor-row-height-audit',
  description:
    'Open a file with healthy rows, then force zero-height rows and open a second file; the first must log nothing and the second must log editor.layout.row_height_mismatch.',
  async run(page, { file, step }) {
    await openFileByName(page, file)
    await page.waitForTimeout(500)
    await step('healthy')

    await page.evaluate((id) => {
      const style = document.createElement('style')
      style.id = id
      style.textContent = '.editor-virtualized { --editor-row-height: 0px !important; }'
      document.head.append(style)
    }, STACKED_ROWS_STYLE_ID)
    // Zero-height rows also hide the editor input, so wait for the tab rather than the textbox.
    await page.keyboard.press(chords.commandPalette)
    const input = selectors.paletteInput(page)
    await input.waitFor({ timeout: 5_000 })
    await input.fill('README.md')
    await page.waitForTimeout(400)
    await page.keyboard.press('Enter')
    await selectors
      .editorTabNamed(page, /README\.md/)
      .first()
      .waitFor({ timeout: 15_000 })
    await page.waitForTimeout(1_000)
    await step('stacked')

    await page.evaluate((id) => document.getElementById(id)?.remove(), STACKED_ROWS_STYLE_ID)
    await step('restored')
  },
  async inspect(page) {
    return rowGeometry(page)
  },
}
