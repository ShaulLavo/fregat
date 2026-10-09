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
) => Promise<readonly MergeReviewUnit[] | null>
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

type Touch = { readonly edit: ConcurrentEdit; readonly unit: MergeReviewUnit }
type Candidate = { readonly unit: MergeReviewUnit; readonly pairs: ConcurrentPair[] }
const keyOf = (id: EditId) => JSON.stringify([id.actor, id.seq])
const lastOf = (span: IdSpan): CharId => ({
  bunch: span.start.bunch,
  counter: span.start.counter + span.count - 1,
})

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
    const active = new Map<ConcurrentEdit, boolean>()
    const activePairs = pairs.filter((pair) =>
      pair.every((edit) => {
        if (!active.has(edit)) active.set(edit, engine.effectActive(edit.envelope.id))
        return active.get(edit)
      }),
    )
    if (!activePairs.length) return { status: 'complete', marks: [] }
    const edits = new Set<ConcurrentEdit>()
    for (const pair of activePairs) for (const edit of pair) edits.add(edit)
    const ranges = [...edits.values()].flatMap((edit) =>
      touchedRanges(confirmed.buffer, edit).map((range) => ({ edit, range })),
    )
    const units = await this.syntax(
      confirmed.buffer,
      ranges.map((entry) => entry.range),
    )
    if (!units || units.length !== ranges.length) return { status: 'unavailable', marks: [] }
    const touches = new Map<ConcurrentEdit, Touch[]>()
    for (let index = 0; index < ranges.length; index++) {
      const edit = ranges[index]!.edit
      const entries = touches.get(edit) ?? []
      const unit = units[index]!
      if (!entries.some((entry) => sameUnit(entry.unit, unit))) entries.push({ edit, unit })
      touches.set(edit, entries)
    }
    for (const [key, entries] of touches) {
      touches.set(
        key,
        entries.filter(
          (entry) =>
            !entries.some(
              (other) =>
                !sameUnit(entry.unit, other.unit) &&
                entry.unit.startIndex <= other.unit.startIndex &&
                entry.unit.endIndex >= other.unit.endIndex,
            ),
        ),
      )
    }
    for (const [key, entries] of touches) {
      const edit = key
      if (edit.inserted.length || !edit.deleted.length) continue
      const base = engine.projectEffects(
        [...edits.values()]
          .filter((entry) => entry.envelope.id.actor === edit.envelope.id.actor)
          .map((entry) => ({ op: entry.envelope.id, active: false })),
      ).buffer
      const original = await this.syntax(base, touchedRanges(base, edit))
      if (!original) return { status: 'unavailable', marks: [] }
      touches.set(
        key,
        entries.filter((entry) => {
          const first = charIdAt(confirmed.buffer, entry.unit.startIndex)
          const location = first && locateCharId(base, first)
          return (
            location &&
            original.some(
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
    const marks = new Map<string, MergeReviewMark>()
    for (const pair of activePairs) {
      const left = touches.get(pair[0]) ?? []
      const right = touches.get(pair[1]) ?? []
      collectCandidates(confirmed.buffer, pair, left, right, candidates, marks)
      if (!sharedDeletion(pair) || left.some((a) => right.some((b) => sameUnit(a.unit, b.unit))))
        continue
      const combined = [...left, ...right].map((touch) => touch.unit)
      if (!combined.length) continue
      const range = {
        startIndex: Math.min(...combined.map((unit) => unit.startIndex)),
        endIndex: Math.max(...combined.map((unit) => unit.endIndex)),
      }
      const unit = (await this.syntax(confirmed.buffer, [range]))?.[0]
      if (!unit) return { status: 'unavailable', marks: [] }
      const unitId = unitIdentity(confirmed.buffer, unit)
      const candidate = candidates.get(unitId) ?? { unit, pairs: [] }
      candidate.pairs.push(pair)
      candidates.set(unitId, candidate)
    }
    for (const [unitId, candidate] of candidates) {
      const versions = await this.versions(engine, candidate)
      if (!versions) return { status: 'unavailable', marks: [] }
      const meaningful = candidate.pairs.filter((pair) =>
        pair.every((edit) => !versions.formatting.has(keyOf(edit.envelope.id))),
      )
      if (meaningful.length) addMark(marks, 'overlap', unitId, candidate.unit, meaningful)
      if (candidate.unit.hasErrors && versions.clean)
        addMark(marks, 'parse', unitId, candidate.unit, candidate.pairs)
    }
    for (const pair of activePairs) {
      if (!orphanPair(pair)) continue
      const orphan = await this.orphan(engine, pair)
      if (orphan === null) return { status: 'unavailable', marks: [] }
      for (const unit of orphan)
        addMark(marks, 'orphan', unitIdentity(confirmed.buffer, unit), unit, [pair])
    }
    return {
      status: 'complete',
      marks: [...marks.values()].sort(
        (a, b) => compare(a.unitId, b.unitId) || compare(a.kind, b.kind),
      ),
    }
  }

  private async versions(engine: TextbufferEngine, candidate: Candidate) {
    const edits = new Map<string, ConcurrentEdit>()
    for (const pair of candidate.pairs)
      for (const edit of pair) edits.set(keyOf(edit.envelope.id), edit)
    const needsVersions =
      candidate.unit.hasErrors ||
      [...edits.values()].some((edit) => {
        return /^\s*$/.test(insertedText(edit))
      })
    if (!needsVersions) return { clean: false, formatting: new Set<string>() }
    const current = engine.snapshot().buffer
    const formatting = new Set<string>()
    const authors = new Set([...edits.values()].map((edit) => edit.envelope.id.actor))
    let clean = true
    let base: MergeReviewUnit | undefined
    for (const actor of authors) {
      const selected = [...edits.values()].filter((edit) => edit.envelope.id.actor !== actor)
      const projected = engine.projectEffects(
        selected.map((edit) => ({ op: edit.envelope.id, active: false })),
      ).buffer
      const range = projectedRange(current, projected, candidate.unit)
      const unit = (await this.syntax(projected, [range], true))?.[0]
      if (!unit) return null
      clean &&= !unit.hasErrors
      for (const edit of edits.values()) {
        if (edit.envelope.id.actor !== actor || !whitespaceEdit(edit, engine)) continue
        if (!base) {
          const before = engine.projectEffects(
            [...edits.values()].map((entry) => ({ op: entry.envelope.id, active: false })),
          ).buffer
          base = (
            await this.syntax(before, [projectedRange(current, before, candidate.unit)], true)
          )?.[0]
          if (!base) return null
        }
        if (base.contentKey !== undefined && base.contentKey === unit.contentKey)
          formatting.add(keyOf(edit.envelope.id))
      }
    }
    return { clean, formatting }
  }

  private async orphan(engine: TextbufferEngine, pair: ConcurrentPair) {
    const base = engine.projectEffects(
      pair.map((edit) => ({ op: edit.envelope.id, active: false })),
    ).buffer
    const result: MergeReviewUnit[] = []
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
        await this.syntax(base, [{ startIndex: left.offset, endIndex: right.offset + 1 }])
      )?.[0]
      if (!unit) return null
      const covered = charIdSpansInRange(base, unit.startIndex, unit.endIndex).every((span) =>
        spanCovered(span, deletion.deleted),
      )
      if (!covered) continue
      const current = engine.snapshot().buffer
      for (const span of insertion.inserted) {
        const location = locateCharId(current, span.start)
        if (!location || location.liveness !== 'live') continue
        const stranded = (
          await this.syntax(current, [
            { startIndex: location.offset, endIndex: location.offset + 1 },
          ])
        )?.[0]
        if (!stranded) return null
        result.push(stranded)
      }
    }
    return result
  }
}

function touchedRanges(snapshot: PieceTableSnapshot, edit: ConcurrentEdit): MergeReviewRange[] {
  const ranges: MergeReviewRange[] = []
  const spans = edit.inserted.length ? edit.inserted : edit.deleted
  for (const span of spans) {
    for (let counter = span.start.counter; counter < span.start.counter + span.count;) {
      const location = locateCharId(snapshot, { bunch: span.start.bunch, counter })
      if (!location) break
      const startIndex = location.offset
      const endIndex = startIndex + Number(location.liveness === 'live')
      if (!ranges.some((range) => range.startIndex === startIndex && range.endIndex === endIndex))
        ranges.push({ startIndex, endIndex })
      counter +=
        location.liveness === 'live'
          ? 1
          : Math.min(
              span.start.counter + span.count - counter,
              location.piece.start + location.piece.length - location.unit,
            )
    }
  }
  return ranges
}

function sharedDeletion(pair: ConcurrentPair): boolean {
  return pair[0].deleted.some((left) =>
    pair[1].deleted.some(
      (right) =>
        left.start.bunch === right.start.bunch &&
        left.start.counter < right.start.counter + right.count &&
        right.start.counter < left.start.counter + left.count,
    ),
  )
}

function collectCandidates(
  snapshot: PieceTableSnapshot,
  pair: ConcurrentPair,
  left: readonly Touch[],
  right: readonly Touch[],
  candidates: Map<string, Candidate>,
  marks: Map<string, MergeReviewMark>,
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
      addMark(marks, 'signature', unitIdentity(snapshot, a.unit), a.unit, [pair])
      addMark(marks, 'signature', unitIdentity(snapshot, b.unit), b.unit, [pair])
    }
  }
}

function addMark(
  marks: Map<string, MergeReviewMark>,
  kind: MergeReviewMark['kind'],
  unitId: string,
  unit: MergeReviewUnit,
  pairs: readonly ConcurrentPair[],
): void {
  const key = JSON.stringify([kind, unitId])
  const previous = marks.get(key)
  const edges = new Map<string, readonly [EditId, EditId]>()
  for (const pair of previous?.pairs ?? []) edges.set(JSON.stringify(pair), pair)
  for (const pair of pairs) {
    const edge = pair
      .map((edit) => edit.envelope.id)
      .toSorted((a, b) => compare(keyOf(a), keyOf(b))) as [EditId, EditId]
    edges.set(JSON.stringify(edge), edge)
  }
  const edits = new Map<string, EditId>()
  for (const edge of edges.values()) for (const edit of edge) edits.set(keyOf(edit), edit)
  marks.set(key, {
    kind,
    unitId,
    unit,
    authors: [...new Set([...edits.values()].map((edit) => edit.actor))].sort(compare),
    edits: [...edits.values()].sort((a, b) => compare(keyOf(a), keyOf(b))),
    pairs: [...edges.values()].sort((a, b) => compare(JSON.stringify(a), JSON.stringify(b))),
  })
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
    .toSorted((a, b) => a.start.counter - b.start.counter)) {
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
function whitespaceEdit(edit: ConcurrentEdit, engine: TextbufferEngine): boolean {
  if (!/^\s*$/.test(insertedText(edit))) return false
  const before = engine.projectEffects([{ op: edit.envelope.id, active: false }]).buffer
  return edit.deleted.every((span) => {
    const first = locateCharId(before, span.start)
    const last = locateCharId(before, lastOf(span))
    return (
      first &&
      last &&
      /^\s*$/.test(
        readPieceTableTextRange(
          before,
          first.offset,
          last.offset + Number(last.liveness === 'live'),
        ),
      )
    )
  })
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
  const unquoted = /^(["']).*\1$/.test(signature) ? signature.slice(1, -1) : signature
  return unquoted
    .replace(
      /\\u\{([\da-fA-F]+)\}|\\u([\da-fA-F]{4})|\\x([\da-fA-F]{2})/g,
      (match, point, unit, byte) => {
        const code = Number.parseInt(point ?? unit ?? byte, 16)
        return code <= 0x10ffff ? String.fromCodePoint(code) : match
      },
    )
    .replace(/\\([\\"'])/g, '$1')
}

function orphanPair(pair: ConcurrentPair): boolean {
  if (pair.every((edit) => edit.deleted.reduce((count, span) => count + span.count, 0) < 2))
    return false
  return [pair, [pair[1], pair[0]]].some(([deletion, insertion]) => {
    const change = insertion.envelope.change
    if (change.kind !== 'insert' && change.kind !== 'replace') return false
    const insert = change.kind === 'insert' ? change : change.insert
    return (
      insert &&
      insertion.inserted.length &&
      typeof insert.originLeft !== 'string' &&
      typeof insert.originRight !== 'string' &&
      insideSpans(insert.originLeft, deletion.deleted) &&
      insideSpans(insert.originRight, deletion.deleted)
    )
  })
}
