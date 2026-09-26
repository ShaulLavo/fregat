import type { ProjectionEntry, WrappedEntry, WrapSummary } from './displayProjectionTypes'

declare const sourceLineBrand: unique symbol
declare const displayRowBrand: unique symbol
export type SourceLineIndex = number & { readonly [sourceLineBrand]: true }
export type DisplayRowIndex = number & { readonly [displayRowBrand]: true }

export function sourceLineIndex(value: number): SourceLineIndex {
  return normalizedIndex(value) as SourceLineIndex
}

export function displayRowIndex(value: number): DisplayRowIndex {
  return normalizedIndex(value) as DisplayRowIndex
}

function normalizedIndex(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0
}

type Leaf = { readonly kind: 'leaf'; readonly entry: ProjectionEntry }
type Branch = {
  readonly kind: 'branch'
  readonly left: ProjectionNode
  readonly right: ProjectionNode
}
export type ProjectionNode = (Leaf | Branch) & {
  readonly sourceLines: number
  readonly rows: number
  readonly height: number
  readonly nodes: number
  readonly bytes: number
}
export type ProjectionLocation = {
  readonly entry: ProjectionEntry
  readonly sourceStart: SourceLineIndex
  readonly rowStart: DisplayRowIndex
}

type Visit = () => void

export function entryNode(entry: ProjectionEntry): ProjectionNode {
  return {
    kind: 'leaf',
    entry,
    sourceLines: entry.sourceLines,
    rows: entry.rows,
    height: 1,
    nodes: 1,
    bytes: entryBytes(entry),
  }
}

export function runNode(sourceLines: number, hidden = false): ProjectionNode | null {
  if (sourceLines <= 0) return null
  return entryNode({ kind: 'run', sourceLines, rows: hidden ? 0 : sourceLines, hidden })
}

export function join(
  left: ProjectionNode | null,
  right: ProjectionNode | null,
): ProjectionNode | null {
  if (!left) return right
  if (!right) return left
  const merged = mergeRuns(left, right)
  if (merged) return merged
  if (left.height > right.height + 1 && left.kind === 'branch')
    return balance(left.left, join(left.right, right)!)
  if (right.height > left.height + 1 && right.kind === 'branch')
    return balance(join(left, right.left)!, right.right)
  return branch(left, right)
}

function mergeRuns(left: ProjectionNode, right: ProjectionNode): ProjectionNode | null {
  if (left.kind !== 'leaf' || right.kind !== 'leaf') return null
  if (left.entry.kind !== 'run' || right.entry.kind !== 'run') return null
  if (left.entry.hidden !== right.entry.hidden) return null
  return runNode(left.sourceLines + right.sourceLines, left.entry.hidden)
}

function branch(left: ProjectionNode, right: ProjectionNode): ProjectionNode {
  return {
    kind: 'branch',
    left,
    right,
    sourceLines: left.sourceLines + right.sourceLines,
    rows: left.rows + right.rows,
    height: Math.max(left.height, right.height) + 1,
    nodes: left.nodes + right.nodes + 1,
    bytes: left.bytes + right.bytes + 64,
  }
}

function balance(left: ProjectionNode, right: ProjectionNode): ProjectionNode {
  if (left.height > right.height + 1 && left.kind === 'branch') return rotateRight(left, right)
  if (right.height > left.height + 1 && right.kind === 'branch') return rotateLeft(left, right)
  return branch(left, right)
}

function rotateRight(left: Extract<ProjectionNode, Branch>, right: ProjectionNode): ProjectionNode {
  if (left.left.height >= left.right.height || left.right.kind !== 'branch')
    return branch(left.left, branch(left.right, right))
  return branch(branch(left.left, left.right.left), branch(left.right.right, right))
}

function rotateLeft(left: ProjectionNode, right: Extract<ProjectionNode, Branch>): ProjectionNode {
  if (right.right.height >= right.left.height || right.left.kind !== 'branch')
    return branch(branch(left, right.left), right.right)
  return branch(branch(left, right.left.left), branch(right.left.right, right.right))
}

function split(
  node: ProjectionNode | null,
  sourceLine: number,
  visit: Visit,
): readonly [ProjectionNode | null, ProjectionNode | null] {
  if (!node) return [null, null]
  if (sourceLine <= 0) return [null, node]
  if (sourceLine >= node.sourceLines) return [node, null]
  visit()
  if (node.kind === 'leaf') return splitRun(node.entry, sourceLine)
  if (sourceLine < node.left.sourceLines) {
    const [left, middle] = split(node.left, sourceLine, visit)
    return [left, join(middle, node.right)]
  }
  const [middle, right] = split(node.right, sourceLine - node.left.sourceLines, visit)
  return [join(node.left, middle), right]
}

function splitRun(
  entry: ProjectionEntry,
  sourceLine: number,
): readonly [ProjectionNode | null, ProjectionNode | null] {
  if (entry.kind === 'wrapped')
    return [sliceWrapped(entry, 0, sourceLine), sliceWrapped(entry, sourceLine, entry.sourceLines)]
  if (entry.kind !== 'run') return [null, entryNode(entry)]
  return [runNode(sourceLine, entry.hidden), runNode(entry.sourceLines - sourceLine, entry.hidden)]
}

export function splice(
  root: ProjectionNode | null,
  start: number,
  count: number,
  replacement: ProjectionNode | null,
  visit: Visit,
): ProjectionNode | null {
  const [left, rest] = split(root, start, visit)
  const [, right] = split(rest, count, visit)
  return join(join(left, replacement), right)
}

function locate(
  root: ProjectionNode | null,
  position: number,
  space: 'sourceLines' | 'rows',
): ProjectionLocation | null {
  if (!root || position < 0 || position >= root[space]) return null
  let node = root
  let sourceStart = 0
  let rowStart = 0
  while (node.kind === 'branch') {
    const start = space === 'sourceLines' ? sourceStart : rowStart
    if (position < start + node.left[space]) {
      node = node.left
      continue
    }
    sourceStart += node.left.sourceLines
    rowStart += node.left.rows
    node = node.right
  }
  return {
    entry: node.entry,
    sourceStart: sourceLineIndex(sourceStart),
    rowStart: displayRowIndex(rowStart),
  }
}

function entryBytes(entry: ProjectionEntry): number {
  if (entry.kind === 'run') return 64
  if (entry.kind === 'wrapped') return 88 + entry.prefixes.byteLength + wrappedBreakBytes(entry)
  let bytes = 112 + wrapBytes(entry.wrap)
  for (const injected of [...entry.before, ...entry.after]) bytes += 32 + wrapBytes(injected.wrap)
  if (entry.inline)
    bytes += entry.inline.mapping.segments.length * 96 + entry.inline.parts.length * 40
  return bytes
}

function wrapBytes(wrap: import('./displayProjectionTypes').WrapSummary): number {
  return wrap.kind === 'indexed' ? 32 + wrap.ends.byteLength : 32
}

export function wrappedNode(
  prefixes: Uint32Array,
  width: number,
  breaks: WrappedEntry['breaks'] = null,
): ProjectionNode {
  return entryNode({
    kind: 'wrapped',
    sourceLines: prefixes.length - 1,
    rows: prefixes[prefixes.length - 1]! - prefixes[0]!,
    prefixes,
    width,
    breaks,
  })
}

export function wrappedRowPrefix(entry: WrappedEntry, sourceLine: number): number {
  return entry.prefixes[sourceLine]! - entry.prefixes[0]!
}

export function wrappedSourceLine(entry: WrappedEntry, row: number): number {
  let low = 0
  let high = entry.sourceLines - 1
  while (low < high) {
    const middle = Math.floor((low + high) / 2)
    if (wrappedRowPrefix(entry, middle + 1) <= row) low = middle + 1
    else high = middle
  }
  return low
}

function sliceWrapped(entry: WrappedEntry, start: number, end: number): ProjectionNode {
  const breaks = entry.breaks
    ? { offsets: entry.breaks.offsets.subarray(start, end + 1), ends: entry.breaks.ends }
    : null
  return wrappedNode(entry.prefixes.subarray(start, end + 1), entry.width, breaks)
}

function wrappedBreakBytes(entry: WrappedEntry): number {
  if (!entry.breaks) return 0
  const { offsets } = entry.breaks
  return offsets.byteLength + (offsets[offsets.length - 1]! - offsets[0]!) * 4
}

export function wrappedLineSummary(
  entry: WrappedEntry,
  sourceLine: number,
  length: number,
): WrapSummary {
  const rows = wrappedRowPrefix(entry, sourceLine + 1) - wrappedRowPrefix(entry, sourceLine)
  if (entry.breaks) {
    const from = entry.breaks.offsets[sourceLine]!
    const to = entry.breaks.offsets[sourceLine + 1]!
    if (to > from)
      return { kind: 'indexed', length, ends: entry.breaks.ends.subarray(from, to), rows }
  }
  return { kind: 'uniform', length, rows, width: entry.width }
}

export function locateSourceLine(
  root: ProjectionNode | null,
  position: SourceLineIndex,
): ProjectionLocation | null {
  return locate(root, position, 'sourceLines')
}

export function locateDisplayRow(
  root: ProjectionNode | null,
  position: DisplayRowIndex,
): ProjectionLocation | null {
  return locate(root, position, 'rows')
}
