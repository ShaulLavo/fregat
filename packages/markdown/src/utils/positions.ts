import type { Nodes } from 'mdast'
import type { Root as HastRoot } from 'hast'

import type { TrackedText, ProjectedOrigin } from './repair-origin'

/**
 * A suffix parsed on its own reports positions from its first character. The
 * document pipeline keys on absolute offsets, so the prefix's length and line
 * count are added back before the suffix joins the tree.
 */
export function shiftPositions(node: Nodes, offset: number, lines: number): void {
  if (node.position) {
    shiftPoint(node.position.start, offset, lines)
    shiftPoint(node.position.end, offset, lines)
  }
  if (!('children' in node)) return

  for (const child of node.children) shiftPositions(child, offset, lines)
}

function shiftPoint(
  point: { offset?: number | undefined; line: number },
  offset: number,
  lines: number,
) {
  if (point.offset !== undefined) point.offset += offset
  point.line += lines
}

/** Offset of the first character of the line a node starts on, or null without a position. */
export function nodeLineStart(node: Nodes): number | null {
  const start = node.position?.start
  if (start?.offset === undefined) return null

  return start.offset - (start.column - 1)
}

export function countLines(text: string): number {
  let lines = 0
  for (let index = text.indexOf('\n'); index !== -1; index = text.indexOf('\n', index + 1)) {
    lines += 1
  }

  return lines
}

type Point = NonNullable<Nodes['position']>['start']
type Position = NonNullable<Nodes['position']>
type ResolvedPoint = Point & { offset: number }
type PositionedTree = { position?: Position | undefined; children?: readonly PositionedTree[] }

const projectedOrigins = new WeakMap<Position, ProjectedOrigin>()
const documentStart: Point = { line: 1, column: 1, offset: 0 }
type SourceIndex = { readonly text: string; readonly starts: readonly number[] }
// The default base retains one source; window entries live only as long as their owners.
const sourceIndexes = new WeakMap<object, SourceIndex>()

function invalidPosition(constraint: string): never {
  throw Object.assign(new RangeError('Invalid Markdown position'), {
    code: 'MARKDOWN_POSITION',
    status: 500,
    why: 'A Markdown node has invalid source coordinates.',
    fix: 'Check the parser or plugin that created the position.',
    internal: { constraint },
  })
}

function sourceIndex(text: string, owner: object): SourceIndex {
  const previous = sourceIndexes.get(owner)
  if (previous?.text === text) return previous
  const starts = [0]
  for (let index = 0; index < text.length; index += 1) {
    const character = text.charCodeAt(index)
    if (character !== 13 && character !== 10) continue
    if (character === 13 && text.charCodeAt(index + 1) === 10) index += 1
    starts.push(index + 1)
  }
  const result = { text, starts }
  sourceIndexes.set(owner, result)
  return result
}

function baseOffset(base: Point): number {
  const start = base.offset ?? invalidPosition('base offset')
  if (!Number.isSafeInteger(start) || start < 0) invalidPosition('base offset')
  if (!Number.isSafeInteger(base.line) || !Number.isSafeInteger(base.column))
    invalidPosition('integer base')
  if (base.line < 1 || base.column < 1) invalidPosition('positive base')
  return start
}

function indexedPoint(
  source: SourceIndex,
  local: number,
  base: Point,
  offset: number,
): ResolvedPoint {
  let from = 0
  let to = source.starts.length
  while (from + 1 < to) {
    const middle = Math.floor((from + to) / 2)
    if (source.starts[middle]! <= local) from = middle
    else to = middle
  }
  const line = base.line + from
  const column = local - source.starts[from]! + (from === 0 ? base.column : 1)
  if (!Number.isSafeInteger(line) || !Number.isSafeInteger(column)) invalidPosition('point range')
  return { line, column, offset }
}

function indexedSourcePoint(
  text: string,
  offset: number,
  base: Point,
  owner: object,
): ResolvedPoint {
  const local = offset - baseOffset(base)
  if (
    !Number.isSafeInteger(offset) ||
    !Number.isSafeInteger(local) ||
    local < 0 ||
    local > text.length
  )
    invalidPosition('point domain')
  return indexedPoint(sourceIndex(text, owner), local, base, offset)
}

export function sourcePoint(
  text: string,
  offset: number,
  base: Point = documentStart,
): ResolvedPoint {
  return indexedSourcePoint(text, offset, base, base)
}

function resolvedPoint(point: Point, text: string, base: Point): ResolvedPoint {
  if (!Number.isSafeInteger(point.line) || !Number.isSafeInteger(point.column))
    invalidPosition('integer point')
  if (point.line < 1 || point.column < 1) invalidPosition('positive point')
  const start = baseOffset(base)
  if (point.offset !== undefined) {
    const expected = sourcePoint(text, point.offset, base)
    if (expected.line !== point.line || expected.column !== point.column)
      invalidPosition('offset and point disagree')
    return { ...point, offset: point.offset }
  }
  const line = point.line - base.line
  const lineStart = sourceIndex(text, base).starts[line]
  if (lineStart === undefined) invalidPosition('line and column domain')
  const column = point.column - (line === 0 ? base.column : 1)
  if (column < 0) invalidPosition('line and column domain')
  const candidate = sourcePoint(text, start + lineStart + column, base)
  if (candidate.line !== point.line || candidate.column !== point.column)
    invalidPosition('line and column domain')
  return candidate
}

export function resolvePositions(
  tree: PositionedTree,
  text: string,
  base: Point = documentStart,
): void {
  if (tree.position) {
    const start = resolvedPoint(tree.position.start, text, base)
    const end = resolvedPoint(tree.position.end, text, base)
    if (start.offset > end.offset) invalidPosition('ordered position')
    tree.position = { ...tree.position, start, end }
  }
  if (!tree.children) return
  for (const child of tree.children) resolvePositions(child, text, base)
}

export function projectPosition(
  input: TrackedText,
  position: Position,
): { position: Position; origin: ProjectedOrigin } {
  const start = position.start.offset ?? invalidPosition('resolved start')
  const end = position.end.offset ?? invalidPosition('resolved end')
  const origin = input.project(start - input.window.start, end - start)
  const from = origin.kind === 'authored' ? origin.span.start : origin.at
  const to = origin.kind === 'authored' ? origin.span.start + origin.span.length : origin.at
  const projected = {
    ...position,
    start: projectPoint(input, position.start, from),
    end: projectPoint(input, position.end, to),
  }
  projectedOrigins.set(projected, origin)
  return { position: projected, origin }
}

function projectPoint(input: TrackedText, point: Point, offset: number): Point {
  const authored = indexedSourcePoint(input.window.text, offset, input.window.point, input.window)
  if (offset === point.offset && authored.line === point.line && authored.column === point.column)
    return { ...point }
  return authored
}

export function projectTree(tree: PositionedTree, input: TrackedText): void {
  if (tree.position) tree.position = projectPosition(input, tree.position).position
  if (!tree.children) return
  for (const child of tree.children) projectTree(child, input)
}

export function cloneTree<T>(value: T): T
export function cloneTree(value: unknown): unknown {
  return cloneValue(value, new Map())
}

function cloneValue(value: unknown, seen: Map<object, object>): unknown {
  if (value === null || typeof value !== 'object') return value
  const previous = seen.get(value)
  if (previous) return previous
  const result = cloneShell(value)
  seen.set(value, result)
  cloneEntries(value, result, seen)
  for (const key of Reflect.ownKeys(value)) cloneProperty(value, result, key, seen)
  return result
}

function cloneShell(value: object): object {
  const result = builtinShell(value)
  Object.setPrototypeOf(result, Object.getPrototypeOf(value))
  return result
}

function builtinShell(value: object): object {
  if (value instanceof Date) return new Date(value.getTime())
  if (value instanceof RegExp) return new RegExp(value.source, value.flags)
  if (value instanceof Map) return new Map<unknown, unknown>()
  if (value instanceof Set) return new Set<unknown>()
  if (value instanceof ArrayBuffer) return value.slice(0)
  if (ArrayBuffer.isView(value)) return structuredClone(value)
  return Array.isArray(value) ? [] : Object.create(Object.getPrototypeOf(value))
}

function cloneEntries(source: object, target: object, seen: Map<object, object>): void {
  if (source instanceof Map && target instanceof Map) {
    for (const [key, entry] of source) target.set(cloneValue(key, seen), cloneValue(entry, seen))
    return
  }
  if (source instanceof Set && target instanceof Set) {
    for (const entry of source) target.add(cloneValue(entry, seen))
  }
}

function cloneProperty(
  source: object,
  target: object,
  key: PropertyKey,
  seen: Map<object, object>,
): void {
  const descriptor = Object.getOwnPropertyDescriptor(source, key)
  if (!descriptor) return
  if ('value' in descriptor) descriptor.value = cloneValue(descriptor.value, seen)
  Object.defineProperty(target, key, descriptor)
}

export function projectHast(tree: HastRoot, input: TrackedText): void {
  const position = tree.position
  if (!position || !documentBoundary(position)) {
    resolvePositions(tree, input.text, input.window.point)
    projectTree(tree, input)
    return
  }
  // parse5's fragment root carries the document origin, outside a nonzero block window.
  for (const child of tree.children) projectPreparedNode(child, input)
}

function projectPreparedNode(tree: PositionedTree, input: TrackedText): void {
  resolvePositions(tree, input.text, input.window.point)
  projectTree(tree, input)
}

function documentBoundary(position: Position): boolean {
  return (
    position.start.offset === 0 &&
    position.end.offset === 0 &&
    position.start.line === 1 &&
    position.end.line === 1 &&
    position.start.column === 1 &&
    position.end.column === 1
  )
}

export function resolveParsedPositions(root: Nodes, source: string): void {
  const end = root.position?.end.offset
  if (source.startsWith('\uFEFF') && end === source.length - 1) {
    resolvePositions(root, source.slice(1))
    shiftPositions(root, 1, 0)
    restoreBOMColumns(root)
    return
  }
  resolvePositions(root, source)
}

function restoreBOMColumns(tree: PositionedTree): void {
  if (tree.position?.start.line === 1) tree.position.start.column += 1
  if (tree.position?.end.line === 1) tree.position.end.column += 1
  if (!tree.children) return
  for (const child of tree.children) restoreBOMColumns(child)
}
