import { strictEqual } from 'node:assert/strict'
import type { Page } from 'playwright'

import type { Scenario } from './index'
import { preserveAppearance, writeUserSetting } from '../preserve-settings'
import { EDITOR_ROW_LAYERS, focusEditor, openFileByName } from '../selectors'

const CARET_COLUMN = 6
const LARGE = { fontSize: 20, lineHeight: 34 } as const

type Geometry = {
  readonly fontSize: string
  readonly fontSizeVariable: string
  readonly rowPitch: number
  readonly caretLeft: number
  readonly glyphLeft: number
}

/**
 * Page-side: the focused editor's font, the pitch rows were placed at, and where the caret sits
 * against the glyph it stands before. Caret and rows are positioned from the editor's own metrics
 * and the glyph by the browser, so they only agree when the editor measured the face it paints.
 */
function readGeometry([layers, column]: readonly [string, number]): Geometry | null {
  const scroll = document.activeElement?.closest<HTMLElement>('.editor-virtualized')
  if (!scroll) return null
  const rows = Array.from(
    scroll.querySelectorAll<HTMLElement>('.editor-virtualized-row:not([hidden])'),
  )
  const tops = rows.map((row) => row.getBoundingClientRect().top).sort((a, b) => a - b)
  const gaps = tops.slice(1).map((top, index) => top - tops[index]!)
  const first = scroll.querySelector<HTMLElement>('[data-editor-virtual-row="0"]')
  const caret = scroll.querySelector<HTMLElement>('.editor-virtualized-caret')
  if (!first || !caret) return null

  const walker = document.createTreeWalker(first, NodeFilter.SHOW_TEXT)
  let remaining = column
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.parentElement?.closest(layers)) continue
    const text = node as Text
    if (remaining >= text.data.length) {
      remaining -= text.data.length
      continue
    }
    const range = document.createRange()
    range.setStart(text, remaining)
    range.setEnd(text, remaining + 1)
    const style = getComputedStyle(scroll)
    return {
      fontSize: style.fontSize,
      fontSizeVariable: style.getPropertyValue('--editor-font-size').trim(),
      rowPitch: Math.min(...gaps.filter((gap) => gap > 0)),
      caretLeft: caret.getBoundingClientRect().left,
      glyphLeft: range.getBoundingClientRect().left,
    }
  }
  return null
}

async function geometryAt(page: Page, fontSize: string): Promise<Geometry> {
  await page.waitForFunction(
    ([expected]) => {
      const scroll = document.activeElement?.closest('.editor-virtualized')
      return scroll ? getComputedStyle(scroll).fontSize === expected : false
    },
    [fontSize] as const,
    { timeout: 10_000 },
  )
  // The caret repaints on the frame after the layout notification.
  await page.waitForTimeout(200)
  const geometry = await page.evaluate(readGeometry, [EDITOR_ROW_LAYERS, CARET_COLUMN] as const)
  if (!geometry) throw new Error(`No focused editor row with ${CARET_COLUMN + 1} characters`)
  return geometry
}

function assertAgrees(label: string, geometry: Geometry, lineHeight: number) {
  strictEqual(geometry.rowPitch, lineHeight, `${label}: rows stack at the line height`)
  strictEqual(
    Math.abs(geometry.caretLeft - geometry.glyphLeft) <= 1,
    true,
    `${label}: caret at column ${CARET_COLUMN} stands before its glyph (caret ${geometry.caretLeft}, glyph ${geometry.glyphLeft})`,
  )
  // Popups opened over the editor copy this variable to take the editor's face.
  strictEqual(geometry.fontSizeVariable, geometry.fontSize, `${label}: popups read the size`)
}

let report: unknown = null

export const editorTypography: Scenario = {
  name: 'editor-typography',
  description:
    'Change editor.fontSize and editor.lineHeight live, then restore them; rows must stack at the line height and the caret must stand before the glyph it precedes at every step.',
  async run(page, { file, step }) {
    const restore = await preserveAppearance(page, ['editor.fontSize', 'editor.lineHeight'])
    try {
      await openFileByName(page, file)
      await focusEditor(page)
      await page.keyboard.press('Control+Home')
      for (let index = 0; index < CARET_COLUMN; index++) await page.keyboard.press('ArrowRight')
      const initial = await page.evaluate(readGeometry, [EDITOR_ROW_LAYERS, CARET_COLUMN] as const)
      if (!initial) throw new Error('No focused editor to measure')
      await step('initial')

      await writeUserSetting(page, 'editor.fontSize', LARGE.fontSize)
      await writeUserSetting(page, 'editor.lineHeight', LARGE.lineHeight)
      const large = await geometryAt(page, `${LARGE.fontSize}px`)
      await step('large')

      await restore()
      const restored = await geometryAt(page, initial.fontSize)
      await step('restored')

      report = { initial, large, restored }
      assertAgrees('large', large, LARGE.lineHeight)
      assertAgrees('restored', restored, initial.rowPitch)
    } finally {
      await restore()
    }
  },
  inspect: async () => report,
}
