import type { Root } from 'mdast'

type Point = NonNullable<Root['position']>['start']

declare const authoredOffset: unique symbol
declare const preparedOffset: unique symbol
declare const localOffset: unique symbol
export type AuthoredOffset = number & { readonly [authoredOffset]: true }
export type PreparedOffset = number & { readonly [preparedOffset]: true }
export type LocalOffset = number & { readonly [localOffset]: true }
export type RepairOwner = 'hold' | 'remend' | 'nestedStrongRepair'
export type Span = Readonly<{ start: AuthoredOffset; length: number }>
export type Gap = Readonly<{ left: AuthoredOffset; right: AuthoredOffset }>
export type AuthoredWindow = Readonly<{ text: string; start: AuthoredOffset; point: Point }>
export type OriginRun =
  | Readonly<{ kind: 'copy'; source: Span }>
  | Readonly<{ kind: 'insert'; text: string; owner: RepairOwner; gap: Gap }>
export type ProducerPart =
  | Readonly<{ kind: 'copy'; source: LocalSpan }>
  | Readonly<{ kind: 'insert'; text: string; cause: LocalSpan }>
export type ProducerEdit = Readonly<{
  input: TrackedText
  owner: RepairOwner
  site: string
  parts: readonly ProducerPart[]
  expected: string
}>
export type ConstructionReceipt = Readonly<{
  input: symbol
  output: symbol
  owner: RepairOwner
  site: string
  inputLength: number
  outputLength: number
  copies: readonly Readonly<{ start: LocalOffset; length: number }>[]
  deletions: readonly Readonly<{ start: LocalOffset; length: number }>[]
  insertions: readonly Readonly<{
    at: number
    length: number
    cause: Readonly<{ start: LocalOffset; length: number }>
    gap: Gap
  }>[]
}>
export type ProjectedOrigin =
  | Readonly<{ kind: 'authored'; span: Span; runs: readonly OriginRun[] }>
  | Readonly<{ kind: 'synthetic'; at: AuthoredOffset; runs: readonly OriginRun[] }>
  | Readonly<{ kind: 'boundary'; at: AuthoredOffset; gap: Gap }>

function invalid(constraint: string, internal: Record<string, number | string>): never {
  throw Object.assign(new RangeError('Invalid repair construction'), {
    code: 'MARKDOWN_REPAIR_ORIGIN',
    status: 500,
    why: 'The repair coordinates violate their construction contract.',
    fix: 'Check the producer interval and candidate identity.',
    internal: { constraint, ...internal },
  })
}

function natural(value: number, constraint: string): number {
  if (!Number.isSafeInteger(value) || value < 0) invalid(constraint, { value })
  return value
}

export function toAuthoredOffset(value: number): AuthoredOffset {
  return natural(value, 'authored offset') as AuthoredOffset
}

export function toPreparedOffset(value: number): PreparedOffset {
  return natural(value, 'prepared offset') as PreparedOffset
}

function gap(left: number, right: number): Gap {
  if (right < left) invalid('ordered authored gap', { left, right })
  return Object.freeze({ left: toAuthoredOffset(left), right: toAuthoredOffset(right) })
}

function runLength(run: OriginRun): number {
  return run.kind === 'copy' ? run.source.length : run.text.length
}

function runLeft(run: OriginRun): number {
  return run.kind === 'copy' ? run.source.start : run.gap.left
}

function runRight(run: OriginRun): number {
  return run.kind === 'copy' ? run.source.start + run.source.length : run.gap.right
}

function appendRun(runs: OriginRun[], run: OriginRun): void {
  if (runLength(run) === 0) return
  const previous = runs.at(-1)
  if (previous?.kind === 'copy' && run.kind === 'copy' && runRight(previous) === run.source.start) {
    runs[runs.length - 1] = Object.freeze({
      kind: 'copy',
      source: Object.freeze({
        start: previous.source.start,
        length: previous.source.length + run.source.length,
      }),
    })
    return
  }
  if (
    previous?.kind === 'insert' &&
    run.kind === 'insert' &&
    previous.owner === run.owner &&
    previous.gap.left === run.gap.left &&
    previous.gap.right === run.gap.right
  ) {
    runs[runs.length - 1] = Object.freeze({ ...run, text: previous.text + run.text })
    return
  }
  runs.push(run)
}

export class LocalSpan {
  private readonly candidate: symbol
  readonly input: TrackedText
  readonly start: LocalOffset
  readonly length: number

  private constructor(input: TrackedText, start: LocalOffset, length: number) {
    this.input = input
    this.start = start
    this.length = length
    this.candidate = input.token
    Object.freeze(this)
  }
  static create(input: TrackedText, start: number, length: number): LocalSpan {
    natural(start, 'local start')
    natural(length, 'local length')
    if (start + length > input.text.length)
      invalid('local bounds', { start, length, inputLength: input.text.length })
    return new LocalSpan(input, start as LocalOffset, length)
  }
  belongsTo(input: TrackedText): boolean {
    return this.input === input && this.candidate === input.token
  }
}

export function localSpan(input: TrackedText, start: number, length: number): LocalSpan {
  return LocalSpan.create(input, start, length)
}

export function copy(
  input: TrackedText,
  start = 0,
  length = input.text.length - start,
): ProducerPart {
  return Object.freeze({ kind: 'copy', source: localSpan(input, start, length) })
}

export function insert(input: TrackedText, text: string, start: number, length = 0): ProducerPart {
  return Object.freeze({ kind: 'insert', text, cause: localSpan(input, start, length) })
}

export class TrackedText {
  readonly window: AuthoredWindow
  readonly text: string
  readonly runs: readonly OriginRun[]
  readonly receipts: readonly ConstructionReceipt[]
  private readonly emptyGap: Gap
  readonly token: symbol

  private constructor(
    window: AuthoredWindow,
    text: string,
    runs: readonly OriginRun[],
    receipts: readonly ConstructionReceipt[],
    emptyGap: Gap,
    token: symbol,
  ) {
    this.window = window
    this.text = text
    this.runs = runs
    this.receipts = receipts
    this.emptyGap = emptyGap
    this.token = token
    Object.freeze(this)
  }

  static begin(window: AuthoredWindow): TrackedText {
    natural(window.start, 'window start')
    natural(window.start + window.text.length, 'window end')
    natural(window.point.line - 1, 'window line')
    natural(window.point.column - 1, 'window column')
    if (window.point.offset !== undefined && window.point.offset !== window.start)
      invalid('window point offset', { start: window.start, offset: window.point.offset })
    const ownedWindow = Object.freeze({ ...window, point: Object.freeze({ ...window.point }) })
    const source = Object.freeze({ start: window.start, length: window.text.length })
    const runs: OriginRun[] = window.text.length ? [Object.freeze({ kind: 'copy', source })] : []
    return new TrackedText(
      ownedWindow,
      window.text,
      Object.freeze(runs),
      Object.freeze([]),
      gap(window.start, window.start),
      Symbol('repair candidate'),
    )
  }

  static rewrite(edit: ProducerEdit): TrackedText {
    const built = construct(edit)
    if (built.text !== edit.expected)
      invalid('producer reconstruction', {
        actualLength: built.text.length,
        expectedLength: edit.expected.length,
        site: edit.site,
      })
    const token = Symbol('repair candidate')
    const receipt = Object.freeze({
      input: edit.input.token,
      output: token,
      owner: edit.owner,
      site: edit.site,
      inputLength: edit.input.text.length,
      outputLength: built.text.length,
      copies: Object.freeze(built.copies),
      deletions: Object.freeze(built.deletions),
      insertions: Object.freeze(built.insertions),
    })
    return new TrackedText(
      edit.input.window,
      built.text,
      Object.freeze(built.runs),
      Object.freeze(edit.input.receipts.concat([receipt])),
      built.emptyGap,
      token,
    )
  }

  slice(start: number, length: number): readonly OriginRun[] {
    localSpan(this, start, length)
    const result: OriginRun[] = []
    let offset = 0
    for (const run of this.runs) {
      const from = Math.max(start, offset)
      const to = Math.min(start + length, offset + runLength(run))
      if (from < to) appendRun(result, sliceRun(run, from - offset, to - from))
      offset += runLength(run)
    }
    return Object.freeze(result)
  }

  boundary(offset: number): Gap {
    localSpan(this, offset, 0)
    if (!this.runs.length) return this.emptyGap
    let cursor = 0
    let previous: OriginRun | undefined
    for (const run of this.runs) {
      const end = cursor + runLength(run)
      if (offset > cursor && offset < end)
        return run.kind === 'insert'
          ? run.gap
          : gap(run.source.start + offset - cursor, run.source.start + offset - cursor)
      if (offset === cursor) return joinBoundary(previous, run)
      previous = run
      cursor = end
    }
    if (!previous) invalid('nonempty boundary run', { offset })
    if (previous.kind === 'insert') return previous.gap
    return gap(runRight(previous), runRight(previous))
  }

  project(start: number, length: number): ProjectedOrigin {
    localSpan(this, start, length)
    if (length === 0) {
      const seam = this.boundary(start)
      return Object.freeze({ kind: 'boundary', at: seam.left, gap: seam })
    }
    const runs = this.slice(start, length)
    const copies = runs.filter((run) => run.kind === 'copy')
    const first = copies.at(0)
    const last = copies.at(-1)
    if (first && last)
      return Object.freeze({
        kind: 'authored',
        span: Object.freeze({
          start: first.source.start,
          length: runRight(last) - first.source.start,
        }),
        runs,
      })
    const synthetic = runs.at(0)
    if (!synthetic || synthetic.kind !== 'insert') invalid('nonempty projection', { start, length })
    return Object.freeze({ kind: 'synthetic', at: synthetic.gap.left, runs })
  }
}

function joinBoundary(previous: OriginRun | undefined, next: OriginRun): Gap {
  let left = runLeft(next)
  if (previous?.kind === 'insert') left = previous.gap.left
  if (previous?.kind === 'copy') left = runRight(previous)
  const right = next.kind === 'insert' ? next.gap.right : runLeft(next)
  const previousRight = previous?.kind === 'insert' ? previous.gap.right : left
  return gap(Math.min(left, runLeft(next)), Math.max(previousRight, right))
}

function sliceRun(run: OriginRun, start: number, length: number): OriginRun {
  if (run.kind === 'copy')
    return Object.freeze({
      kind: 'copy',
      source: Object.freeze({ start: toAuthoredOffset(run.source.start + start), length }),
    })
  return Object.freeze({ ...run, text: run.text.slice(start, start + length) })
}

function insertionGap(cause: LocalSpan): Gap {
  if (cause.length === 0) return cause.input.boundary(cause.start)
  const runs = cause.input.slice(cause.start, cause.length)
  const first = runs.at(0)
  const last = runs.at(-1)
  if (!first || !last) invalid('nonempty insertion cause', { length: cause.length })
  return gap(runLeft(first), runRight(last))
}

function construct(edit: ProducerEdit) {
  const runs: OriginRun[] = []
  const chunks: string[] = []
  const copies: { start: LocalOffset; length: number }[] = []
  const deletions: { start: LocalOffset; length: number }[] = []
  const insertions: {
    at: number
    length: number
    cause: Readonly<{ start: LocalOffset; length: number }>
    gap: Gap
  }[] = []
  let copiedUntil = 0
  let outputLength = 0
  for (const part of edit.parts) {
    const span = part.kind === 'copy' ? part.source : part.cause
    if (!span.belongsTo(edit.input)) invalid('candidate identity', { site: edit.site })
    if (part.kind === 'insert') {
      const at = insertionGap(part.cause)
      chunks.push(part.text)
      appendRun(
        runs,
        Object.freeze({ kind: 'insert', text: part.text, owner: edit.owner, gap: at }),
      )
      insertions.push(
        Object.freeze({
          at: outputLength,
          length: part.text.length,
          cause: Object.freeze({ start: span.start, length: span.length }),
          gap: at,
        }),
      )
      outputLength += part.text.length
      continue
    }
    if (span.start < copiedUntil)
      invalid('ordered nonoverlapping copies', { start: span.start, copiedUntil })
    if (span.start > copiedUntil)
      deletions.push(
        Object.freeze({ start: copiedUntil as LocalOffset, length: span.start - copiedUntil }),
      )
    copies.push(Object.freeze({ start: span.start, length: span.length }))
    chunks.push(edit.input.text.slice(span.start, span.start + span.length))
    for (const run of edit.input.slice(span.start, span.length)) appendRun(runs, run)
    copiedUntil = span.start + span.length
    outputLength += span.length
  }
  if (copiedUntil < edit.input.text.length)
    deletions.push(
      Object.freeze({
        start: copiedUntil as LocalOffset,
        length: edit.input.text.length - copiedUntil,
      }),
    )
  const emptyGap = gap(
    edit.input.boundary(0).left,
    edit.input.boundary(edit.input.text.length).right,
  )
  return { text: chunks.join(''), runs, copies, deletions, insertions, emptyGap }
}

export function beginRepair(window: AuthoredWindow): TrackedText {
  return TrackedText.begin(window)
}

export function rewrite(edit: ProducerEdit): TrackedText {
  return TrackedText.rewrite(edit)
}
