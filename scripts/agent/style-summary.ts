import { traceNumber, traceRecord, type TraceEvent } from './trace-types'

export type StyleSummary = {
  readonly count: number
  readonly elementP90: number
  readonly elementMax: number
  readonly largeCount: number
  readonly largeDurationMs: number
  readonly writes: number
  readonly afterWriteCount: number
  readonly afterWriteDurationMs: number
}

export function summarizeStyles(events: readonly TraceEvent[]): StyleSummary {
  const candidates = events
    .filter(
      (event) => event.ph === 'X' && ['UpdateLayoutTree', 'RecalculateStyles'].includes(event.name),
    )
    .sort((a, b) => a.ts - b.ts || b.dur - a.dur)
  const recalcs: TraceEvent[] = []
  let previousEnd = -Infinity
  for (const event of candidates) {
    if (event.ts < previousEnd && event.ts + event.dur <= previousEnd) continue
    recalcs.push(event)
    previousEnd = event.ts + event.dur
  }
  const elements = recalcs.map(elementCount).sort((a, b) => a - b)
  const large = recalcs.filter((event) => elementCount(event) >= 100)
  const writes = events.filter((event) => event.name.startsWith('fregat:style-write:'))
  const afterWrites = new Set<TraceEvent>()
  for (const write of writes) {
    const next = recalcs.find((event) => event.ts >= write.ts)
    if (next) afterWrites.add(next)
  }
  return {
    count: recalcs.length,
    elementP90: elements[Math.max(0, Math.ceil(elements.length * 0.9) - 1)] ?? 0,
    elementMax: elements.at(-1) ?? 0,
    largeCount: large.length,
    largeDurationMs: milliseconds(large),
    writes: writes.length,
    afterWriteCount: afterWrites.size,
    afterWriteDurationMs: milliseconds([...afterWrites]),
  }
}

function elementCount(event: TraceEvent) {
  return traceNumber(event.args.elementCount ?? traceRecord(event.args.data).elementCount)
}

function milliseconds(events: readonly TraceEvent[]) {
  return Math.round(events.reduce((sum, event) => sum + event.dur, 0) / 100) / 10
}
