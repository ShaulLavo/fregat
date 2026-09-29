import { describe, expect, it } from 'vitest'
import {
  createDocumentTextSnapshot,
  createStringTextSnapshot,
  type TextSnapshot,
} from '../src/documentTextSnapshot'
import {
  createPieceTableSnapshot,
  deleteFromPieceTable,
  insertIntoPieceTable,
} from '@singapore-editor/textbuffer'

import {
  createDocumentSession,
  createEditorTextBuffer,
  createEditorBufferSession,
  type DocumentSessionChange,
} from '../src/documentSession'
import { createTextEditBatch } from '../src/textEditBatch'
import { IndentationFoldIndex } from '../src/editor/indentationFoldIndex'
import {
  sameAcceptedStack,
  sameIndentationStack,
  stackNode,
  type AcceptedStack,
  type IndentationStack,
} from '../src/editor/indentationFoldStructure'
import {
  EditorRegionMarkerClassifier,
  indentationFoldingRules,
} from '../src/editor/languageConfiguration'
import { fallbackFoldRanges } from './oracles/foldRanges'

function index(text: string, languageId: string | null = null, tabSize = 4): IndentationFoldIndex {
  return new IndentationFoldIndex({
    snapshot: guardedSnapshot(text),
    languageId,
    tabSize,
  }).complete()
}

function guardedSnapshot(text: string): TextSnapshot {
  const snapshot = createDocumentTextSnapshot(createPieceTableSnapshot(text))
  return {
    length: snapshot.length,
    lineCount: snapshot.lineCount,
    lineAt: (offset) => snapshot.lineAt(offset),
    lineStart: (row) => snapshot.lineStart(row),
    lineRange: (row) => snapshot.lineRange(row),
    readRange: () => {
      throw new RangeError('index must consume chunks')
    },
    materializeFullText: () => {
      throw new RangeError('index must not materialize text')
    },
    forEachTextChunk(visit) {
      for (let start = 0; start < text.length; start += 7)
        visit(text.slice(start, start + 7), start, Math.min(text.length, start + 7))
    },
  }
}

function oracle(text: string, languageId: string | null = null, tabSize = 4) {
  return fallbackFoldRanges({ text, languageId, tabSize })
}

function edit(
  previous: IndentationFoldIndex,
  from: number,
  to: number,
  text: string,
): IndentationFoldIndex {
  const before = previous.snapshot
  let tree = createPieceTableSnapshot(before.materializeFullText())
  tree = deleteFromPieceTable(tree, from, to - from)
  tree = insertIntoPieceTable(tree, from, text)
  const snapshot = createDocumentTextSnapshot(tree)
  return new IndentationFoldIndex({
    snapshot,
    languageId: previous.languageId,
    tabSize: previous.tabSize,
    previous,
    batch: createTextEditBatch(before, snapshot, [{ from, to, text }]),
  })
}

describe('snapshot indentation fold index', () => {
  it('matches the frozen scanner across shipped languages and chunk boundaries', () => {
    const texts = [
      '',
      'head\n  body\n  more\n\nafter\n',
      'a\r\n\tb\r\n    c\r\n\r\nz',
      '// region outer\n  head\n    child\n// region inner\n  child\n// endregion\n// endregion',
      '# region\n  a\n\n  b\n# endregion\n',
      '<!-- #region\na\n  b\n<!-- #endregion',
      '/* region\n a\n  b\n/* endregion\n',
      '// endregion\n head\n   body\n// region unmatched',
      'a\n  b\n    c\n\n  d\n\nz\n',
      '\u00a0// #region x\n text\n\u00a0// #endregion',
    ]
    for (const languageId of [null, 'python', 'typescript', 'css', 'html', 'markdown', 'unknown']) {
      for (const text of texts)
        expect(index(text, languageId).all(), `${languageId}: ${text}`).toEqual(
          oracle(text, languageId),
        )
    }
  })

  it('carries marker recognition through actual piece-table boundaries', () => {
    const text = '\t// #region outer\n  a\n    b\n\t// #endregion\nend'
    let tree = createPieceTableSnapshot('')
    for (const character of [...text].reverse()) tree = insertIntoPieceTable(tree, 0, character)
    const value = new IndentationFoldIndex({
      snapshot: createDocumentTextSnapshot(tree),
      languageId: null,
      tabSize: 4,
    }).complete()
    expect(tree.pieceCount).toBeGreaterThan(20)
    expect(value.all()).toEqual(oracle(text))
  })

  it('has exact marker word boundaries, whitespace and optional hashes', () => {
    const prefixes = ['', ' ', '\t', '\r', '\u00a0']
    const openers = ['//', '/*', '#', '--', ';', '%', '<!--']
    for (const prefix of prefixes) {
      for (const opener of openers) checkMarkers(prefix, opener)
    }
  })

  it('bounds huge-line work and never builds line strings', () => {
    const text = ' '.repeat(90000) + '// region x\nbody\n// endregion\n' + 'x'.repeat(150000)
    const value = new IndentationFoldIndex({
      snapshot: guardedSnapshot(text),
      languageId: null,
      tabSize: 4,
    })
    let iterations = 0
    while (!value.ready) {
      const before = value.diagnostics.codeUnitsRead
      value.step({ maxCodeUnits: 97, maxRows: 128 })
      expect(value.diagnostics.codeUnitsRead - before).toBeLessThanOrEqual(97)
      if (++iterations > 10000) throw new RangeError('build did not converge')
    }
    expect(value.all()).toEqual(oracle(text))
    expect(value.diagnostics.materializations).toBe(0)
  })

  it('reuses topology and unchanged facts for a body-only edit', () => {
    const text = Array.from({ length: 10000 }, (_, row) =>
      row % 5 === 0 ? 'heading' : '  body',
    ).join('\n')
    const previous = new IndentationFoldIndex({
      snapshot: createStringTextSnapshot(text),
      languageId: null,
      tabSize: 4,
    }).complete()
    const from = text.indexOf('body', text.length / 2) + 2
    const value = edit(previous, from, from, 'long')
    const position = value['position'].bind(value)
    let positions = 0
    value['position'] = (reference) => {
      positions += 1
      return position(reference)
    }
    expect(value.step()).toBe(true)
    expect(positions).toBe(0)
    value['position'] = position
    expect(value.diagnostics.rowsRead).toBe(1)
    expect(value.diagnostics.propagationRows).toBe(0)
    expect(value.diagnostics.outcome).toBe('reused')
    expect(value.diagnostics.factBlocksReused).toBeGreaterThan(70)
    expect(value.all()).toEqual(oracle(text.slice(0, from) + 'long' + text.slice(from)))
    expect(value.ancestors(5002)).toEqual(
      value.all().filter((fold) => fold.startLine <= 5002 && fold.endLine >= 5002),
    )
  })

  it('maps multi-cursor joins, splits and semantic changes through the actual batch', () => {
    const lines = Array.from({ length: 700 }, (_, row) => `${' '.repeat(row % 8)}line ${row}`)
    const text = lines.join('\n')
    const previous = new IndentationFoldIndex({
      snapshot: createStringTextSnapshot(text),
      languageId: null,
      tabSize: 4,
    }).complete()
    const edits = [
      { from: 100, to: 105, text: '\n  inserted\n' },
      { from: 1000, to: 1025, text: 'joined' },
      { from: 4000, to: 4000, text: '\n// region\n' },
    ]
    let next = text
    for (const change of edits.toReversed())
      next = next.slice(0, change.from) + change.text + next.slice(change.to)
    const snapshot = createStringTextSnapshot(next)
    const value = new IndentationFoldIndex({
      snapshot,
      languageId: null,
      tabSize: 4,
      previous,
      batch: createTextEditBatch(previous.snapshot, snapshot, edits),
    }).complete()
    expect(value.all()).toEqual(oracle(next))
    expect(value.diagnostics.rowsRead).toBeLessThan(20)
  })

  it('propagates distant indentation and unmatched region dependencies exactly', () => {
    const text = [
      'root',
      ...Array.from({ length: 600 }, (_, row) => `${' '.repeat(2 + (row % 3))}body`),
      'end',
    ].join('\n')
    const previous = new IndentationFoldIndex({
      snapshot: createStringTextSnapshot(text),
      languageId: null,
      tabSize: 4,
    }).complete()
    for (const change of [
      { from: text.lastIndexOf('end'), to: text.length, text: '  tail' },
      { from: text.indexOf('\n') + 1, to: text.indexOf('\n') + 1, text: '// region\n' },
      { from: 0, to: 4, text: '    root' },
    ]) {
      const next = text.slice(0, change.from) + change.text + text.slice(change.to)
      expect(edit(previous, change.from, change.to, change.text).complete().all()).toEqual(
        oracle(next),
      )
    }
  })

  it('rejects snapshot chain gaps and configuration reuse, including reused revisions', () => {
    const previous = new IndentationFoldIndex({
      snapshot: createStringTextSnapshot('a\n\tb\n  c'),
      languageId: null,
      tabSize: 4,
    }).complete()
    const next = new IndentationFoldIndex({
      snapshot: createStringTextSnapshot('z\n  b'),
      languageId: null,
      tabSize: 4,
      previous,
    }).complete()
    expect(next.diagnostics.coldReason).toBe('edit-chain-gap')
    const changed = new IndentationFoldIndex({
      snapshot: previous.snapshot,
      languageId: null,
      tabSize: 2,
      previous,
    }).complete()
    expect(changed.diagnostics.coldReason).toBe('configuration')
    expect(changed.all()).toEqual(oracle('a\n\tb\n  c', null, 2))
  })

  it('cancelling partial work preserves the ready generation and its shared lookup state', () => {
    const text = 'root\n  child\nend'
    const previous = new IndentationFoldIndex({
      snapshot: createStringTextSnapshot(text),
      languageId: null,
      tabSize: 4,
    }).complete()
    const next = edit(previous, 0, 0, '// region\n')
    next.step({ maxCodeUnits: 2 })
    next.cancel()
    expect(next.diagnostics.outcome).toBe('cancelled')
    expect(previous.all()).toEqual(oracle(text))
  })

  it('shares persistent deep checkpoints without copying a depth-sized stack per block', () => {
    const rows = 1800
    const text = Array.from({ length: rows }, (_, row) => ' '.repeat(rows - row) + 'x').join('\n')
    const value = new IndentationFoldIndex({
      snapshot: createDocumentTextSnapshot(createPieceTableSnapshot(text)),
      languageId: null,
      tabSize: 4,
    }).complete()
    const nodes = new Set<object>()
    let references = 0
    for (const block of value['blocks']) {
      for (let node = block.above; node; node = node.parent) {
        nodes.add(node)
        references += 1
      }
    }
    expect(references).toBeGreaterThan(rows * 5)
    expect(nodes.size).toBeLessThanOrEqual(rows + 1)
    expect(value.all()).toEqual(oracle(text))
  })

  it('bounds ancestor cleanup when a disjoint region follows deeply nested regions', () => {
    const depth = 4096
    const text =
      '// region\n'.repeat(depth) +
      'body\n' +
      '// endregion\n'.repeat(depth) +
      '// region\nbody\n// endregion\n'
    const value = new IndentationFoldIndex({
      snapshot: guardedSnapshot(text),
      languageId: null,
      tabSize: 4,
    })
    const work = finishWithBoundedStackWork(value)
    expect(work.maximumPositions).toBeLessThan(2048)
    expect(work.stackOnlySlices).toBeGreaterThan(400)
    expect(value.diagnostics.stackSteps).toBeGreaterThanOrEqual(depth)
    expect(value.all()).toEqual(oracle(text))
  })

  it('resumes a deep dedent without exceeding the stack-work budget', () => {
    const depth = 1024
    const text = [
      'root',
      ...Array.from({ length: depth }, (_, row) => ' '.repeat(depth - row) + 'body'),
    ].join('\n')
    const value = new IndentationFoldIndex({
      snapshot: guardedSnapshot(text),
      languageId: null,
      tabSize: 4,
    })
    const work = finishWithBoundedStackWork(value)
    expect(work.stackOnlySlices).toBeGreaterThan(100)
    expect(value.all()).toEqual(oracle(text))
  })

  it('compares every checkpoint node while allowing the caller to yield between nodes', () => {
    const depth = 1024
    let leftIndent: IndentationStack | null = null
    let rightIndent: IndentationStack | null = null
    let leftAccepted: AcceptedStack | null = null
    let rightAccepted: AcceptedStack | null = null
    for (let row = 0; row < depth; row += 1) {
      const line = { owner: { id: row }, slot: 0 }
      leftIndent = stackNode(-2, line, line, leftIndent)
      rightIndent = stackNode(-2, line, line, rightIndent)
      const fold = { start: line, end: line, endBefore: false, type: 'region' as const }
      leftAccepted = { fold, parent: leftAccepted }
      rightAccepted = { fold: { ...fold }, parent: rightAccepted }
    }
    expect(exhaustStackComparison(sameIndentationStack(leftIndent, rightIndent))).toEqual({
      steps: depth,
      equal: true,
    })
    expect(exhaustStackComparison(sameAcceptedStack(leftAccepted, rightAccepted))).toEqual({
      steps: depth,
      equal: true,
    })
    expect(
      exhaustStackComparison(sameAcceptedStack(leftAccepted, rightAccepted?.parent ?? null)),
    ).toEqual({ steps: 0, equal: false })
  })

  it('releases suspended semantic work when cancelled', () => {
    const text =
      '// region\n'.repeat(256) +
      'body\n' +
      '// endregion\n'.repeat(256) +
      '// region\nbody\n// endregion\n'
    const value = new IndentationFoldIndex({
      snapshot: guardedSnapshot(text),
      languageId: null,
      tabSize: 4,
    })
    while (value.diagnostics.stackSteps === 0 && !value.ready)
      value.step({ maxRows: 128, maxStackSteps: 1 })
    expect(value['semanticWork']).not.toBeNull()
    value.cancel()
    expect(value['semanticWork']).toBeNull()
    expect(value.diagnostics.outcome).toBe('cancelled')
    expect(value.all()).toEqual([])
  })

  it('identifies immutable snapshots independently of revision numbers', () => {
    const firstTree = createPieceTableSnapshot('a\n b')
    const secondTree = createPieceTableSnapshot('x\n y')
    const first = new IndentationFoldIndex({
      snapshot: createDocumentTextSnapshot(firstTree),
      languageId: null,
      tabSize: 4,
    }).complete()
    const alias = new IndentationFoldIndex({
      snapshot: createDocumentTextSnapshot(firstTree),
      languageId: null,
      tabSize: 4,
      previous: first,
    }).complete()
    const distinct = new IndentationFoldIndex({
      snapshot: createDocumentTextSnapshot(secondTree),
      languageId: null,
      tabSize: 4,
    }).complete()
    expect(first.diagnostics.snapshotIdentity).toBe(alias.diagnostics.snapshotIdentity)
    expect(first.diagnostics.snapshotIdentity).not.toBe(distinct.diagnostics.snapshotIdentity)
    expect(alias.diagnostics.rowsRead).toBe(0)
  })

  it('follows real session undo, redo and alternate branches using actual inverse edits', () => {
    const text = 'head\n  body\n    child\nend'
    const session = createDocumentSession(text)
    let current = new IndentationFoldIndex({
      snapshot: session.getTextSnapshot(),
      languageId: null,
      tabSize: 4,
    }).complete()
    const initial = current
    const apply = (change: DocumentSessionChange) => {
      current = new IndentationFoldIndex({
        snapshot: change.textSnapshot,
        languageId: null,
        tabSize: 4,
        previous: current,
        batch: createTextEditBatch(current.snapshot, change.textSnapshot, change.edits),
      }).complete()
      expect(current.all()).toEqual(oracle(change.textSnapshot.materializeFullText()))
      expect(current.diagnostics.coldReason).toBeNull()
      return current
    }
    const first = apply(session.applyEdits([{ from: 5, to: 7, text: '\t' }]))
    const undo = apply(session.undo())
    expect(undo.diagnostics.snapshotIdentity).toBe(initial.diagnostics.snapshotIdentity)
    const redo = apply(session.redo())
    expect(redo.diagnostics.snapshotIdentity).toBe(first.diagnostics.snapshotIdentity)
    apply(session.undo())
    const branch = apply(session.applyEdits([{ from: 5, to: 7, text: '    ' }]))
    expect(branch.diagnostics.snapshotIdentity).not.toBe(first.diagnostics.snapshotIdentity)
    expect(session.canRedo()).toBe(false)
    expect(initial.all()).toEqual(oracle(text))
  })

  it('keeps two sessions with equal numeric revisions separate', () => {
    const leftBuffer = createEditorTextBuffer('head\n  child')
    const rightBuffer = createEditorTextBuffer('root\n    leaf')
    const left = createEditorBufferSession(leftBuffer)
    const right = createEditorBufferSession(rightBuffer)
    left.applyEdits([{ from: 0, to: 0, text: 'a' }])
    right.applyEdits([{ from: 0, to: 0, text: 'b' }])
    expect(leftBuffer.getRevision()).toBe(rightBuffer.getRevision())
    const first = new IndentationFoldIndex({
      snapshot: left.getTextSnapshot(),
      languageId: null,
      tabSize: 4,
    }).complete()
    const second = new IndentationFoldIndex({
      snapshot: right.getTextSnapshot(),
      languageId: null,
      tabSize: 4,
      previous: first,
    }).complete()
    expect(first.diagnostics.snapshotIdentity).not.toBe(second.diagnostics.snapshotIdentity)
    expect(second.diagnostics.coldReason).toBe('edit-chain-gap')
    expect(first.all()).toEqual(oracle(left.materializeFullText()))
    expect(second.all()).toEqual(oracle(right.materializeFullText()))
  })

  it('finishes a local newline change without visiting untouched checkpoint spans', () => {
    const text = 'root\n  child\n'.repeat(10000)
    const previous = new IndentationFoldIndex({
      snapshot: createStringTextSnapshot(text),
      languageId: null,
      tabSize: 4,
    }).complete()
    const next = edit(previous, text.length - 100, text.length - 100, '\n')
    let slices = 0
    while (!next.ready) {
      next.step({ maxRows: 1024, maxCodeUnits: 32768 })
      expect(++slices).toBeLessThan(10)
    }
    expect(next.diagnostics.metadataSteps).toBeGreaterThan(0)
    expect(next.diagnostics.rowsRead).toBe(2)
    expect(next.diagnostics.propagationRows).toBeLessThan(1024)
    const expected = oracle(text.slice(0, -100) + '\n' + text.slice(-100))
    expect(next.all()).toEqual(expected)
    const row = next.snapshot.lineCount - 10
    expect(next.ranges(row, row)).toEqual(
      expected.filter((fold) => fold.startLine <= row && fold.endLine >= row),
    )
  })

  it('yields directory and tree metadata work within the block budget', () => {
    const text = 'root\n  child\n'.repeat(256)
    const value = new IndentationFoldIndex({
      snapshot: guardedSnapshot(text),
      languageId: null,
      tabSize: 4,
    })
    let metadataOnlySlices = 0
    let slices = 0
    while (!value.ready) {
      const before = value.diagnostics
      expect(value.ranges(0, 10)).toEqual([])
      value.step({ maxRows: 128, maxCodeUnits: 32768, maxBlocks: 1 })
      const after = value.diagnostics
      expect(after.metadataSteps - before.metadataSteps).toBeLessThanOrEqual(1)
      if (
        after.metadataSteps > before.metadataSteps &&
        after.rowsRead === before.rowsRead &&
        after.propagationRows === before.propagationRows
      )
        metadataOnlySlices += 1
      expect(++slices).toBeLessThan(100)
    }
    expect(metadataOnlySlices).toBeGreaterThan(20)
    expect(value.diagnostics.maxMetadataStepsPerSlice).toBe(1)
    expect(value.all()).toEqual(oracle(text))
  })

  it('bounds same-row replacement installation and keeps incomplete generations unpublished', () => {
    const text = 'a\n  b\n'.repeat(600)
    const previous = new IndentationFoldIndex({
      snapshot: createStringTextSnapshot(text),
      languageId: null,
      tabSize: 4,
    }).complete()
    const next = edit(previous, 0, text.length, text.replaceAll('b', 'longer'))
    let iterations = 0
    while (!next.ready) {
      expect(next.ranges(0, 10)).toEqual([])
      const blocks = next.diagnostics.factBlocksRebuilt
      next.step({ maxRows: 128, maxCodeUnits: 32768 })
      expect(next.diagnostics.factBlocksRebuilt - blocks).toBeLessThanOrEqual(1)
      expect(++iterations).toBeLessThan(100)
    }
    expect(next.diagnostics.propagationRows).toBe(0)
    expect(next.all()).toEqual(oracle(text.replaceAll('b', 'longer')))
  })

  it('queries headers without resolving enclosing folds in a deep document', () => {
    const rows = 1200
    const text = Array.from({ length: rows }, (_, row) => ' '.repeat(row) + 'x').join('\n')
    const value = new IndentationFoldIndex({
      snapshot: createStringTextSnapshot(text),
      languageId: null,
      tabSize: 4,
    }).complete()
    const headers = value.headers(1100, 1102)
    expect(headers.map((fold) => fold.startLine)).toEqual([1100, 1101, 1102])
    expect(value.ancestors(1100)).toHaveLength(1101)
  })

  it('matches randomized incremental histories against the frozen algorithm', () => {
    let seed = 13
    const random = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
      return seed / 0x100000000
    }
    let text = Array.from({ length: 300 }, (_, row) => `${' '.repeat(row % 5)}a`).join('\n')
    let previous = new IndentationFoldIndex({
      snapshot: createStringTextSnapshot(text),
      languageId: null,
      tabSize: 4,
    }).complete()
    const replacements = ['x', '\n', '  ', '// region', '// endregion', '\n\n', '\t', '']
    for (let iteration = 0; iteration < 120; iteration += 1) {
      const from = Math.floor(random() * text.length)
      const to = Math.min(text.length, from + Math.floor(random() * 8))
      const replacement = replacements[Math.floor(random() * replacements.length)]!
      const value = edit(previous, from, to, replacement).complete()
      text = text.slice(0, from) + replacement + text.slice(to)
      const expected = oracle(text)
      expect(value.all(), `edit ${iteration}: ${from}-${to} ${replacement}`).toEqual(expected)
      const row = value.snapshot.lineAt(from)
      expect(value.ranges(row, row)).toEqual(
        expected.filter((fold) => fold.startLine <= row && fold.endLine >= row),
      )
      previous = value
    }
  })
})

function finishWithBoundedStackWork(value: IndentationFoldIndex) {
  const position = value['position'].bind(value)
  let positions = 0
  let maximumPositions = 0
  let stackOnlySlices = 0
  value['position'] = (reference) => {
    positions += 1
    return position(reference)
  }
  while (!value.ready) {
    const before = value.diagnostics
    positions = 0
    value.step({ maxRows: 128, maxCodeUnits: 32768, maxStackSteps: 7 })
    const after = value.diagnostics
    maximumPositions = Math.max(maximumPositions, positions)
    expect(after.stackSteps - before.stackSteps).toBeLessThanOrEqual(7)
    if (after.stackSteps > before.stackSteps && after.propagationRows === before.propagationRows)
      stackOnlySlices += 1
  }
  value['position'] = position
  return { maximumPositions, stackOnlySlices }
}

function exhaustStackComparison(comparison: Generator<void, boolean>) {
  let steps = 0
  let result = comparison.next()
  while (!result.done) {
    steps += 1
    result = comparison.next()
  }
  return { steps, equal: result.value }
}

function checkMarkers(prefix: string, opener: string): void {
  for (const suffix of [
    'region',
    'endregion',
    'regionX',
    'region_',
    'endregion2',
    '#region',
    '# region',
    'regioné',
    'region!',
  ]) {
    const line = prefix + opener + ' \t' + suffix
    const classifier = new EditorRegionMarkerClassifier(indentationFoldingRules(null).regionMarkers)
    for (const character of line) classifier.push(character.charCodeAt(0))
    let expected: 'start' | 'end' | null = null
    if (/^\s*(?:\/\/|\/\*|#|--|;|%|<!--)\s*#?region\b/.test(line)) expected = 'start'
    if (/^\s*(?:\/\/|\/\*|#|--|;|%|<!--)\s*#?endregion\b/.test(line)) expected = 'end'
    expect(classifier.finish(), line).toBe(expected)
  }
}
