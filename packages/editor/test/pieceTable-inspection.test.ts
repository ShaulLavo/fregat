import { describe, expect, it } from 'vitest'
import {
  createPieceTreeInspectionSession,
  formatPieceTree,
  validatePieceTreeInvariants,
} from '@singapore-editor/textbuffer/debug'
import {
  createPieceTableSnapshot,
  deleteFromPieceTable,
  insertIntoPieceTable,
  materializePieceTableFullText,
  type PieceTableSnapshot,
} from '@singapore-editor/textbuffer'
import { createSnapshot } from '@singapore-editor/textbuffer/internal/snapshot'
import { createNode } from '@singapore-editor/textbuffer/internal/node'
import { normalizePieceOrders } from '@singapore-editor/textbuffer/internal/tree'
import {
  buildReverseIndex,
  reverseIndexSlot,
} from '@singapore-editor/textbuffer/internal/reverseIndex'
import type { PieceTreeNode } from '@singapore-editor/textbuffer/internal/pieceTableTypes'

function control(): PieceTableSnapshot {
  const base = createPieceTableSnapshot('a\nb\n')
  const buffer = base.buffers.original
  const left = createNode(
    { buffer, start: 0, length: 2, order: 1, lineBreaks: 1, firstLineBreak: 0, visible: true },
    null,
    null,
  )
  const root = createNode(
    { buffer, start: 2, length: 2, order: 2, lineBreaks: 1, firstLineBreak: 1, visible: false },
    left,
    null,
  )
  return { ...base, root, reverseIndex: buildReverseIndex(root), length: 2, pieceCount: 2 }
}

function churn(count: number): PieceTableSnapshot {
  let snapshot = createPieceTableSnapshot('line\n'.repeat(200))
  let expected = 'line\n'.repeat(200)
  let seed = 123
  for (let i = 0; i < count; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    const offset = seed % (snapshot.length + 1)
    const text = `${i}\n`
    snapshot = insertIntoPieceTable(snapshot, offset, text)
    expected = expected.slice(0, offset) + text + expected.slice(offset)
    if (i % 3 === 0) {
      snapshot = deleteFromPieceTable(snapshot, offset, 1)
      expected = expected.slice(0, offset) + expected.slice(offset + 1)
    }
    expect(materializePieceTableFullText(snapshot)).toBe(expected)
    expect(validatePieceTreeInvariants(snapshot).issues, `edit ${i}`).toEqual([])
  }
  return snapshot
}

describe('piece tree inspection', () => {
  it('checks hand-calculated visible and tombstone aggregates', () => {
    const snapshot = control()
    expect(snapshot.root).toMatchObject({
      subtreeOriginalLength: 4,
      subtreeVisibleLength: 2,
      subtreePieces: 2,
      subtreeLineBreaks: 1,
      subtreeMinBuffer: 0,
    })
    // Both pieces are original text, which the reverse index does not hold.
    expect(validatePieceTreeInvariants(snapshot)).toEqual({
      issues: [],
      counts: { nodes: 2, visible: 1, invisible: 1, reverseEntries: 0, lineIndexes: 1 },
    })
  })

  it.each([
    'subtreeOriginalLength',
    'subtreeVisibleLength',
    'subtreePieces',
    'subtreeLineBreaks',
    'subtreeMinBuffer',
  ] as const)('identifies a corrupt %s independently of child caches', (field) => {
    const snapshot = control()
    const expected = snapshot.root![field]
    snapshot.root![field] = 99
    const session = createPieceTreeInspectionSession()
    expect(validatePieceTreeInvariants(snapshot, session.label).issues).toContainEqual({
      kind: 'aggregate',
      node: session.label(snapshot.root!),
      field,
      expected,
      actual: 99,
    })
  })

  it('does not propagate a corrupted child cache into expected parent sums', () => {
    const snapshot = control()
    snapshot.root!.left!.subtreeVisibleLength = 100
    const issues = validatePieceTreeInvariants(snapshot).issues
    expect(issues).toHaveLength(1)
    expect(issues[0]).toMatchObject({ field: 'subtreeVisibleLength', expected: 2, actual: 100 })
  })

  it('detects missing reverse entries and orders that disagree with the tree', () => {
    const snapshot = insertIntoPieceTable(createPieceTableSnapshot('abc'), 1, 'X')
    expect(validatePieceTreeInvariants(snapshot)).toMatchObject({
      issues: [],
      counts: { reverseEntries: 1 },
    })
    const unindexed = { ...snapshot, reverseIndex: createPieceTableSnapshot('').reverseIndex }
    expect(validatePieceTreeInvariants(unindexed).issues).toContainEqual(
      expect.objectContaining({ kind: 'reverse-index', field: 'reverseEntry [1,0]' }),
    )
    const relabelled = normalizePieceOrders(snapshot.root, { value: 7 })
    expect(
      validatePieceTreeInvariants({ ...snapshot, reverseIndex: buildReverseIndex(relabelled) })
        .issues,
    ).toContainEqual(
      expect.objectContaining({ kind: 'reverse-index', field: 'reverseEntry [1,0]', actual: 1031 }),
    )
  })

  it('reports pieces out of buffer order and missing buffers', () => {
    const snapshot = control()
    snapshot.root!.piece = { ...snapshot.root!.piece, start: 0 }
    expect(validatePieceTreeInvariants(snapshot).issues).toContainEqual(
      expect.objectContaining({ kind: 'ordering', field: 'piece.start', expected: 2, actual: 0 }),
    )
    const missing = { ...snapshot, buffers: { ...snapshot.buffers, chunks: new Map() } }
    expect(validatePieceTreeInvariants(missing).issues).toContainEqual(
      expect.objectContaining({ kind: 'buffer-bounds', field: 'piece.buffer' }),
    )
  })

  it('reports an older piece between two pieces of a newer buffer', () => {
    const typed = insertIntoPieceTable(createPieceTableSnapshot('abcdef'), 3, 'WXYZ')
    const cut = insertIntoPieceTable(typed, 5, '-')
    expect(validatePieceTreeInvariants(cut).issues).toEqual([])
    // The piece that cut the insert claims the original buffer, which is older.
    const middle = (node: PieceTreeNode | null): PieceTreeNode | null => {
      if (!node) return null
      if (node.piece.buffer === 2) return node
      return middle(node.left) ?? middle(node.right)
    }
    const node = middle(cut.root)!
    node.piece = { ...node.piece, buffer: cut.buffers.original }
    expect(validatePieceTreeInvariants(cut).issues).toContainEqual(
      expect.objectContaining({ kind: 'ordering', field: 'piece.buffer' }),
    )
  })

  it('reports buffer bounds, line breaks and snapshot totals precisely', () => {
    const snapshot = control()
    snapshot.root!.piece = { ...snapshot.root!.piece, lineBreaks: 99 }
    expect(validatePieceTreeInvariants(snapshot).issues).toContainEqual(
      expect.objectContaining({ field: 'piece.lineBreaks', expected: 1, actual: 99 }),
    )
    snapshot.root!.piece = { ...snapshot.root!.piece, start: -1, length: 999 }
    const issues = validatePieceTreeInvariants({ ...snapshot, length: 123, pieceCount: 9 }).issues
    expect(issues).toEqual(
      expect.arrayContaining(
        ['piece.start', 'piece.length', 'length', 'pieceCount'].map((field) =>
          expect.objectContaining({ field }),
        ),
      ),
    )
  })

  it('catches order violations without consulting materialized text', () => {
    const snapshot = control()
    const text = materializePieceTableFullText(snapshot)
    snapshot.root!.left!.piece = { ...snapshot.root!.left!.piece, order: 3 }
    expect(materializePieceTableFullText(snapshot)).toBe(text)
    expect(validatePieceTreeInvariants(snapshot).issues).toContainEqual(
      expect.objectContaining({
        kind: 'ordering',
        field: 'left.order',
        expected: '< 2',
        actual: 3,
      }),
    )
  })

  it('checks the stored height and the balance rule in the tree and the index', () => {
    const snapshot = control()
    expect(validatePieceTreeInvariants(snapshot).issues).toEqual([])
    snapshot.root!.height = 5
    expect(validatePieceTreeInvariants(snapshot).issues).toContainEqual(
      expect.objectContaining({ kind: 'balance', field: 'height', expected: 2, actual: 5 }),
    )
    snapshot.root!.left!.height = 3
    expect(validatePieceTreeInvariants(snapshot).issues).toContainEqual(
      expect.objectContaining({ kind: 'balance', field: 'children' }),
    )
    // A buffer cut twice keeps its pieces in a small tree inside the index.
    let cut = insertIntoPieceTable(createPieceTableSnapshot('abc'), 1, 'WXYZ')
    cut = insertIntoPieceTable(insertIntoPieceTable(cut, 2, '-'), 5, '-')
    expect(validatePieceTreeInvariants(cut).issues).toEqual([])
    const pieces = reverseIndexSlot(cut.reverseIndex, 0) as { height: number }
    pieces.height = 9
    expect(validatePieceTreeInvariants(cut).issues).toContainEqual(
      expect.objectContaining({ kind: 'balance', node: 'reverse buffer 1', actual: 9 }),
    )
  })

  it('reports cycles, repeated children and deep corruption iteratively', () => {
    const snapshot = control()
    snapshot.root!.right = snapshot.root
    expect(
      validatePieceTreeInvariants(snapshot).issues.filter((issue) => issue.kind === 'cycle'),
    ).toHaveLength(1)
    expect(() => formatPieceTree(snapshot)).not.toThrow()
    snapshot.root!.right = snapshot.root!.left
    expect(
      validatePieceTreeInvariants(snapshot).issues.some((issue) => issue.kind === 'structure'),
    ).toBe(true)
    let root: PieceTreeNode | null = null
    for (let i = 20000; i > 0; i--)
      root = createNode({ ...snapshot.root!.piece, order: i }, null, root)
    const deep = { ...snapshot, root }
    expect(() => validatePieceTreeInvariants(deep)).not.toThrow()
    expect(formatPieceTree(deep, { maxRows: 2 }).split('\n')).toHaveLength(4)
  })

  it('validates retained line-index offsets and ignores unused capacity across isolated branches', () => {
    const original = createPieceTableSnapshot('base')
    const snapshot = insertIntoPieceTable(original, 0, 'x\ny')
    const sibling = insertIntoPieceTable(original, 0, 'abc')
    const buffer = snapshot.buffers.nextBufferSequence - 1
    const index = {
      offsets: new Uint32Array([1, 99, 99]),
      count: 1,
      scannedLength: 3,
    }
    const cached = {
      ...snapshot,
      buffers: { ...snapshot.buffers, lineIndexes: new Map([[buffer, index]]) },
    }
    expect(validatePieceTreeInvariants(cached).issues).toEqual([])
    expect(validatePieceTreeInvariants(sibling).issues).toEqual([])
    index.offsets[0] = 2
    expect(validatePieceTreeInvariants(cached).issues).toContainEqual(
      expect.objectContaining({ kind: 'line-index', field: 'offsets[0]', expected: 1, actual: 2 }),
    )
    expect(validatePieceTreeInvariants(sibling).issues).toEqual([])
    index.offsets[0] = 1
    index.count = 0
    expect(validatePieceTreeInvariants(cached).issues).toContainEqual(
      expect.objectContaining({ field: 'count', expected: 1, actual: 0 }),
    )
  })

  it('prints stable empty, split, deleted and normalized snapshots with bounded opt-in text', () => {
    expect(formatPieceTree(createPieceTableSnapshot(''))).toBe(
      'piece tree length=0 pieces=0 nodes=0',
    )
    const initial = createPieceTableSnapshot('secret\ntext')
    const split = insertIntoPieceTable(initial, 3, 'x')
    const deleted = deleteFromPieceTable(split, 2, 5)
    const root = normalizePieceOrders(deleted.root, { value: 100 })
    const normalized = createSnapshot(deleted.buffers, root, buildReverseIndex(root))
    for (const [name, snapshot] of [
      ['initial', initial],
      ['split', split],
      ['deleted', deleted],
      ['normalized', normalized],
    ] as const) {
      expect(formatPieceTree(snapshot)).toMatchSnapshot(name)
      expect(formatPieceTree(snapshot)).not.toContain('text=')
      expect(validatePieceTreeInvariants(snapshot).issues).toEqual([])
    }
    expect(formatPieceTree(initial, { excerptLength: 3 })).toContain('text="sec"')
    expect(formatPieceTree(deleted)).toContain('tombstone')
    expect(formatPieceTree(control())).toMatchSnapshot()
  })

  it('distinguishes identity reuse from copies, preserves roots and caches during stress', () => {
    const before = churn(250)
    const dump = formatPieceTree(before, { maxRows: 10000 })
    const after = deleteFromPieceTable(before, 20, 5)
    const session = createPieceTreeInspectionSession()
    const result = session.compare(before, after)
    expect(result.changes.some((change) => change.kind === 'reused')).toBe(true)
    expect(result.changes.some((change) => change.kind === 'copied')).toBe(true)
    const whole = deleteFromPieceTable(before, 0, before.length)
    expect(
      session.compare(before, whole).changes.some((change) => change.fields.includes('visible')),
    ).toBe(true)
    expect(
      session.compare(before, before).changes.every((change) => change.kind === 'reused'),
    ).toBe(true)
    expect(validatePieceTreeInvariants(before).issues).toEqual([])
    expect(validatePieceTreeInvariants(after).issues).toEqual([])
    expect(formatPieceTree(before, { maxRows: 10000 })).toBe(dump)
    // Editing may extend caches; inspection must leave the post-edit cache values intact.
    const caches = [...(after.buffers.lineIndexes ?? [])].map(([key, value]) => [
      key,
      { ...value, offsets: value.offsets.slice() },
    ])
    session.inspect(after)
    validatePieceTreeInvariants(after)
    expect([...(after.buffers.lineIndexes ?? [])]).toEqual(caches)
    expect(Object.isFrozen(result.after.nodes[0]?.piece)).toBe(true)
    const copy = { ...before, root: { ...before.root! } }
    expect(session.compare(before, copy).changes).toContainEqual(
      expect.objectContaining({ kind: 'copied', fields: [] }),
    )
  })
})
