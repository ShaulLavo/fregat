import { CollabFailure } from './failure'
import { cloneEnvelope } from './host'
import { editKey, insertionOf, sameEnvelope } from './types'
import type { EditId, Envelope, IdSpan } from './types'

export const MAX_REVIEW_EDITS = 8192

export type ConcurrentEdit = {
  readonly envelope: Envelope
  readonly inserted: readonly IdSpan[]
  readonly deleted: readonly IdSpan[]
}
export type ConcurrentPair = readonly [ConcurrentEdit, ConcurrentEdit]

type Interval = readonly [number, number]
type Confirmed = {
  readonly key: string
  readonly position: number
  readonly envelope: Envelope
  readonly ancestors: readonly Interval[]
  readonly touch: ConcurrentEdit | null
}

/** A complete confirmed log or its causal suffix, with pending and rejected edits excluded. */
export class ConfirmedWindow {
  private byId = new Map<string, Confirmed>()
  private sequence = 0
  private document: Pick<Envelope, 'document' | 'epoch'> | undefined
  private candidates: readonly Confirmed[] = []
  private positions: readonly number[] = []
  private monotone = true

  constructor(
    confirmed: readonly Envelope[] = [],
    private readonly limit = MAX_REVIEW_EDITS,
  ) {
    if (!Number.isInteger(limit) || limit < 0 || limit > MAX_REVIEW_EDITS)
      throw new CollabFailure('invalid-review-window')
    this.append(confirmed)
  }

  get edits(): readonly ConcurrentEdit[] {
    return this.candidates.map((entry) => entry.touch!)
  }

  /** Append complete confirmed batches, retaining the canonical recent suffix. */
  append(confirmed: readonly Envelope[]): void {
    const incoming = new Map<string, Envelope>()
    const first = confirmed[0]
    const document =
      this.document ?? (first ? { document: first.document, epoch: first.epoch } : undefined)
    for (const envelope of confirmed) {
      if (envelope.document !== document!.document || envelope.epoch !== document!.epoch)
        throw new CollabFailure('wrong-document-epoch')
      const key = editKey(envelope.id)
      const previous = this.byId.get(key)?.envelope ?? incoming.get(key)
      if (previous && !sameEnvelope(previous, envelope))
        throw new CollabFailure('conflicting-confirmed-edit')
      if (!this.byId.has(key)) incoming.set(key, envelope)
    }
    // Increasing Lamport order keeps every path between retained edits inside the suffix.
    const combined = [
      ...this.byId.values(),
      ...[...incoming].map(([key, envelope]) => ({ key, envelope })),
    ].sort((a, b) => compareEnvelopes(a.envelope, b.envelope))
    const ordered = this.limit ? combined.slice(-this.limit) : []
    const kept = new Set(ordered.map((entry) => entry.key))
    const next = new Map<string, Confirmed>()
    const live = liveIntervals(ordered, this.byId)
    let sequence = this.sequence
    for (const { key, envelope } of ordered) {
      if (this.byId.has(key)) continue
      const last = live.at(-1)
      if (last?.[1] === sequence) live[live.length - 1] = [last[0], sequence + 1]
      else live.push([sequence, sequence + 1])
      const predecessors = envelope.deps.flatMap((id) => {
        const dependency = editKey(id)
        const entry =
          next.get(dependency) ?? (kept.has(dependency) ? this.byId.get(dependency) : undefined)
        if (!entry) return []
        if (entry.envelope.lamport >= envelope.lamport) throw new CollabFailure('invalid-lamport')
        return [
          ...intersectIntervals(entry.ancestors, live),
          [entry.position, entry.position + 1] as const,
        ]
      })
      const copied = cloneEnvelope(envelope)
      const insertion = insertionOf(copied.change)
      const touch: ConcurrentEdit | null =
        copied.change.kind === 'setEffects'
          ? null
          : {
              envelope: copied,
              inserted: insertion ? [{ start: insertion.start, count: insertion.text.length }] : [],
              deleted: copied.change.kind === 'insert' ? [] : copied.change.spans,
            }
      next.set(key, {
        key,
        position: sequence++,
        envelope: copied,
        ancestors: mergeIntervals(predecessors),
        touch,
      })
    }
    const retained = ordered.map(({ key }) => next.get(key) ?? this.byId.get(key)!)
    for (const key of this.byId.keys()) {
      if (!kept.has(key)) this.byId.delete(key)
    }
    for (const [key, entry] of next) this.byId.set(key, entry)
    this.candidates = retained.filter((entry) => entry.touch !== null)
    this.positions = this.candidates.map((entry) => entry.position)
    this.monotone = this.positions.every(
      (position, i) => i === 0 || position > this.positions[i - 1]!,
    )
    this.sequence = sequence
    this.document = document
  }

  /** Exact pairs; a supplied batch limits results to pairs touching that batch. */
  pairs(batch?: readonly EditId[]): readonly ConcurrentPair[] {
    const authors = new Set(this.candidates.map((entry) => entry.envelope.id.actor))
    if (authors.size < 2) return []
    const selected = batch ? new Set(batch.map(editKey)) : null
    const inBatch = this.candidates.map((entry) => selected === null || selected.has(entry.key))
    const first = inBatch.indexOf(true)
    if (first === -1) return []
    const result: ConcurrentPair[] = []
    for (let right = Math.max(1, first); right < this.candidates.length; right++) {
      const later = this.candidates[right]!
      const ranges = this.monotone
        ? unseenRanges(later.ancestors, this.positions, right)
        : [[0, right] as const]
      for (const [from, to] of ranges)
        this.collectPairs(result, later, from, to, inBatch, inBatch[right]!)
    }
    return result
  }

  private collectPairs(
    result: ConcurrentPair[],
    later: Confirmed,
    from: number,
    to: number,
    inBatch: readonly boolean[],
    selected: boolean,
  ): void {
    for (let left = from; left < to; left++) {
      if (!inBatch[left] && !selected) continue
      const earlier = this.candidates[left]!
      if (earlier.envelope.id.actor === later.envelope.id.actor) continue
      if (!this.monotone && contains(later.ancestors, earlier.position)) continue
      result.push([earlier.touch!, later.touch!])
    }
  }
}

function unseenRanges(
  ancestors: readonly Interval[],
  positions: readonly number[],
  stop: number,
): readonly Interval[] {
  const result: Interval[] = []
  let cursor = 0
  for (const [from, to] of ancestors) {
    const start = lowerBound(positions, from, stop)
    const end = lowerBound(positions, to, stop)
    if (cursor < start) result.push([cursor, start])
    cursor = Math.max(cursor, end)
    if (cursor === stop) break
  }
  if (cursor < stop) result.push([cursor, stop])
  return result
}

function lowerBound(positions: readonly number[], value: number, stop: number): number {
  let low = 0
  let high = stop
  while (low < high) {
    const middle = (low + high) >>> 1
    if (positions[middle]! < value) low = middle + 1
    else high = middle
  }
  return low
}

function contains(intervals: readonly Interval[], position: number): boolean {
  let low = 0
  let high = intervals.length
  while (low < high) {
    const middle = (low + high) >>> 1
    const [from, to] = intervals[middle]!
    if (position < from) high = middle
    else if (position >= to) low = middle + 1
    else return true
  }
  return false
}

function liveIntervals(
  ordered: readonly { readonly key: string }[],
  byId: ReadonlyMap<string, Confirmed>,
): Interval[] {
  const result: [number, number][] = []
  let monotone = true
  for (const { key } of ordered) {
    const entry = byId.get(key)
    if (!entry) continue
    const position = entry.position
    const last = result.at(-1)
    if (last?.[1] === position) {
      last[1] = position + 1
      continue
    }
    if (last && position < last[1]) monotone = false
    result.push([position, position + 1])
  }
  return monotone ? result : mergeIntervals(result)
}

function intersectIntervals(
  ancestors: readonly Interval[],
  live: readonly Interval[],
): readonly Interval[] {
  const result: Interval[] = []
  let index = 0
  for (const [from, to] of ancestors) {
    while (index < live.length && live[index]![1] <= from) index++
    for (let i = index; i < live.length && live[i]![0] < to; i++) {
      result.push([Math.max(from, live[i]![0]), Math.min(to, live[i]![1])])
    }
  }
  return result
}

function mergeIntervals(intervals: readonly Interval[]): Interval[] {
  const result: Interval[] = []
  for (const [from, to] of intervals.toSorted((a, b) => a[0] - b[0])) {
    const last = result.at(-1)
    if (last && from <= last[1]) {
      result[result.length - 1] = [last[0], Math.max(last[1], to)]
      continue
    }
    result.push([from, to])
  }
  return result
}

function compareEnvelopes(a: Envelope, b: Envelope): number {
  if (a.lamport !== b.lamport) return a.lamport - b.lamport
  if (a.id.actor !== b.id.actor) return a.id.actor < b.id.actor ? -1 : 1
  return a.id.seq - b.id.seq
}
