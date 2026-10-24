import { describe, expect, test } from 'vitest'
import { createDocumentTextSnapshot } from '../src/documentTextSnapshot'
import { createInlineMap, type InlineReplacementSpec } from '../src/inlineMap'
import { applyBatchToPieceTable, createPieceTableSnapshot } from '@singapore-editor/textbuffer'

import {
  DisplayProjection,
  type DisplayProjectionInput,
} from '../src/virtualization/displayProjection'

function input(
  text: string,
  wrapColumn: number,
  specs: readonly InlineReplacementSpec[] = [],
): DisplayProjectionInput {
  const snapshot = createPieceTableSnapshot(text)
  return {
    textSnapshot: createDocumentTextSnapshot(snapshot),
    foldMap: null,
    inlineMap: specs.length === 0 ? null : createInlineMap(snapshot, specs),
    injectedTextRows: [],
    wrapColumn,
    wrapBreak: 'word',
    tabSize: 4,
  }
}

function rows(projection: DisplayProjection): string[] {
  const texts: string[] = []
  for (let index = 0; index < projection.rowCount; index += 1) {
    texts.push(String(projection.getRow(index)!.text))
  }
  return texts
}

describe('word-boundary wrap', () => {
  test('ends a row at the last word boundary that fits', () => {
    const projection = new DisplayProjection(input('the list settles before the cursor', 12))

    expect(rows(projection)).toEqual(['the list ', 'settles ', 'before the ', 'cursor'])
  })

  test('breaks a word wider than the row at the column that fills it', () => {
    const projection = new DisplayProjection(input('a abcdefghijklmnop b', 8))

    expect(rows(projection)).toEqual(['a ', 'abcdefgh', 'ijklmnop ', 'b'])
  })

  test('lets spaces hang past the edge instead of starting a row', () => {
    const projection = new DisplayProjection(input('abcd        efgh', 6))

    expect(rows(projection)).toEqual(['abcd        ', 'efgh'])
  })

  test('breaks between CJK characters', () => {
    const projection = new DisplayProjection(input('中文字符测试', 4))

    expect(rows(projection)).toEqual(['中文字符', '测试'])
  })

  test('keeps a replacement on one row', () => {
    const text = 'see the @src/components/file.ts here'
    const start = text.indexOf('@')
    const end = text.indexOf(' here')
    const projection = new DisplayProjection(
      input(text, 12, [{ id: 'chip', startIndex: start, endIndex: end, text: '[file.ts]' }]),
    )

    expect(rows(projection)).toEqual(['see the ', '[file.ts] ', 'here'])
  })

  test('lets a replacement wider than the row overflow instead of splitting it', () => {
    const text = 'x @a-very-long-mention-path y'
    const start = text.indexOf('@')
    const end = text.indexOf(' y')
    const projection = new DisplayProjection(
      input(text, 6, [{ id: 'chip', startIndex: start, endIndex: end, text: '[a long chip]' }]),
    )

    expect(rows(projection)).toEqual(['x ', '[a long chip] ', 'y'])
  })

  test('keeps whole-document and line-by-line summaries in agreement', () => {
    const lines = Array.from({ length: 300 }, (_, line) => `line ${line} has\tseveral words`)
    const text = lines.join('\n')
    // A replacement standing for its own text changes nothing on screen but sends every line through
    // the per-line summary instead of the block scan.
    let offset = 0
    const specs = lines.map((line, index) => {
      const spec = { id: `same-${index}`, startIndex: offset, endIndex: offset + 4, text: 'line' }
      offset += line.length + 1
      return spec
    })
    const block = new DisplayProjection(input(text, 10))
    const perLine = new DisplayProjection(input(text, 10, specs))

    expect(block.rowCount).toBeGreaterThan(lines.length * 3)
    expect(rows(perLine)).toEqual(rows(block))
  })

  test('rewraps an edited line at its new word boundaries', () => {
    const configured = input('one two three', 8)
    const projection = new DisplayProjection(configured)
    expect(rows(projection)).toEqual(['one two ', 'three'])

    const edits = [{ from: 3, to: 3, text: ' extra' }]
    const after = createDocumentTextSnapshot(
      applyBatchToPieceTable(createPieceTableSnapshot('one two three'), edits),
    )
    projection.update({ before: configured.textSnapshot, after, edits })

    expect(rows(projection)).toEqual(['one ', 'extra ', 'two ', 'three'])
  })

  test('leaves character wrap unchanged', () => {
    const projection = new DisplayProjection({
      ...input('the list settles', 6),
      wrapBreak: 'character',
    })

    expect(rows(projection)).toEqual(['the li', 'st set', 'tles'])
  })
})
