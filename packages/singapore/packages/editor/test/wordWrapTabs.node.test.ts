import { expect, test } from 'vitest'
import { createDocumentTextSnapshot } from '../src/documentTextSnapshot'
import { createPieceTableSnapshot } from '@singapore-editor/textbuffer'
import { createInlineMap } from '../src/inlineMap'
import { DisplayProjection } from '../src/virtualization/displayProjection'
import {
  appendWordWrapText,
  createWordWrapLine,
  finishWordWrapLine,
} from '../src/virtualization/wordWrap'

function columns(text: string): number {
  let width = 0
  for (const character of text.trimEnd()) width += character === '\t' ? 4 - (width % 4) : 1
  return width
}

const text = '\t a\ta aa'

test.each([false, true])(
  'resets tab stops on each display row with word boundaries %s',
  (words) => {
    const rules = { width: 4, words, tabSize: 4, advance: null }
    const line = createWordWrapLine()
    appendWordWrapText(line, text, 0, text.length, rules)
    finishWordWrapLine(line, rules)
    let start = 0
    for (const end of line.ends.concat([text.length])) {
      const row = text.slice(start, end)
      expect(columns(row), JSON.stringify({ text, start, end, row })).toBeLessThanOrEqual(4)
      start = end
    }
  },
)

test.each(['character', 'word'] as const)('fits tabs in %s projection rows', (wrapBreak) => {
  const snapshot = createPieceTableSnapshot(text)
  for (const inline of [false, true]) {
    for (const measured of [false, true]) {
      const projection = new DisplayProjection({
        textSnapshot: createDocumentTextSnapshot(snapshot),
        foldMap: null,
        inlineMap: inline
          ? createInlineMap(snapshot, [
              { id: 'tail', startIndex: text.length - 1, endIndex: text.length, text: 'a' },
            ])
          : null,
        injectedTextRows: [],
        wrapColumn: 4,
        wrapBreak,
        wrapAdvance: measured ? { width: 4, advance: () => 1 } : null,
        tabSize: 4,
      })
      let joined = ''
      for (let index = 0; index < projection.rowCount; index += 1) {
        const row = String(projection.getRow(index)!.text)
        expect(columns(row), JSON.stringify({ inline, measured, row })).toBeLessThanOrEqual(4)
        joined += row
      }
      expect(joined).toBe(text)
    }
  }
})
