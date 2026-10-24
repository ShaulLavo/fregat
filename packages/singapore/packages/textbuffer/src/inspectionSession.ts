import { readBufferRange } from './buffers'
import type { Piece, PieceTableSnapshot } from './pieceTableTypes'
import { createInspectionLabels, walkInspectionTree } from './inspectionWalk'
import { inspectionPieceFields, inspectionPieceKey } from './inspection'
import { reverseIndexEntries } from './reverseIndex'

export type PieceInspectionNode = {
  readonly id: string
  readonly parent: string | null
  readonly edge: 'root' | 'left' | 'right'
  readonly depth: number
  readonly tree: 'pieces' | 'reverse'
  readonly left: string | null
  readonly right: string | null
  readonly height: number
  readonly piece: Piece
  readonly values: Readonly<Record<string, number | string>>
  readonly excerpt: string | null
}
export type PieceTreeInspection = {
  readonly length: number
  readonly pieceCount: number
  readonly nodes: readonly PieceInspectionNode[]
}
export type PieceNodeChange = {
  readonly kind: 'reused' | 'copied' | 'added' | 'removed'
  readonly before: string | null
  readonly after: string | null
  readonly fields: readonly (keyof Piece)[]
}
export type PieceTreeComparison = {
  readonly before: PieceTreeInspection
  readonly after: PieceTreeInspection
  readonly changes: readonly PieceNodeChange[]
}
export type PieceInspectionOptions = { readonly excerptLength?: number }

export function inspectionLimit(
  value: number | undefined,
  fallback: number,
  maximum: number,
): number {
  if (value === undefined || !Number.isFinite(value)) return fallback
  return Math.max(0, Math.min(maximum, Math.floor(value)))
}

function excerpt(snapshot: PieceTableSnapshot, piece: Piece, length: number): string | null {
  if (length === 0) return null
  try {
    return readBufferRange(
      snapshot.buffers,
      piece.buffer,
      piece.start,
      piece.start + Math.min(piece.length, length),
    )
  } catch {
    return null
  }
}

function compareRecords(
  before: PieceTreeInspection,
  after: PieceTreeInspection,
): readonly PieceNodeChange[] {
  const identities = new Map(before.nodes.map((node) => [node.id, node]))
  const keys = new Map(
    before.nodes.map((node) => [`${node.tree}:${inspectionPieceKey(node.piece)}`, node]),
  )
  const matched = new Set<string>()
  const changes: PieceNodeChange[] = []
  for (const node of after.nodes) {
    const previous =
      identities.get(node.id) ?? keys.get(`${node.tree}:${inspectionPieceKey(node.piece)}`)
    if (!previous) {
      changes.push(
        Object.freeze({ kind: 'added', before: null, after: node.id, fields: Object.freeze([]) }),
      )
      continue
    }
    matched.add(previous.id)
    const fields = inspectionPieceFields.filter(
      (field) => previous.piece[field] !== node.piece[field],
    )
    changes.push(
      Object.freeze({
        kind: previous.id === node.id ? 'reused' : 'copied',
        before: previous.id,
        after: node.id,
        fields: Object.freeze(fields),
      }),
    )
  }
  for (const node of before.nodes) {
    if (!matched.has(node.id))
      changes.push(
        Object.freeze({ kind: 'removed', before: node.id, after: null, fields: Object.freeze([]) }),
      )
  }
  return Object.freeze(changes)
}

export function createPieceTreeInspectionSession() {
  const label = createInspectionLabels()
  function inspect(
    snapshot: PieceTableSnapshot,
    options: PieceInspectionOptions = {},
  ): PieceTreeInspection {
    const length = inspectionLimit(options.excerptLength, 0, 120)
    const nodes: PieceInspectionNode[] = []
    walkInspectionTree(
      snapshot.root,
      ({ node, parent, edge, depth }) => {
        nodes.push(
          Object.freeze({
            id: label(node),
            parent: parent ? label(parent) : null,
            edge,
            depth,
            tree: 'pieces',
            left: node.left ? label(node.left) : null,
            right: node.right ? label(node.right) : null,
            height: node.height,
            piece: Object.freeze({ ...node.piece }),
            values: Object.freeze({
              subtreeOriginalLength: node.subtreeOriginalLength,
              subtreeVisibleLength: node.subtreeVisibleLength,
              subtreePieces: node.subtreePieces,
              subtreeLineBreaks: node.subtreeLineBreaks,
              subtreeMinBuffer: node.subtreeMinBuffer,
            }),
            excerpt: excerpt(snapshot, node.piece, length),
          }),
        )
      },
      () => {},
      () => {},
    )
    // The index is a vector of entries, not a tree: one flat row per entry,
    // carrying the piece its order leads to.
    const byOrder = new Map(nodes.map((node) => [node.piece.order, node.piece]))
    for (const entry of reverseIndexEntries(snapshot.reverseIndex)) {
      const piece = byOrder.get(entry.order)
      if (!piece) continue
      nodes.push(
        Object.freeze({
          id: `reverse ${entry.buffer}/${entry.start}`,
          parent: null,
          edge: 'root',
          depth: 0,
          tree: 'reverse',
          left: null,
          right: null,
          height: 1,
          piece: Object.freeze({ ...piece }),
          values: Object.freeze({ buffer: entry.buffer, start: entry.start, order: entry.order }),
          excerpt: excerpt(snapshot, piece, length),
        }),
      )
    }
    return Object.freeze({
      length: snapshot.length,
      pieceCount: snapshot.pieceCount,
      nodes: Object.freeze(nodes),
    })
  }
  function compare(
    before: PieceTableSnapshot,
    after: PieceTableSnapshot,
    options: PieceInspectionOptions = {},
  ): PieceTreeComparison {
    const first = inspect(before, options)
    const second = inspect(after, options)
    return Object.freeze({ before: first, after: second, changes: compareRecords(first, second) })
  }
  return Object.freeze({ inspect, compare, label })
}
