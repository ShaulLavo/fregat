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

test('visits fragmented measured source ranges once when wrapping tabs', async () => {
  const { TextMeasurements, TextSourceIndex } = await import('../src/textMeasurements')
  const { summarizeMeasuredWrap } = await import('../src/virtualization/displayProjectionText')
  const source = new TextSourceIndex('a'.repeat(63) + '\t')
  let reads = 0
  const pieces = 1024
  const ranges = Array.from({ length: pieces }, () => ({
    source,
    start: 0,
    get end() {
      reads += 1
      return 64
    },
  }))
  const measured = new TextMeasurements(ranges)
  reads = 0
  const wrap = summarizeMeasuredWrap(measured, 80, 4)
  expect(wrap.rows).toBe(820)
  expect(reads).toBeLessThanOrEqual(pieces * 4)
})
