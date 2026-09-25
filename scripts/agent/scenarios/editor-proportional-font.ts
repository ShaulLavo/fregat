import type { Page } from 'playwright'
import type { Scenario } from './index'
import {
  EDITOR_ROW_LAYERS,
  focusEditor,
  focusedEditorTextBeforeCaret,
  openFileByName,
  waitForApp,
} from '../selectors'

// An important rule outlives the inline `--editor-font-family` the editor writes from its option,
// so the face changes behind the editor's back and it has to notice by itself.
const OVERRIDE_ID = 'agent-proportional-font'
const PROPORTIONAL = "'Liberation Sans', 'Noto Sans', sans-serif"

type Miss = { readonly column: number; readonly caretPrefix: string }

/**
 * Clicks the left edge of every third character on the first long mounted row, read from the DOM,
 * and reads where the caret landed from the hidden input: the text before its selection must end
 * with the row's text up to that column.
 */
export async function clickColumns(page: Page) {
  const points = await page.evaluate((layers) => {
    for (const row of document.querySelectorAll<HTMLElement>(
      '.editor-virtualized-row:not([hidden])',
    )) {
      const walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT)
      const nodes: Text[] = []
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (!node.parentElement?.closest(layers)) nodes.push(node as Text)
      }
      const text = nodes.map((node) => node.data).join('')
      if (text.trim().length < 24 || text.includes('\t')) continue
      const range = document.createRange()
      const rowRect = row.getBoundingClientRect()
      const columns: { column: number; x: number; y: number }[] = []
      let base = 0
      for (const node of nodes) {
        for (let local = 0; local < node.data.length; local++) {
          const column = base + local
          if (column % 3 !== 1 || column > 40) continue
          range.setStart(node, local)
          range.setEnd(node, local + 1)
          const rect = range.getBoundingClientRect()
          columns.push({ column, x: rect.left + 1, y: rowRect.top + rowRect.height / 2 })
        }
        base += node.data.length
      }
      return { text, columns }
    }
    return null
  }, EDITOR_ROW_LAYERS)
  if (!points) throw new Error('No mounted row with 24 or more characters and no tab')

  const misses: Miss[] = []
  for (const { column, x, y } of points.columns) {
    await page.mouse.click(x, y)
    const caretPrefix = await page.evaluate(focusedEditorTextBeforeCaret)
    if (!caretPrefix.endsWith(points.text.slice(0, column)))
      misses.push({ column, caretPrefix: caretPrefix.slice(-column - 4) })
  }
  return { row: points.text, checked: points.columns.length, misses }
}

let report: unknown = null

export const editorProportionalFont: Scenario = {
  name: 'editor-proportional-font',
  description:
    'Set a proportional editor font, reopen, then switch back live; every clicked column must land the caret on the character under the pointer.',
  async run(page, { file, step }) {
    await page.addInitScript(
      ({ id, font }) => {
        document.addEventListener('DOMContentLoaded', () => {
          const style = document.createElement('style')
          style.id = id
          style.textContent = `.editor-virtualized { --editor-font-family: ${font} !important; }`
          document.head.append(style)
        })
      },
      { id: OVERRIDE_ID, font: PROPORTIONAL },
    )
    await page.reload()
    await waitForApp(page)
    await page.waitForTimeout(1500)
    await openFileByName(page, file)
    await focusEditor(page)
    await page.keyboard.press('Control+Home')
    await page.waitForTimeout(1000)
    await step('proportional-open')
    const proportional = await clickColumns(page)
    await step('proportional-clicked')

    // Back to the configured font without a reload: the open editor has to notice by itself.
    await page.evaluate((id) => document.getElementById(id)?.remove(), OVERRIDE_ID)
    await page.waitForTimeout(500)
    const liveSwitch = await clickColumns(page)
    await step('live-switch-clicked')

    report = { proportional, liveSwitch }
    if (proportional.misses.length)
      throw new Error(
        `${proportional.misses.length} of ${proportional.checked} clicks missed with a proportional font`,
      )
    if (liveSwitch.misses.length)
      throw new Error(
        `${liveSwitch.misses.length} of ${liveSwitch.checked} clicks missed after a live font switch`,
      )
  },
  inspect: async () => report,
}
