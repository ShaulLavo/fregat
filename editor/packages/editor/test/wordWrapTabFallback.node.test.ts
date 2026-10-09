import { expect, test } from 'vitest'
import { createDocumentTextSnapshot } from '../src/documentTextSnapshot'
import { createPieceTableSnapshot } from '@singapore-editor/textbuffer'
import { createInlineMap } from '../src/inlineMap'
import { DisplayProjection } from '../src/virtualization/displayProjection'

const text = 'aaaaa\tb\tcdefgh\tij'

test.each([5, 6, 7])(
  'restarts tab stops in %i-column character wrapping without glyph measurements',
  (width) => {
    const snapshot = createPieceTableSnapshot(text)
    for (const inline of [false, true]) {
      const projection = new DisplayProjection({
        textSnapshot: createDocumentTextSnapshot(snapshot),
        foldMap: null,
        inlineMap: inline
          ? createInlineMap(snapshot, [
              { id: 'tail', startIndex: text.length - 1, endIndex: text.length, text: 'j' },
            ])
          : null,
        injectedTextRows: [],
        wrapColumn: width,
        wrapBreak: 'character',
        tabSize: 4,
      })
      let joined = ''
      for (let index = 0; index < projection.rowCount; index += 1) {
        const row = String(projection.getRow(index)!.text)
        let columns = 0
        for (const character of row.trimEnd()) columns += character === '\t' ? 4 - (columns % 4) : 1
        expect(columns, JSON.stringify({ inline, row })).toBeLessThanOrEqual(width)
        joined += row
      }
      expect(joined).toBe(text)
    }
  },
)
