import { afterEach, describe, expect, it } from 'vitest'
import {
  createDocumentTextSnapshot,
  createPieceTableSnapshot,
  createStringTextSnapshot,
  deleteFromPieceTable,
  insertIntoPieceTable,
} from '../src/public/document'

type Diagnostic = {
  readonly name: string
  readonly detail?: Readonly<Record<string, unknown>>
}

type DiagnosticGlobal = typeof globalThis & {
  __EDITOR_PERFORMANCE_DIAGNOSTICS__?: ((diagnostic: Diagnostic) => void) | null
}

const diagnosticGlobal = (): DiagnosticGlobal => globalThis as DiagnosticGlobal

describe('DocumentTextSnapshot', () => {
  afterEach(() => {
    Reflect.deleteProperty(globalThis, '__EDITOR_PERFORMANCE_DIAGNOSTICS__')
  })

  it('does not retain computed full text materializations', () => {
    const diagnostics = collectDiagnostics()
    const snapshot = createDocumentTextSnapshot(createPieceTableSnapshot('alpha'))

    expect(snapshot.materializeFullText()).toBe('alpha')
    expect(snapshot.materializeFullText()).toBe('alpha')

    const reads = diagnostics.filter(
      (diagnostic) => diagnostic.name === 'textSnapshot.materializeFullText',
    )
    expect(reads).toHaveLength(2)
    expect(reads.map((diagnostic) => diagnostic.detail)).toEqual([
      { length: 5, cached: false, retained: false },
      { length: 5, cached: false, retained: false },
    ])
  })

  it('keeps constructor-provided full text as the retained cache', () => {
    const diagnostics = collectDiagnostics()
    const snapshot = createDocumentTextSnapshot(createPieceTableSnapshot('alpha'), 'alpha')

    expect(snapshot.materializeFullText()).toBe('alpha')
    expect(snapshot.materializeFullText()).toBe('alpha')

    const reads = diagnostics.filter(
      (diagnostic) => diagnostic.name === 'textSnapshot.materializeFullText',
    )
    expect(reads).toHaveLength(2)
    expect(reads.map((diagnostic) => diagnostic.detail)).toEqual([
      { length: 5, cached: true, retained: true },
      { length: 5, cached: true, retained: true },
    ])
  })

  it('reads ranges and visits each piece-table text chunk', () => {
    const pieceTable = insertIntoPieceTable(createPieceTableSnapshot('abcdef'), 3, 'XX')
    const snapshot = createDocumentTextSnapshot(pieceTable)
    const chunks: string[] = []

    snapshot.forEachTextChunk((text, start, end) => {
      chunks.push(`${start}:${end}:${text}`)
    })

    expect(snapshot.snapshot).toBe(pieceTable)
    expect(snapshot.length).toBe(8)
    expect(snapshot.readRange(2, 6)).toBe('cXXd')
    expect(chunks).toEqual(['0:3:abc', '3:5:XX', '5:8:def'])
  })

  it('shares methods across document snapshot instances', () => {
    const first = createDocumentTextSnapshot(createPieceTableSnapshot('alpha'))
    const second = createDocumentTextSnapshot(createPieceTableSnapshot('beta'))

    expect(Object.getPrototypeOf(first)).toBe(Object.getPrototypeOf(second))
    expect(Object.hasOwn(first, 'materializeFullText')).toBe(false)
    expect(Object.hasOwn(first, 'readRange')).toBe(false)
    expect(Object.hasOwn(first, 'forEachTextChunk')).toBe(false)
    expect(first.materializeFullText).toBe(second.materializeFullText)
    expect(first.readRange).toBe(second.readRange)
    expect(first.forEachTextChunk).toBe(second.forEachTextChunk)
  })

  it.each(['', 'a', '\n', 'a\n', '\na\n\nb', 'a\nb\nc\n'])(
    'provides matching line rank and select for %j',
    (text) => {
      assertLinePositions(createDocumentTextSnapshot(createPieceTableSnapshot(text)), text)
      assertLinePositions(createStringTextSnapshot(text), text)
    },
  )

  it('keeps line positions tied to immutable snapshots after splices', () => {
    const original = createPieceTableSnapshot('alpha\nbeta\ngamma\n')
    const inserted = insertIntoPieceTable(original, 8, '\none\ntwo\n')
    const deleted = deleteFromPieceTable(inserted, 2, 17)
    assertLinePositions(createDocumentTextSnapshot(original), 'alpha\nbeta\ngamma\n')
    assertLinePositions(createDocumentTextSnapshot(inserted), 'alpha\nbe\none\ntwo\nta\ngamma\n')
    assertLinePositions(createDocumentTextSnapshot(deleted), 'al\ngamma\n')
  })

  it('retains cold indexes for divergent and extended append buffers', () => {
    const base = createPieceTableSnapshot('root\n')
    const abandoned = createDocumentTextSnapshot(insertIntoPieceTable(base, 0, 'a\nb'))
    expect(abandoned.lineStart(1)).toBe(2)
    const kept = createDocumentTextSnapshot(insertIntoPieceTable(base, 0, 'xx\ny'))
    expect(kept.lineStart(1)).toBe(3)
    const tail = insertIntoPieceTable(createPieceTableSnapshot(''), 0, 'one\n')
    const short = createDocumentTextSnapshot(tail)
    expect(short.lineStart(1)).toBe(4)
    const grown = createDocumentTextSnapshot(insertIntoPieceTable(tail, tail.length, 'two\n'))
    expect(grown.lineStart(2)).toBe(8)
    const diagnostics = collectDiagnostics()
    for (let repeat = 0; repeat < 3; repeat += 1) {
      expect(abandoned.lineStart(1)).toBe(2)
      expect(kept.lineStart(1)).toBe(3)
      expect(short.lineStart(1)).toBe(4)
      expect(grown.lineStart(2)).toBe(8)
    }
    expect(diagnostics.filter((event) => event.name === 'textSnapshot.sourceIndex')).toEqual([])
  })

  it.each([100_000, 500_000])(
    'builds one source index during creation and shares it across views and top edits on %i lines',
    (lineCount) => {
      const text = 'row\n'.repeat(lineCount - 1) + 'row'
      const diagnostics = collectDiagnostics()
      const tree = createPieceTableSnapshot(text)
      const initialIndex = tree.buffers.lineIndexes?.get(tree.buffers.original)
      expect(initialIndex).toMatchObject({ count: lineCount - 1, scannedLength: text.length })
      const first = createDocumentTextSnapshot(tree)
      const peer = createDocumentTextSnapshot(tree)
      const earlyEdit = createDocumentTextSnapshot(insertIntoPieceTable(tree, 0, 'header\n'))
      expect(first.lineCount).toBe(lineCount)
      expect(first.lineStart(lineCount - 1)).toBe((lineCount - 1) * 4)
      expect(peer.lineAt(text.length)).toBe(lineCount - 1)
      expect(earlyEdit.lineStart(lineCount)).toBe((lineCount - 1) * 4 + 7)
      expect(tree.buffers.lineIndexes?.get(tree.buffers.original)).toBe(initialIndex)
      const cold = diagnostics.filter((event) => event.name === 'textSnapshot.sourceIndex')
      expect(cold).toHaveLength(1)
      expect(cold[0]?.detail).toMatchObject({ scannedCodeUnits: text.length })
      diagnostics.length = 0
      const changed = createDocumentTextSnapshot(insertIntoPieceTable(tree, 2, 'x\ny'))
      expect(changed.lineCount).toBe(lineCount + 1)
      expect(changed.lineStart(lineCount)).toBe(text.length - 3 + 3)
      expect(peer.lineStart(lineCount - 1)).toBe(text.length - 3)
      const reads = diagnostics.filter((event) => event.name === 'textSnapshot.sourceIndex')
      expect(reads.every((event) => Number(event.detail?.scannedCodeUnits) <= 3)).toBe(true)
      expect(diagnostics.some((event) => event.name === 'textSnapshot.read')).toBe(false)
    },
  )
})

describe('StringTextSnapshot', () => {
  afterEach(() => {
    Reflect.deleteProperty(globalThis, '__EDITOR_PERFORMANCE_DIAGNOSTICS__')
  })

  it('builds its detached source line index once', () => {
    const diagnostics = collectDiagnostics()
    const snapshot = createStringTextSnapshot('one\ntwo\nthree')
    expect(diagnostics).toEqual([])
    expect(snapshot.lineCount).toBe(3)
    expect(snapshot.lineStart(2)).toBe(8)
    expect(snapshot.lineAt(7)).toBe(1)
    expect(snapshot.lineAt(snapshot.length)).toBe(2)
    expect(diagnostics.filter((event) => event.name === 'textSnapshot.sourceIndex')).toHaveLength(1)
  })

  it('reads text and visits one non-empty chunk', () => {
    const snapshot = createStringTextSnapshot('alpha')
    const chunks: string[] = []

    snapshot.forEachTextChunk((text, start, end) => {
      chunks.push(`${start}:${end}:${text}`)
    })

    expect(snapshot.length).toBe(5)
    expect(snapshot.materializeFullText()).toBe('alpha')
    expect(snapshot.readRange(1, 4)).toBe('lph')
    expect(chunks).toEqual(['0:5:alpha'])
  })

  it('does not visit a chunk for empty text', () => {
    const snapshot = createStringTextSnapshot('')
    let visits = 0

    snapshot.forEachTextChunk(() => {
      visits += 1
    })

    expect(snapshot.length).toBe(0)
    expect(visits).toBe(0)
  })

  it('shares methods and the length accessor across string snapshot instances', () => {
    const first = createStringTextSnapshot('alpha')
    const second = createStringTextSnapshot('beta')
    const firstPrototype = Object.getPrototypeOf(first)
    const secondPrototype = Object.getPrototypeOf(second)
    const lengthGetter = Object.getOwnPropertyDescriptor(firstPrototype, 'length')?.get

    expect(firstPrototype).toBe(secondPrototype)
    expect(Object.hasOwn(first, 'length')).toBe(false)
    expect(Object.hasOwn(first, 'materializeFullText')).toBe(false)
    expect(Object.hasOwn(first, 'readRange')).toBe(false)
    expect(Object.hasOwn(first, 'forEachTextChunk')).toBe(false)
    expect(lengthGetter).toBeTypeOf('function')
    expect(first.materializeFullText).toBe(second.materializeFullText)
    expect(first.readRange).toBe(second.readRange)
    expect(first.forEachTextChunk).toBe(second.forEachTextChunk)
    expect(lengthGetter).toBe(Object.getOwnPropertyDescriptor(secondPrototype, 'length')?.get)
  })
})

function collectDiagnostics(): Diagnostic[] {
  const diagnostics: Diagnostic[] = []
  diagnosticGlobal().__EDITOR_PERFORMANCE_DIAGNOSTICS__ = (diagnostic) => {
    diagnostics.push(diagnostic)
  }
  return diagnostics
}

function assertLinePositions(
  snapshot: ReturnType<typeof createStringTextSnapshot>,
  text: string,
): void {
  const starts = [0]
  for (let offset = 0; offset < text.length; offset += 1) {
    if (text[offset] === '\n') starts.push(offset + 1)
  }
  expect(snapshot.lineCount).toBe(starts.length)
  expect(snapshot.lineStart(-1)).toBe(0)
  expect(snapshot.lineStart(starts.length)).toBe(text.length)
  for (const [line, offset] of starts.entries()) {
    expect(snapshot.lineStart(line)).toBe(offset)
  }
  for (let offset = -1; offset <= text.length + 1; offset += 1) {
    const clamped = Math.max(0, Math.min(offset, text.length))
    expect(snapshot.lineAt(offset)).toBe(text.slice(0, clamped).split('\n').length - 1)
  }
}
