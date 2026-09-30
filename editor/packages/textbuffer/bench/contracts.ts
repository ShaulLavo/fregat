import type {
  PieceTableAnchor as Anchor,
  AnchorBias,
  PieceTableSnapshot,
} from '@singapore-editor/textbuffer'

export type Edit = { kind: 'edit'; from: number; to: number; text: string }
export type Batch = { kind: 'batch'; edits: Omit<Edit, 'kind'>[] }
export type Change = Edit | Batch
export type Point = { row: number; column: number }
export type Query =
  | { kind: 'line'; row: number }
  | { kind: 'range'; from: number; to: number }
  | { kind: 'offset'; offset: number }
  | { kind: 'point'; point: Point }
  | { kind: 'full' }
export type Operation = Change | Query
export type Retained = { before: number; sha256: string }
export type FixtureBase = {
  name: string
  category: 'shared' | 'singapore-only'
  initial: string
  setup: Change[]
  expected: string
}
export type EditFixture = FixtureBase & { mode: 'edit'; operations: Change[]; retained: Retained[] }
export type Fixture = FixtureBase &
  (
    | { mode: 'load'; operations: Operation[]; retained?: Retained[] }
    | { mode: 'edit'; operations: Operation[]; retained?: Retained[] }
    | { mode: 'query'; operations: Query[]; expectedDigest: number }
    | { mode: 'history'; operations: Change[]; retained: Retained[] }
    | { mode: 'branches'; operations: { kind: 'branch'; edit: Edit }[]; expectedDigest: number }
    | { mode: 'anchors'; operations: { kind: 'anchor'; index: number }[]; anchorOffsets: number[] }
    | {
        mode: 'anchor-density'
        operations: Edit[]
        anchors: { offset: number; bias: AnchorBias }[]
        expectedOffsets: number[]
        expectedDigest: number
      }
  )
export type Random = (limit: number) => number
export type ProfileName = 'smoke' | 'standard'
export type Retention = 'always' | 'transaction' | 'history'
export type Engine = 'singapore' | 'vscode'
export type TreeNode = {
  piece: { length: number; visible?: boolean } | null
  left: TreeNode | null
  right: TreeNode | null
}
export type Buffer = {
  snapshot?: PieceTableSnapshot
  tree?: { root: TreeNode | null }
  length(): number
  lineCount(): number
  edit(edit: Omit<Edit, 'kind'>): void
  batch(edits: Omit<Edit, 'kind'>[]): void
  line(row: number): string
  range(from: number, to: number): string
  point(offset: number): Point
  offset(point: Point): number
  full(): string
  issues(): readonly unknown[]
  stats(): Record<string, number>
  retain?(): PieceTableSnapshot
  anchor?(offset: number, bias: AnchorBias): Anchor
  resolve?(anchor: Anchor): { offset: number; liveness: string }
  resolveLinear?(anchor: Anchor): { offset: number; liveness: string }
}
export type Factory = {
  create(text: string): Buffer
  restore?(snapshot: PieceTableSnapshot): Buffer
  retention?: Retention
  retainedText?(snapshot: PieceTableSnapshot): string
}
export type CounterValues = Record<string, number>
export type Counters = {
  start(): void
  stop(): CounterValues
  add(name: string, amount?: number): void
}

declare global {
  var __textbufferBenchCounters: Counters | undefined
}

export function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new TypeError('Expected benchmark object')
  return Object.fromEntries(Object.entries(value))
}
export function text(value: unknown): string {
  if (typeof value !== 'string') throw new TypeError('Expected benchmark string')
  return value
}
export function number(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value))
    throw new TypeError('Expected finite benchmark number')
  return value
}
export function array(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new TypeError('Expected benchmark array')
  return value
}
export function parseProfileName(value: string): ProfileName {
  if (value === 'smoke' || value === 'standard') return value
  throw new TypeError('Unknown benchmark profile')
}
function parsePoint(value: unknown): Point {
  const point = record(value)
  return { row: number(point.row), column: number(point.column) }
}
function parseEdit(value: unknown): Edit {
  const edit = record(value)
  return { kind: 'edit', from: number(edit.from), to: number(edit.to), text: text(edit.text) }
}
function parseChange(value: unknown): Change {
  const change = record(value)
  if (change.kind === 'edit') return parseEdit(change)
  if (change.kind === 'batch') return { kind: 'batch', edits: array(change.edits).map(parseEdit) }
  throw new TypeError('Unknown benchmark edit')
}
function parseQuery(value: unknown): Query {
  const query = record(value)
  if (query.kind === 'line') return { kind: 'line', row: number(query.row) }
  if (query.kind === 'range')
    return { kind: 'range', from: number(query.from), to: number(query.to) }
  if (query.kind === 'offset') return { kind: 'offset', offset: number(query.offset) }
  if (query.kind === 'point') return { kind: 'point', point: parsePoint(query.point) }
  if (query.kind === 'full') return { kind: 'full' }
  throw new TypeError('Unknown benchmark query')
}
function parseOperation(value: unknown): Operation {
  const operation = record(value)
  return operation.kind === 'edit' || operation.kind === 'batch'
    ? parseChange(operation)
    : parseQuery(operation)
}
function parseRetained(value: unknown): Retained {
  const retained = record(value)
  return { before: number(retained.before), sha256: text(retained.sha256) }
}
function parseBias(value: unknown): AnchorBias {
  if (value === 'left' || value === 'right') return value
  throw new TypeError('Unknown anchor bias')
}
export function parseFixture(value: unknown): Fixture {
  const fixture = record(value)
  const category = fixture.category
  if (category !== 'shared' && category !== 'singapore-only')
    throw new TypeError('Unknown fixture category')
  const base: FixtureBase = {
    name: text(fixture.name),
    category,
    initial: text(fixture.initial),
    setup: array(fixture.setup).map(parseChange),
    expected: text(fixture.expected),
  }
  const operations = array(fixture.operations)
  switch (fixture.mode) {
    case 'load':
    case 'edit':
      return {
        ...base,
        mode: fixture.mode,
        operations: operations.map(parseOperation),
        ...(fixture.retained === undefined
          ? {}
          : { retained: array(fixture.retained).map(parseRetained) }),
      }
    case 'history':
      return {
        ...base,
        mode: 'history',
        operations: operations.map(parseChange),
        retained: array(fixture.retained).map(parseRetained),
      }
    case 'query':
      return {
        ...base,
        mode: 'query',
        operations: operations.map(parseQuery),
        expectedDigest: number(fixture.expectedDigest),
      }
    case 'branches':
      return {
        ...base,
        mode: 'branches',
        operations: operations.map((value) => ({
          kind: 'branch',
          edit: parseEdit(record(value).edit),
        })),
        expectedDigest: number(fixture.expectedDigest),
      }
    case 'anchors':
      return {
        ...base,
        mode: 'anchors',
        operations: operations.map((value) => ({
          kind: 'anchor',
          index: number(record(value).index),
        })),
        anchorOffsets: array(fixture.anchorOffsets).map(number),
      }
    case 'anchor-density':
      return {
        ...base,
        mode: 'anchor-density',
        operations: operations.map(parseEdit),
        anchors: array(fixture.anchors).map((value) => {
          const anchor = record(value)
          return { offset: number(anchor.offset), bias: parseBias(anchor.bias) }
        }),
        expectedOffsets: array(fixture.expectedOffsets).map(number),
        expectedDigest: number(fixture.expectedDigest),
      }
    default:
      throw new TypeError('Unknown fixture mode')
  }
}
