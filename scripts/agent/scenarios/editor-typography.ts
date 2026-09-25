import { strictEqual } from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Page } from 'playwright'

import type { Scenario } from './index'
import { createGitFixture, openFixtureWorkspace, releaseFixture } from '../fixture-workspace'
import { preserveAppearance, writeUserSetting } from '../preserve-settings'
import { EDITOR_ROW_LAYERS, focusEditor, openFileFromTree } from '../selectors'

const FILE = 'typography.ts'
// Row 0 carries the caret check; row 1 starts with a tab, so its first glyph sits one tab in.
const TEXT = 'const alpha = 1\n\tvalue\n'
const CARET_COLUMN = 6
const LARGE = { fontSize: 20, lineHeight: 34, tabSize: 8 } as const

type Geometry = {
  readonly fontSize: string
  readonly fontSizeVariable: string
  readonly rowPitch: number
  readonly caretLeft: number
  readonly glyphLeft: number
  /** How many character cells the tab on row 1 spans, from where the glyph after it lands. */
  readonly tabColumns: number
}

/**
 * Page-side: the focused editor's font, the pitch rows were placed at, where the caret sits against
 * the glyph it stands before, and how wide the browser drew the tab. Caret and rows are positioned
 * from the editor's own metrics and the glyphs by the browser, so they agree only when the editor
 * measured the face and laid tabs out at the width it paints.
 */
function readGeometry([layers, column]: readonly [string, number]): Geometry | null {
  const scroll = document.activeElement?.closest<HTMLElement>('.editor-virtualized')
  if (!scroll) return null
  const rows = Array.from(
    scroll.querySelectorAll<HTMLElement>('.editor-virtualized-row:not([hidden])'),
  )
  const tops = rows.map((row) => row.getBoundingClientRect().top).sort((a, b) => a - b)
  const gaps = tops.slice(1).map((top, index) => top - tops[index]!)
  const caret = scroll.querySelector<HTMLElement>('.editor-virtualized-caret')
  const glyphAt = (row: number, local: number) => {
    const element = scroll.querySelector<HTMLElement>(`[data-editor-virtual-row="${row}"]`)
    if (!element) return null
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
    let remaining = local
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
      return range.getBoundingClientRect().left
    }
    return null
  }
  const rowStart = glyphAt(0, 0)
  const glyph = glyphAt(0, column)
  const afterTab = glyphAt(1, 1)
  if (!caret || rowStart === null || glyph === null || afterTab === null) return null

  const cell = (glyph - rowStart) / column
  const style = getComputedStyle(scroll)
  return {
    fontSize: style.fontSize,
    fontSizeVariable: style.getPropertyValue('--editor-font-size').trim(),
    rowPitch: Math.min(...gaps.filter((gap) => gap > 0)),
    caretLeft: caret.getBoundingClientRect().left,
    glyphLeft: glyph,
    tabColumns: Math.round((afterTab - rowStart) / cell),
  }
}

async function geometryWhen(page: Page, fontSize: string, tabSize: number): Promise<Geometry> {
  await page.waitForFunction(
    ([expectedSize, expectedTab]) => {
      const scroll = document.activeElement?.closest<HTMLElement>('.editor-virtualized')
      if (!scroll) return false
      return (
        getComputedStyle(scroll).fontSize === expectedSize &&
        scroll.style.getPropertyValue('--editor-tab-size') === String(expectedTab)
      )
    },
    [fontSize, tabSize] as const,
    { timeout: 10_000 },
  )
  // The caret repaints on the frame after the layout notification.
  await page.waitForTimeout(200)
  const geometry = await page.evaluate(readGeometry, [EDITOR_ROW_LAYERS, CARET_COLUMN] as const)
  if (!geometry) throw new Error(`No focused editor showing ${FILE}`)
  return geometry
}

function assertAgrees(label: string, geometry: Geometry, lineHeight: number, tabSize: number) {
  strictEqual(geometry.rowPitch, lineHeight, `${label}: rows stack at the line height`)
  strictEqual(
    Math.abs(geometry.caretLeft - geometry.glyphLeft) <= 1,
    true,
    `${label}: caret at column ${CARET_COLUMN} stands before its glyph (caret ${geometry.caretLeft}, glyph ${geometry.glyphLeft})`,
  )
  strictEqual(geometry.tabColumns, tabSize, `${label}: a tab spans the tab size`)
  // Popups opened over the editor copy this variable to take the editor's face.
  strictEqual(geometry.fontSizeVariable, geometry.fontSize, `${label}: popups read the size`)
}

let report: unknown = null

export const editorTypography: Scenario = {
  name: 'editor-typography',
  description:
    'Change editor.fontSize, editor.lineHeight and editor.tabSize live on an open fixture file, then restore them; rows must stack at the line height, the caret must stand before its glyph and a tab must span the tab size at every step.',
  async run(page, { step }) {
    const keys = ['editor.fontSize', 'editor.lineHeight', 'editor.tabSize']
    const restore = await preserveAppearance(page, keys)
    const fixture = await createGitFixture('editor-typography')
    try {
      await writeFile(join(fixture, FILE), TEXT)
      await openFixtureWorkspace(page, fixture)
      await openFileFromTree(page, FILE)
      await focusEditor(page)
      await page.keyboard.press('Control+Home')
      for (let index = 0; index < CARET_COLUMN; index++) await page.keyboard.press('ArrowRight')
      const initialStyle = await page.evaluate(() => {
        const scroll = document.activeElement?.closest<HTMLElement>('.editor-virtualized')
        return {
          fontSize: scroll ? getComputedStyle(scroll).fontSize : '',
          tabSize: Number(scroll?.style.getPropertyValue('--editor-tab-size')),
        }
      })
      const initial = await geometryWhen(page, initialStyle.fontSize, initialStyle.tabSize)
      await step('initial')

      await writeUserSetting(page, 'editor.fontSize', LARGE.fontSize)
      await writeUserSetting(page, 'editor.lineHeight', LARGE.lineHeight)
      await writeUserSetting(page, 'editor.tabSize', LARGE.tabSize)
      const large = await geometryWhen(page, `${LARGE.fontSize}px`, LARGE.tabSize)
      await step('large')

      await restore()
      const restored = await geometryWhen(page, initialStyle.fontSize, initialStyle.tabSize)
      await step('restored')

      report = { initial, large, restored }
      assertAgrees('initial', initial, initial.rowPitch, initialStyle.tabSize)
      assertAgrees('large', large, LARGE.lineHeight, LARGE.tabSize)
      assertAgrees('restored', restored, initial.rowPitch, initialStyle.tabSize)
    } finally {
      try {
        await restore()
      } finally {
        await releaseFixture(fixture)
      }
    }
  },
  inspect: async () => report,
}
