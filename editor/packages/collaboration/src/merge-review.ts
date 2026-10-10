import { TextbufferEngine } from '@singapore-editor/collab'
import type {
  CharId,
  ConcurrentEdit,
  ConcurrentPair,
  ConfirmedWindow,
  EditId,
  IdSpan,
  TextbufferSnapshot,
} from '@singapore-editor/collab'
import {
  charIdAt,
  charIdSpansInRange,
  locateCharId,
  readPieceTableTextRange,
} from '@singapore-editor/textbuffer'
import type { PieceTableSnapshot } from '@singapore-editor/textbuffer'

export type MergeReviewRange = { readonly startIndex: number; readonly endIndex: number }
export type MergeReviewUnit = MergeReviewRange & {
  readonly type: string
  readonly languageId: string
  readonly signature: string | null
  readonly hasErrors: boolean
  /** A syntax shape and leaf spelling key, excluding whitespace between tokens. */
  readonly contentKey?: string
  readonly parent: (MergeReviewRange & { readonly commutative: boolean }) | null
}
export type MergeReviewSyntax = (
  snapshot: PieceTableSnapshot,
  ranges: readonly MergeReviewRange[],
  contentKey?: boolean,
  selection?: 'enclosing' | 'touching',
  baseSnapshot?: PieceTableSnapshot,
) => Promise<readonly (readonly MergeReviewUnit[])[] | null>
export type MergeReviewMark = {
  readonly kind: 'overlap' | 'parse' | 'signature' | 'orphan'
  readonly unitId: string
  readonly unit: MergeReviewUnit
  readonly authors: readonly string[]
  readonly edits: readonly EditId[]
  /** Exact edges, since concurrency is not transitive. */
  readonly pairs: readonly (readonly [EditId, EditId])[]
}
export type MergeReviewResult =
  | { readonly status: 'complete'; readonly marks: readonly MergeReviewMark[] }
  | { readonly status: 'unavailable'; readonly marks: readonly [] }

type Touch = { readonly unit: MergeReviewUnit; readonly ranges: MergeReviewRange[] }
type ReviewState = {
  readonly engine: TextbufferEngine
  readonly current: PieceTableSnapshot
  readonly before: Map<string, PieceTableSnapshot>
  readonly formatting: Map<string, boolean>
}
type Candidate = { readonly unit: MergeReviewUnit; readonly pairs: ConcurrentPair[] }
type MarkAccumulator = Pick<MergeReviewMark, 'kind' | 'unitId' | 'unit'> & {
  readonly edges: Map<string, readonly [EditId, EditId]>
}
const keyOf = (id: EditId) => JSON.stringify([id.actor, id.seq])

/** Demand-only review over a confirmed snapshot. Pending editor state is never an input. */
export class MergeReviewDetector {
  constructor(private readonly syntax: MergeReviewSyntax) {}

  async detect(
    window: ConfirmedWindow | null,
    confirmed: TextbufferSnapshot,
    batch?: readonly EditId[],
  ): Promise<MergeReviewResult> {
    if (!window) return { status: 'complete', marks: [] }
    const pairs = window.pairs(batch)
    if (!pairs.length) return { status: 'complete', marks: [] }
    const engine = new TextbufferEngine()
    engine.restore(confirmed)
    const state: ReviewState = {
      engine,
      current: confirmed.buffer,
      before: new Map(),
      formatting: new Map(),
    }
    const involved = new Set<ConcurrentEdit>()
    for (const [left, right] of pairs) {
      involved.add(left)
      involved.add(right)
    }
    const active = new Set([...involved].filter((edit) => engine.effectActive(edit.envelope.id)))
    const activePairs =
      active.size === involved.size
        ? pairs
        : pairs.filter(([left, right]) => active.has(left) && active.has(right))
    if (!activePairs.length) return { status: 'complete', marks: [] }
    const edits =
      active.size === involved.size ? involved : new Set(activePairs.flatMap((pair) => [...pair]))
    const ranges = [...edits.values()].flatMap((edit) =>
      touchedRanges(confirmed.buffer, edit).map((range) => ({ edit, range })),
    )
    const units = await this.syntax(
      confirmed.buffer,
      ranges.map((entry) => entry.range),
      false,
      'touching',
    )
    if (!units || units.length !== ranges.length || units.some((group) => !group.length))
      return { status: 'unavailable', marks: [] }
    const grouped = new Map<ConcurrentEdit, Map<string, Touch>>()
    for (let index = 0; index < ranges.length; index++) {
      const { edit, range } = ranges[index]!
      const entries = grouped.get(edit) ?? new Map<string, Touch>()
      for (const unit of units[index]!) {
        const key = rangeKey(unit)
        const entry = entries.get(key)
        const footprint = intersectRange(range, unit)
        if (entry) entry.ranges.push(footprint)
        else entries.set(key, { unit, ranges: [footprint] })
      }
      grouped.set(edit, entries)
    }
    const touches = new Map<ConcurrentEdit, Touch[]>()
    for (const [edit, entries] of grouped) {
      touches.set(edit, pruneTouches(confirmed.buffer, [...entries.values()]))
    }
    for (const [key, entries] of touches) {
      const edit = key
      if (edit.inserted.length || !edit.deleted.length) continue
      const base = without(state, [edit])
      const original = await this.syntax(
        base,
        touchedRanges(base, edit),
        false,
        'touching',
        state.current,
      )
      if (!original) return { status: 'unavailable', marks: [] }
      const originalUnits = original.flat()
      touches.set(
        key,
        entries.filter((entry) => {
          const first = charIdAt(confirmed.buffer, entry.unit.startIndex)
          const location = first && locateCharId(base, first)
          return (
            location &&
            originalUnits.some(
              (unit) =>
                unit.type === entry.unit.type &&
                unit.startIndex <= location.offset &&
                location.offset < unit.endIndex,
            )
          )
        }),
      )
    }
    const candidates = new Map<string, Candidate>()
    const marks = new Map<string, MarkAccumulator>()
    const signatures: { pair: ConcurrentPair; left: MergeReviewUnit; right: MergeReviewUnit }[] = []
    for (const pair of activePairs) {
      const left = touches.get(pair[0]) ?? []
      const right = touches.get(pair[1]) ?? []
      collectCandidates(confirmed.buffer, pair, left, right, candidates, signatures)
      if (!sharedDeletion(pair)) continue
      const combined = left.concat(right).map((touch) => touch.unit)
      if (!combined.length || combined.every((unit) => sameUnit(unit, combined[0]!))) continue
      const range = combined.reduce(
        (range, unit) => ({
          startIndex: Math.min(range.startIndex, unit.startIndex),
          endIndex: Math.max(range.endIndex, unit.endIndex),
        }),
        { startIndex: confirmed.buffer.length, endIndex: 0 },
      )
      const unit = (await this.syntax(confirmed.buffer, [range]))?.[0]?.[0]
      if (!unit) return { status: 'unavailable', marks: [] }
      const unitId = unitIdentity(confirmed.buffer, unit)
      const candidate = candidates.get(unitId) ?? { unit, pairs: [] }
      candidate.pairs.push(pair)
      candidates.set(unitId, candidate)
    }
    for (const [unitId, candidate] of candidates) {
      const meaningful = await this.meaningful(state, candidate.unit, candidate.pairs)
      if (!meaningful) return { status: 'unavailable', marks: [] }
      if (!meaningful.length) continue
      addMark(marks, 'overlap', unitId, candidate.unit, meaningful)
      if (!candidate.unit.hasErrors) continue
      const clean = await this.cleanVersions(state, { ...candidate, pairs: meaningful })
      if (clean === null) return { status: 'unavailable', marks: [] }
      if (clean) addMark(marks, 'parse', unitId, candidate.unit, meaningful)
    }
    for (const { pair, left, right } of signatures) {
      const a = await this.formattingEdit(state, pair[0], left)
      const b = await this.formattingEdit(state, pair[1], right)
      if (a === null || b === null) return { status: 'unavailable', marks: [] }
      if (a || b) continue
      const introduced = await this.introducedSignature(state, pair, left, right)
      if (introduced === null) return { status: 'unavailable', marks: [] }
      if (!introduced) continue
      addMark(marks, 'signature', unitIdentity(state.current, left), left, [pair])
      addMark(marks, 'signature', unitIdentity(state.current, right), right, [pair])
    }
    for (const pair of activePairs) {
      if (!orphanPair(pair)) continue
      const orphan = await this.orphan(state, pair)
      if (orphan === null) return { status: 'unavailable', marks: [] }
      for (const unit of orphan)
        addMark(marks, 'orphan', unitIdentity(confirmed.buffer, unit), unit, [pair])
    }
    return {
      status: 'complete',
      marks: Array.from(marks.values(), finalizeMark).sort(
        (a, b) => compare(a.unitId, b.unitId) || compare(a.kind, b.kind),
      ),
    }
  }

  private async meaningful(
    state: ReviewState,
    unit: MergeReviewUnit,
    pairs: readonly ConcurrentPair[],
  ) {
    const meaningful: ConcurrentPair[] = []
    for (const pair of pairs) {
      let keep = true
      for (const edit of pair) {
        const formatting = await this.formattingEdit(state, edit, unit)
        if (formatting === null) return null
        keep &&= !formatting
      }
      if (keep) meaningful.push(pair)
    }
    return meaningful
  }

  private async formattingEdit(
    state: ReviewState,
    edit: ConcurrentEdit,
    unit: MergeReviewUnit,
  ): Promise<boolean | null> {
    if (!/^\s*$/.test(insertedText(edit))) return false
    const key = JSON.stringify([keyOf(edit.envelope.id), unitIdentity(state.current, unit)])
    const cached = state.formatting.get(key)
    if (cached !== undefined) return cached
    const before = without(state, [edit])
    if (!whitespaceEdit(edit, before)) return false
    const afterUnit = (await this.syntax(state.current, [unit], true))?.[0]?.[0]
    const beforeUnit = (
      await this.syntax(
        before,
        [projectedRange(state.current, before, unit)],
        true,
        'enclosing',
        state.current,
      )
    )?.[0]?.[0]
    if (!afterUnit || !beforeUnit) return null
    const formatting =
      afterUnit.contentKey !== undefined && afterUnit.contentKey === beforeUnit.contentKey
    state.formatting.set(key, formatting)
    return formatting
  }

  private async cleanVersions(state: ReviewState, candidate: Candidate) {
    const edits = new Set(candidate.pairs.flatMap((pair) => pair))
    const authors = new Set(Array.from(edits, (edit) => edit.envelope.id.actor))
    for (const actor of authors) {
      const projected = without(
        state,
        [...edits].filter((edit) => edit.envelope.id.actor !== actor),
      )
      const unit = (
        await this.syntax(
          projected,
          [projectedRange(state.current, projected, candidate.unit)],
          false,
          'enclosing',
          state.current,
        )
      )?.[0]?.[0]
      if (!unit) return null
      if (unit.hasErrors) return false
    }
    return true
  }

  private async introducedSignature(
    state: ReviewState,
    pair: ConcurrentPair,
    left: MergeReviewUnit,
    right: MergeReviewUnit,
  ) {
    const before = without(state, pair)
    for (const unit of [left, right]) {
      const range = projectedRange(state.current, before, unit)
      if (range.startIndex === range.endIndex) return true
      const previous = (
        await this.syntax(before, [range], false, 'enclosing', state.current)
      )?.[0]?.[0]
      if (!previous) return null
      if (previous.type !== unit.type || normalizeSignature(previous) !== normalizeSignature(unit))
        return true
    }
    return false
  }

  private async orphan(state: ReviewState, pair: ConcurrentPair) {
    const base = without(state, pair)
    const result = new Map<string, MergeReviewUnit>()
    for (const [deletion, insertion] of [pair, [pair[1], pair[0]]] as const) {
      if (!deletion.deleted.length || !insertion.inserted.length) continue
      const change = insertion.envelope.change
      if (change.kind !== 'insert' && change.kind !== 'replace') continue
      const insert = change.kind === 'insert' ? change : change.insert
      if (typeof insert.originLeft === 'string' || typeof insert.originRight === 'string') continue
      const left = locateCharId(base, insert.originLeft)
      const right = locateCharId(base, insert.originRight)
      if (!left || !right || !insideSpans(insert.originLeft, deletion.deleted)) continue
      if (!insideSpans(insert.originRight, deletion.deleted)) continue
      const unit = (
        await this.syntax(
          base,
          [{ startIndex: left.offset, endIndex: right.offset + 1 }],
          false,
          'enclosing',
          state.current,
        )
      )?.[0]?.[0]
      if (!unit) return null
      const covered = charIdSpansInRange(base, unit.startIndex, unit.endIndex).every((span) =>
        spanCovered(span, deletion.deleted),
      )
      if (!covered) continue
      const current = state.current
      const stranded = await this.syntax(
        current,
        spanRanges(current, insertion.inserted, false),
        false,
        'touching',
      )
      if (!stranded) return null
      for (const unit of stranded.flat()) result.set(rangeKey(unit), unit)
    }
    return [...result.values()]
  }
}

function without(state: ReviewState, edits: readonly ConcurrentEdit[]): PieceTableSnapshot {
  const key = JSON.stringify(edits.map((edit) => keyOf(edit.envelope.id)).sort(compare))
  let before = state.before.get(key)
  if (!before) {
    before = state.engine.projectEffects(
      edits.map((edit) => ({ op: edit.envelope.id, active: false })),
    ).buffer
    state.before.set(key, before)
  }
  return before
}

function touchedRanges(snapshot: PieceTableSnapshot, edit: ConcurrentEdit): MergeReviewRange[] {
  return coalesceRanges(
    spanRanges(snapshot, edit.inserted, false).concat(spanRanges(snapshot, edit.deleted, true)),
  )
}

function spanRanges(
  snapshot: PieceTableSnapshot,
  spans: readonly IdSpan[],
  hidden: boolean,
): MergeReviewRange[] {
  const ranges: MergeReviewRange[] = []
  for (const span of spans) {
    const end = span.start.counter + span.count
    for (let counter = span.start.counter; counter < end;) {
      const location = locateCharId(snapshot, { bunch: span.start.bunch, counter })
      if (!location) break
      const count = Math.min(
        end - counter,
        location.piece.start + location.piece.length - location.unit,
      )
      if (location.liveness === 'live')
        ranges.push({ startIndex: location.offset, endIndex: location.offset + count })
      else if (hidden) ranges.push({ startIndex: location.offset, endIndex: location.offset })
      counter += count
    }
  }
  return coalesceRanges(ranges)
}

function coalesceRanges(ranges: MergeReviewRange[]): MergeReviewRange[] {
  const result: MergeReviewRange[] = []
  for (const range of ranges.sort(
    (a, b) => a.startIndex - b.startIndex || a.endIndex - b.endIndex,
  )) {
    const previous = result.at(-1)
    if (previous && range.startIndex <= previous.endIndex) {
      result[result.length - 1] = {
        startIndex: previous.startIndex,
        endIndex: Math.max(previous.endIndex, range.endIndex),
      }
      continue
    }
    result.push(range)
  }
  return result
}

function intersectRange(range: MergeReviewRange, unit: MergeReviewUnit): MergeReviewRange {
  return {
    startIndex: Math.max(range.startIndex, unit.startIndex),
    endIndex: Math.min(range.endIndex, unit.endIndex),
  }
}

function pruneTouches(snapshot: PieceTableSnapshot, entries: readonly Touch[]): Touch[] {
  const children = new Map<Touch, Touch[]>()
  const stack: Touch[] = []
  for (const entry of entries.toSorted(
    (a, b) => a.unit.startIndex - b.unit.startIndex || b.unit.endIndex - a.unit.endIndex,
  )) {
    while (stack.length && !containsUnit(stack.at(-1)!.unit, entry.unit)) stack.pop()
    const parent = stack.at(-1)
    if (parent) {
      const nested = children.get(parent) ?? []
      nested.push(entry)
      children.set(parent, nested)
    }
    stack.push(entry)
  }
  return entries.filter((entry) => !coveredTouch(snapshot, entry, children.get(entry) ?? []))
}

function containsUnit(parent: MergeReviewUnit, child: MergeReviewUnit): boolean {
  return parent.startIndex <= child.startIndex && parent.endIndex >= child.endIndex
}

function rangeKey(unit: MergeReviewUnit): string {
  return JSON.stringify([unit.languageId, unit.type, unit.startIndex, unit.endIndex])
}

function coveredTouch(
  snapshot: PieceTableSnapshot,
  entry: Touch,
  nested: readonly Touch[],
): boolean {
  if (!nested.length) return false
  const coverage = coalesceRanges(nested.map((other) => other.unit))
  return entry.ranges.every((range) => {
    let cursor = range.startIndex
    for (const unit of coverage) {
      if (unit.endIndex < cursor || unit.startIndex > range.endIndex) continue
      if (unit.startIndex > cursor && !ignorableGap(snapshot, cursor, unit.startIndex, nested))
        return false
      cursor = Math.max(cursor, unit.endIndex)
      if (cursor >= range.endIndex) return true
    }
    return ignorableGap(snapshot, cursor, range.endIndex, nested)
  })
}

function ignorableGap(
  snapshot: PieceTableSnapshot,
  start: number,
  end: number,
  nested: readonly Touch[],
): boolean {
  if (end <= start) return true
  const text = readPieceTableTextRange(snapshot, start, end)
  return (
    /^[\s,;]*$/.test(text) &&
    nested.some(
      (entry) =>
        entry.unit.parent?.commutative &&
        entry.unit.parent.startIndex <= start &&
        entry.unit.parent.endIndex >= end,
    )
  )
}

function sharedDeletion(pair: ConcurrentPair): boolean {
  for (const left of pair[0].deleted)
    for (const right of pair[1].deleted)
      if (
        left.start.bunch === right.start.bunch &&
        left.start.counter < right.start.counter + right.count &&
        right.start.counter < left.start.counter + left.count
      )
        return true
  return false
}

function collectCandidates(
  snapshot: PieceTableSnapshot,
  pair: ConcurrentPair,
  left: readonly Touch[],
  right: readonly Touch[],
  candidates: Map<string, Candidate>,
  signatures: { pair: ConcurrentPair; left: MergeReviewUnit; right: MergeReviewUnit }[],
): void {
  for (const a of left) {
    for (const b of right) {
      if (sameUnit(a.unit, b.unit)) {
        const key = unitIdentity(snapshot, a.unit)
        const candidate = candidates.get(key) ?? { unit: a.unit, pairs: [] }
        if (!candidate.pairs.includes(pair)) candidate.pairs.push(pair)
        if (candidate.pairs.length) candidates.set(key, candidate)
        continue
      }
      if (!sameCommutativeParent(a.unit, b.unit)) continue
      const signatureA = normalizeSignature(a.unit)
      if (signatureA === null || signatureA !== normalizeSignature(b.unit)) continue
      signatures.push({ pair, left: a.unit, right: b.unit })
    }
  }
}

function addMark(
  marks: Map<string, MarkAccumulator>,
  kind: MergeReviewMark['kind'],
  unitId: string,
  unit: MergeReviewUnit,
  pairs: readonly ConcurrentPair[],
): void {
  const key = JSON.stringify([kind, unitId])
  const mark = marks.get(key) ?? {
    kind,
    unitId,
    unit,
    edges: new Map<string, readonly [EditId, EditId]>(),
  }
  for (const pair of pairs) {
    const edge = pair
      .map((edit) => edit.envelope.id)
      .sort((a, b) => compare(keyOf(a), keyOf(b))) as [EditId, EditId]
    mark.edges.set(JSON.stringify(edge), edge)
  }
  marks.set(key, mark)
}

function finalizeMark(mark: MarkAccumulator): MergeReviewMark {
  const edits = new Map<string, EditId>()
  for (const edge of mark.edges.values()) for (const edit of edge) edits.set(keyOf(edit), edit)
  return {
    kind: mark.kind,
    unitId: mark.unitId,
    unit: mark.unit,
    authors: [...new Set(Array.from(edits.values(), (edit) => edit.actor))].sort(compare),
    edits: [...edits.values()].sort((a, b) => compare(keyOf(a), keyOf(b))),
    pairs: [...mark.edges.values()].sort((a, b) => compare(JSON.stringify(a), JSON.stringify(b))),
  }
}

function unitIdentity(snapshot: PieceTableSnapshot, unit: MergeReviewUnit): string {
  const first = charIdAt(snapshot, unit.startIndex)
  return JSON.stringify([unit.type, first?.bunch ?? 'end', first?.counter ?? 0])
}
function sameUnit(a: MergeReviewUnit, b: MergeReviewUnit): boolean {
  return (
    a.startIndex === b.startIndex &&
    a.endIndex === b.endIndex &&
    a.type === b.type &&
    a.languageId === b.languageId
  )
}
function sameCommutativeParent(a: MergeReviewUnit, b: MergeReviewUnit): boolean {
  return (
    a.languageId === b.languageId &&
    a.parent?.commutative === true &&
    b.parent?.commutative === true &&
    a.parent.startIndex === b.parent.startIndex &&
    a.parent.endIndex === b.parent.endIndex
  )
}
function compare(a: string, b: string): number {
  return a < b ? -1 : Number(a > b)
}
function insideSpans(id: CharId, spans: readonly IdSpan[]): boolean {
  return spans.some(
    (span) =>
      span.start.bunch === id.bunch &&
      span.start.counter <= id.counter &&
      id.counter < span.start.counter + span.count,
  )
}
function spanCovered(span: IdSpan, spans: readonly IdSpan[]): boolean {
  let cursor = span.start.counter
  const end = cursor + span.count
  for (const covering of spans
    .filter((entry) => entry.start.bunch === span.start.bunch)
    .sort((a, b) => a.start.counter - b.start.counter)) {
    if (covering.start.counter > cursor) break
    cursor = Math.max(cursor, covering.start.counter + covering.count)
    if (cursor >= end) return true
  }
  return false
}
function projectedRange(
  current: PieceTableSnapshot,
  projected: PieceTableSnapshot,
  range: MergeReviewRange,
): MergeReviewRange {
  const first = charIdAt(current, range.startIndex)
  const last = charIdAt(current, Math.max(range.startIndex, range.endIndex - 1))
  const startIndex = first ? (locateCharId(projected, first)?.offset ?? 0) : projected.length
  const location = last ? locateCharId(projected, last) : null
  return {
    startIndex,
    endIndex: Math.max(
      startIndex,
      location ? location.offset + Number(location.liveness === 'live') : startIndex,
    ),
  }
}
function insertedText(edit: ConcurrentEdit): string {
  const change = edit.envelope.change
  if (change.kind === 'insert') return change.text
  if (change.kind === 'replace') return change.insert.text
  return ''
}
function whitespaceEdit(edit: ConcurrentEdit, before: PieceTableSnapshot): boolean {
  return spanRanges(before, edit.deleted, false).every((range) =>
    /^\s*$/.test(readPieceTableTextRange(before, range.startIndex, range.endIndex)),
  )
}
function normalizeSignature(unit: MergeReviewUnit): string | null {
  const signature = unit.signature
  if (signature === null) return null
  if (unit.languageId === 'json') {
    try {
      return JSON.parse(signature) as string
    } catch {
      return signature
    }
  }
  if (!['javascript', 'typescript', 'tsx'].includes(unit.languageId)) return signature
  const quoted = /^(["'])[\s\S]*\1$/.test(signature)
  const unquoted = quoted ? signature.slice(1, -1) : signature
  const numeric = unquoted.replaceAll('_', '')
  if (
    !quoted &&
    /^(?:0[xX][\da-fA-F]+|0[bB][01]+|0[oO][0-7]+|(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)$/.test(
      numeric,
    )
  )
    return String(Number(numeric))
  // Decode once so a literal backslash cannot expose a second escape.
  return unquoted.replace(
    /\\(?:u\{([\da-fA-F]+)\}|u([\da-fA-F]{4})|x([\da-fA-F]{2})|([0-3][0-7]{0,2}|[4-7][0-7]?)|(\r\n|[\s\S]))/g,
    signatureEscape,
  )
}

const simpleEscapes: Readonly<Record<string, string>> = {
  b: '\b',
  f: '\f',
  n: '\n',
  r: '\r',
  t: '\t',
  v: '\v',
}
function signatureEscape(
  match: string,
  point: string | undefined,
  unit: string | undefined,
  byte: string | undefined,
  octal: string | undefined,
  character: string | undefined,
): string {
  const hex = point ?? unit ?? byte
  if (hex !== undefined) {
    const code = Number.parseInt(hex, 16)
    return code <= 0x10ffff ? String.fromCodePoint(code) : match
  }
  if (octal !== undefined) return String.fromCharCode(Number.parseInt(octal, 8))
  if (character === undefined || character === 'u' || character === 'x') return match
  if (/^[\n\r\u2028\u2029]+$/.test(character)) return ''
  return simpleEscapes[character] ?? character
}

function orphanPair(pair: ConcurrentPair): boolean {
  return orphanInsertion(pair[0], pair[1]) || orphanInsertion(pair[1], pair[0])
}

function orphanInsertion(deletion: ConcurrentEdit, insertion: ConcurrentEdit): boolean {
  const change = insertion.envelope.change
  if (change.kind !== 'insert' && change.kind !== 'replace') return false
  const insert = change.kind === 'insert' ? change : change.insert
  if (typeof insert.originLeft === 'string' || typeof insert.originRight === 'string') return false
  return (
    insertion.inserted.length > 0 &&
    insideSpans(insert.originLeft, deletion.deleted) &&
    insideSpans(insert.originRight, deletion.deleted)
  )
}
