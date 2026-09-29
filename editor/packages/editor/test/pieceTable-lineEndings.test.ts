import { describe, expect, test } from 'vitest'
import {
  applyDocumentLineEnding,
  createPieceTableSnapshot,
  detectDocumentLineEnding,
  hasByteOrderMark,
  materializePieceTableFullText,
  normalizeDocumentText,
  normalizeLineEndings,
  offsetToPoint,
  pieceTableByteOrderMark,
  pieceTableDocumentText,
  pieceTableLineEnding,
  pointToOffset,
  UTF8_BYTE_ORDER_MARK,
} from '@singapore-editor/textbuffer'
import { createDocumentSession } from '../src/documentSession'

describe('detectDocumentLineEnding', () => {
  test('falls back when the text has no terminators', () => {
    expect(detectDocumentLineEnding('single line')).toBe('\n')
    expect(detectDocumentLineEnding('single line', '\r\n')).toBe('\r\n')
  })

  test('detects uniform documents', () => {
    expect(detectDocumentLineEnding('a\nb\nc')).toBe('\n')
    expect(detectDocumentLineEnding('a\r\nb\r\nc')).toBe('\r\n')
  })

  test('takes the majority in mixed documents', () => {
    expect(detectDocumentLineEnding('a\r\nb\r\nc\nd')).toBe('\r\n')
    expect(detectDocumentLineEnding('a\r\nb\nc\nd')).toBe('\n')
  })

  test('counts a lone carriage return as a carriage-return ending', () => {
    expect(detectDocumentLineEnding('a\rb\rc')).toBe('\r\n')
  })

  test('does not double-count the line feed of a pair', () => {
    // Two CRLF vs three LF: the LF majority must win.
    expect(detectDocumentLineEnding('a\r\nb\r\nc\nd\ne\nf')).toBe('\n')
  })
})

describe('normalizeDocumentText', () => {
  test.each([
    ['', '\r\n'],
    ['single line', '\r\n'],
    ['a\nb', '\n'],
    ['λ\n語', '\n'],
    ['\n', '\n'],
  ] as const)('preserves LF-only classification and fallback for %j', (text, lineEnding) => {
    expect(normalizeDocumentText(text, '\r\n')).toEqual({
      text,
      lineEnding,
      byteOrderMark: '',
      containsUnusualLineTerminators: false,
    })
  })

  test('flattens carriage returns and reports what it found', () => {
    expect(normalizeDocumentText('a\r\nb\r\nc')).toEqual({
      text: 'a\nb\nc',
      lineEnding: '\r\n',
      byteOrderMark: '',
      containsUnusualLineTerminators: false,
    })
  })

  test('strips a byte order mark into its own field', () => {
    expect(normalizeDocumentText(`${UTF8_BYTE_ORDER_MARK}a\nb`)).toEqual({
      text: 'a\nb',
      lineEnding: '\n',
      byteOrderMark: UTF8_BYTE_ORDER_MARK,
      containsUnusualLineTerminators: false,
    })
  })

  test('folds unusual line terminators and reports that it did', () => {
    expect(normalizeDocumentText('a\u2028b\u2029c')).toEqual({
      text: 'a\nb\nc',
      lineEnding: '\n',
      byteOrderMark: '',
      containsUnusualLineTerminators: true,
    })
  })

  test('unusual line terminators do not sway the line-ending vote', () => {
    // A Word paste inside a CRLF file must not make the file save as LF.
    expect(normalizeDocumentText('a\r\nb\u2028c\u2028d').lineEnding).toBe('\r\n')
  })

  test('only strips a byte order mark at offset zero', () => {
    const inner = `a${UTF8_BYTE_ORDER_MARK}b`
    expect(hasByteOrderMark(inner)).toBe(false)
    expect(normalizeDocumentText(inner).text).toBe(inner)
  })

  test('leaves lone line feeds untouched', () => {
    const text = 'a\nb\nc'
    expect(normalizeLineEndings(text)).toBe(text)
  })
})

describe('normalizeLineEndings', () => {
  test('gives the same answer however many times it is called', () => {
    // The fast-path probe must not carry state between calls: a stateful regex
    // would skip normalization on alternate documents, and a raw CR or U+2028
    // reaching the piece table breaks the LF-only invariant every line index
    // and every row-geometry calculation is built on.
    const text = 'a\rb\u2028c'

    expect([
      normalizeLineEndings(text),
      normalizeLineEndings(text),
      normalizeLineEndings(text),
    ]).toEqual(['a\nb\nc', 'a\nb\nc', 'a\nb\nc'])
  })
})

describe('createPieceTableSnapshot line ending ingestion', () => {
  test('stores carriage-return documents as line feeds only', () => {
    const snapshot = createPieceTableSnapshot('a\r\nb\r\nc')
    expect(materializePieceTableFullText(snapshot)).toBe('a\nb\nc')
    expect(pieceTableLineEnding(snapshot)).toBe('\r\n')
  })

  test('line ends exclude the carriage return', () => {
    const snapshot = createPieceTableSnapshot('ab\r\ncd')
    // 'ab' is offsets 0..2 with the break at 2; without normalization the
    // stored line would be 'ab\r' and every column past it would be off by one.
    expect(offsetToPoint(snapshot, 2)).toEqual({ row: 0, column: 2 })
    expect(pointToOffset(snapshot, { row: 1, column: 0 })).toBe(3)
    expect(snapshot.length).toBe(5)
  })

  test('records a byte order mark without leaving it in the text', () => {
    const snapshot = createPieceTableSnapshot(`${UTF8_BYTE_ORDER_MARK}hello`)
    expect(materializePieceTableFullText(snapshot)).toBe('hello')
    expect(pieceTableByteOrderMark(snapshot)).toBe(UTF8_BYTE_ORDER_MARK)
    expect(offsetToPoint(snapshot, 0)).toEqual({ row: 0, column: 0 })
  })

  test('an unusual line terminator becomes a real row boundary', () => {
    const snapshot = createPieceTableSnapshot('ab\u2028cd')
    // CSS `white-space: pre` breaks the painted row on the separator whether or
    // not we do, so the model has to agree: two rows, break at offset 2.
    expect(materializePieceTableFullText(snapshot)).toBe('ab\ncd')
    expect(offsetToPoint(snapshot, 3)).toEqual({ row: 1, column: 0 })
    expect(pointToOffset(snapshot, { row: 1, column: 2 })).toBe(5)
  })

  test('normalized: true skips re-scanning already-flat text', () => {
    const snapshot = createPieceTableSnapshot('a\r\nb', { normalized: true })
    expect(materializePieceTableFullText(snapshot)).toBe('a\r\nb')
  })
})

describe('pieceTableDocumentText', () => {
  test('round-trips a carriage-return document', () => {
    const original = `${UTF8_BYTE_ORDER_MARK}a\r\nb\r\nc`
    expect(pieceTableDocumentText(createPieceTableSnapshot(original))).toBe(original)
  })

  test('round-trips a line-feed document unchanged', () => {
    const original = 'a\nb\nc'
    expect(pieceTableDocumentText(createPieceTableSnapshot(original))).toBe(original)
  })

  test('honours an explicit line ending override', () => {
    const snapshot = createPieceTableSnapshot('a\nb')
    expect(pieceTableDocumentText(snapshot, { lineEnding: '\r\n' })).toBe('a\r\nb')
  })

  test('can drop the byte order mark on request', () => {
    const snapshot = createPieceTableSnapshot(`${UTF8_BYTE_ORDER_MARK}a`)
    expect(pieceTableDocumentText(snapshot, { preserveByteOrderMark: false })).toBe('a')
  })

  test('applyDocumentLineEnding is the inverse of normalizeLineEndings', () => {
    const text = 'a\r\nb\r\nc'
    expect(applyDocumentLineEnding(normalizeLineEndings(text), '\r\n')).toBe(text)
  })
})

describe('editing keeps the line-feed-only invariant', () => {
  test('pasted carriage returns are flattened before the edit lands', () => {
    const session = createDocumentSession('start')
    session.applyEdits([{ from: 5, to: 5, text: '\r\nnext\r\nlast' }])
    expect(materializePieceTableFullText(session.getSnapshot())).toBe('start\nnext\nlast')
  })

  test('an applied edit cannot smuggle in an unusual line terminator', () => {
    const session = createDocumentSession('start')
    session.applyEdits([{ from: 5, to: 5, text: '\u2028next\u2029para' }])
    expect(materializePieceTableFullText(session.getSnapshot())).toBe('start\nnext\npara')
  })

  test('an edit reports the length it actually inserted', () => {
    const session = createDocumentSession('')
    session.applyEdits([{ from: 0, to: 0, text: 'a\r\nb' }])
    const snapshot = session.getSnapshot()
    // Three characters stored, not four: the caret must be able to reach the
    // end, and undo derives its inverse range from this same length.
    expect(snapshot.length).toBe(3)
    expect(offsetToPoint(snapshot, 3)).toEqual({ row: 1, column: 1 })
  })

  test('undo restores the pre-paste text exactly', () => {
    const session = createDocumentSession('seed')
    session.applyEdits([{ from: 4, to: 4, text: '\r\ntail' }])
    expect(materializePieceTableFullText(session.getSnapshot())).toBe('seed\ntail')
    session.undo()
    expect(materializePieceTableFullText(session.getSnapshot())).toBe('seed')
  })

  test('the document line ending survives editing', () => {
    const session = createDocumentSession('a\r\nb')
    session.applyEdits([{ from: 3, to: 3, text: 'c' }])
    const snapshot = session.getSnapshot()
    expect(pieceTableLineEnding(snapshot)).toBe('\r\n')
    expect(pieceTableDocumentText(snapshot)).toBe('a\r\nbc')
  })
})
