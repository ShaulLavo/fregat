import { expect, test, vi } from 'vitest'
import {
  appendWordWrapText,
  createWordWrapLine,
  finishWordWrapLine,
  type LineBreakRules,
} from '../src/virtualization/wordWrap'

const rules: LineBreakRules = { width: 4, tabSize: 4, words: true, advance: null }

function ends(text: string, breaks: readonly number[], measured = rules): number[] {
  const line = createWordWrapLine()
  let start = 0
  for (const end of breaks.concat([text.length])) {
    appendWordWrapText(line, text.slice(start, end), 0, end - start, measured)
    start = end
  }
  finishWordWrapLine(line, measured)
  return line.ends.concat([text.length])
}

test('keeps a surrogate pair whole at the wrap boundary', () => {
  expect(ends('aaa😀bb', [])).toEqual([3, 7])
})

test('keeps a combining sequence on the same display row', () => {
  expect(ends('aaa ébc', [], { ...rules, width: 2 })).toEqual([2, 4, 7, 8])
})

test('measured emoji wrap is independent of storage chunk boundaries', () => {
  const text = 'aaa😀bb'
  const measured = { ...rules, advance: (point: number) => (point > 0xffff ? 2 : 1) }
  expect(ends(text, [4], measured)).toEqual(ends(text, [], measured))
})

test.each(['aaa😀bb', 'aaaébb', 'aa👩‍💻bbb', 'a🇸🇬bbb', 'abc def', '中文字符测试'])(
  'preserves the row ends of %s across every chunk boundary',
  (text) => {
    const expected = ends(text, [])
    for (let boundary = 1; boundary < text.length; boundary += 1) {
      expect(ends(text, [boundary])).toEqual(expected)
    }
    expect(
      ends(
        text,
        Array.from({ length: text.length - 1 }, (_, index) => index + 1),
      ),
    ).toEqual(expected)
  },
)

test('never splits a grapheme even when a joined emoji is wider than the row', () => {
  const text = 'ab👩‍💻cdéf'
  const boundaries = new Set(
    [0].concat(
      Array.from(
        new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text),
        (part) => part.index,
      ),
    ),
  )
  boundaries.add(text.length)
  for (const end of ends(text, [])) expect(boundaries.has(end)).toBe(true)
})

test.each([4095, 16383])(
  'keeps projection row ends whole around storage offset %s',
  async (prefixLength) => {
    const { DisplayProjection } = await import('../src/virtualization/displayProjection')
    const { createDocumentTextSnapshot } = await import('../src/documentTextSnapshot')
    const { createPieceTableSnapshot } = await import('@singapore-editor/textbuffer')
    const { createInlineMap } = await import('../src/inlineMap')
    const text = `${'a'.repeat(prefixLength)}😀bbbb`
    const snapshot = createPieceTableSnapshot(text)
    for (const inline of [false, true]) {
      const projection = new DisplayProjection({
        textSnapshot: createDocumentTextSnapshot(snapshot),
        foldMap: null,
        inlineMap: inline
          ? createInlineMap(snapshot, [
              { id: 'tail', startIndex: text.length - 1, endIndex: text.length, text: 'b' },
            ])
          : null,
        injectedTextRows: [],
        wrapColumn: 4,
        wrapBreak: 'word',
        wrapAdvance: { width: 4, advance: (point) => (point > 0xffff ? 2 : 1) },
        tabSize: 4,
      })
      let joined = ''
      for (let index = 0; index < projection.rowCount; index += 1) {
        const row = String(projection.getRow(index)!.text)
        expect(row).not.toMatch(/^[\udc00-\udfff]|[\ud800-\udbff]$/)
        joined += row
      }
      expect(joined).toBe(text)
    }
  },
)

test('segments each mixed-Unicode storage chunk once', () => {
  const spy = vi.spyOn(Intl.Segmenter.prototype, 'segment')
  try {
    const text = 'word 中文 é 👩‍💻 אבג '.repeat(50)
    expect(ends(text, []).at(-1)).toBe(text.length)
    expect(spy.mock.calls.length).toBeLessThanOrEqual(2)
  } finally {
    spy.mockRestore()
  }
})
