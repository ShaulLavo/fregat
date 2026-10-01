import { describe } from 'vitest'
import { expect, test } from '../../../../test/fixtures'
import {
  createEditorTextBuffer,
  createEditorViewSession,
  pieceTableDocumentText,
} from '@singapore-editor/core/document'
import { csvCellEdit, parseCsv } from '@/features/workbench/utils/csv'
import { isCsvPath } from '@/features/workbench/utils/csv-path'

test('CSV paths select table support without loading the parser', () => {
  expect(isCsvPath('data/fruit.csv')).toBe(true)
  expect(isCsvPath('data/FRUIT.CSV')).toBe(true)
  expect(isCsvPath('data/fruit.csv.txt')).toBe(false)
  expect(isCsvPath('data/fruit.tsv')).toBe(false)
})

function table(text: string) {
  const result = parseCsv(text)
  expect(result.kind).toBe('table')
  if (result.kind !== 'table') throw new TypeError(result.message)
  return result.table
}

describe('CSV presentation over the live document', () => {
  test.each([
    ['name,price\npear,2\n', ',', [['name', 'price'], ['pear', '2'], ['']]],
    ['name;price\r\npear;2\r\n', ';', [['name', 'price'], ['pear', '2'], ['']]],
    [
      'name\tprice\npear\t2',
      '\t',
      [
        ['name', 'price'],
        ['pear', '2'],
      ],
    ],
    [
      '"name","notes",\r\n"pear","two\r\nlines",',
      ',',
      [
        ['name', 'notes', ''],
        ['pear', 'two\r\nlines', ''],
      ],
    ],
    [
      'a,b,c\n,,\n1,2,',
      ',',
      [
        ['a', 'b', 'c'],
        ['', '', ''],
        ['1', '2', ''],
      ],
    ],
    [
      '﻿a,b\n1,2',
      ',',
      [
        ['a', 'b'],
        ['1', '2'],
      ],
    ],
    ['single\ncolumn', ',', [['single'], ['column']]],
  ])('reads delimiter, quoting and empty fields in %j', (text, delimiter, values) => {
    const parsed = table(text)
    expect(parsed.delimiter).toBe(delimiter)
    expect(parsed.rows.map((row) => row.map((cell) => cell.value))).toEqual(values)
    for (const row of parsed.rows) {
      for (const cell of row) {
        expect(text.slice(cell.start, cell.end)).toBe(
          cell.quoted ? `"${cell.value.replaceAll('"', '""')}"` : cell.value,
        )
      }
    }
  })

  test('changes only the selected field and preserves existing quoting, CRLF and trailing cells', () => {
    const text = '"name";"notes";\r\n"pear";"line one\r\nline two";\r\n'
    const parsed = table(text)
    const edit = csvCellEdit(parsed.rows[1]![0]!, parsed.delimiter, 'peach')!
    expect(text.slice(0, edit.from) + edit.text + text.slice(edit.to)).toBe(
      text.replace('"pear"', '"peach"'),
    )
  })

  test.each(['comma,value', 'a"quote', 'two\nlines', ''])(
    'encodes a changed field %j safely',
    (value) => {
      const parsed = table('first,second\nold,untouched')
      const edit = csvCellEdit(parsed.rows[1]![0]!, parsed.delimiter, value)!
      const updated =
        'first,second\nold,untouched'.slice(0, edit.from) +
        edit.text +
        'first,second\nold,untouched'.slice(edit.to)
      expect(table(updated).rows[1]!.map((cell) => cell.value)).toEqual([value, 'untouched'])
    },
  )

  test('new separators in a value preserve delimiter inference for a single row', () => {
    const original = 'first;second'
    const parsed = table(original)
    const edit = csvCellEdit(parsed.rows[0]![0]!, parsed.delimiter, 'new,value')!
    const updated = original.slice(0, edit.from) + edit.text + original.slice(edit.to)
    expect(table(updated).delimiter).toBe(';')
    expect(table(updated).rows[0]!.map((cell) => cell.value)).toEqual(['new,value', 'second'])
  })

  test('editing the final empty record retains separators in untouched records', () => {
    const original = 'a;b\nc;d\n'
    const parsed = table(original)
    const edit = csvCellEdit(parsed.rows.at(-1)![0]!, parsed.delimiter, 'tail')!
    const updated = table(original.slice(0, edit.from) + edit.text + original.slice(edit.to))
    expect(updated.delimiter).toBe(';')
    expect(updated.rows.map((row) => row.map((cell) => cell.value))).toEqual([
      ['a', 'b'],
      ['c', 'd'],
      ['tail'],
    ])
  })

  test('unchanged cells create no edits', () => {
    const parsed = table('"same",other')
    expect(csvCellEdit(parsed.rows[0]![0]!, parsed.delimiter, 'same')).toBeNull()
  })

  test.each(['a,b\n"unclosed,b', 'a,b\n"closed"junk,b'])('reports malformed quoting %j', (text) => {
    expect(parseCsv(text).kind).toBe('error')
  })

  test('empty document has no rows', () => {
    expect(table('').rows).toEqual([])
  })

  test('table edits publish through the existing buffer and undo restores exact saved CSV', () => {
    const original = '﻿"name";"notes";\r\n"pear";"two\r\nlines";\r\n'
    const buffer = createEditorTextBuffer(original)
    const view = createEditorViewSession(buffer)
    const publications: number[] = []
    const release = buffer.subscribe((event) => publications.push(event.revisionAfter))
    const snapshot = buffer.getTextSnapshot()
    const parsed = table(snapshot.readRange(0, snapshot.length))
    const edit = csvCellEdit(parsed.rows[1]![0]!, parsed.delimiter, 'peach')!
    buffer.applyEdits(view.getSelections(), [edit], {}, view)
    expect(buffer.isDirty()).toBe(true)
    expect(pieceTableDocumentText(buffer.getSnapshot())).toBe(original.replace('"pear"', '"peach"'))
    expect(table(buffer.materializeFullText()).rows[1]![0]!.value).toBe('peach')
    buffer.undo(view)
    expect(pieceTableDocumentText(buffer.getSnapshot())).toBe(original)
    expect(buffer.isDirty()).toBe(false)
    buffer.redo(view)
    expect(table(buffer.materializeFullText()).rows[1]![0]!.value).toBe('peach')
    expect(publications).toEqual([1, 2, 3])
    release()
  })
})
