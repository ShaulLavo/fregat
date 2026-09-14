import { createScriptError } from '../structured-errors'

export type TraceEvent = {
  readonly args: Record<string, unknown>
  readonly cat: string
  readonly dur: number
  readonly id: string
  readonly name: string
  readonly ph: string
  readonly pid: number
  readonly tid: number
  readonly ts: number
}

export type GeneratedFrame = {
  readonly scriptId: string
  readonly functionName: string
  readonly url: string
  readonly line: number
  readonly column: number
}

export type TraceThread = Pick<TraceEvent, 'pid' | 'tid'>

export function traceRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

export function traceNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

export function readTrace(raw: string): readonly TraceEvent[] {
  const parsed: unknown = JSON.parse(raw)
  const events: unknown = Array.isArray(parsed) ? parsed : traceRecord(parsed).traceEvents
  if (!Array.isArray(events)) throw createScriptError('Trace has no traceEvents array.')
  return events.map(readEvent)
}

function readEvent(value: unknown): TraceEvent {
  const event = traceRecord(value)
  return {
    args: traceRecord(event.args),
    cat: String(event.cat ?? ''),
    dur: traceNumber(event.dur),
    id: String(event.id ?? ''),
    name: String(event.name ?? ''),
    ph: String(event.ph ?? ''),
    pid: traceNumber(event.pid),
    tid: traceNumber(event.tid),
    ts: traceNumber(event.ts),
  }
}

export function mainThread(events: readonly TraceEvent[]): TraceThread {
  const counts = new Map<string, number>()
  const named = events.filter(
    (event) => event.name === 'thread_name' && event.args.name === 'CrRendererMain',
  )
  for (const event of events) {
    if (event.name !== 'RunTask') continue
    const key = `${event.pid}:${event.tid}`
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  named.sort(
    (a, b) => (counts.get(`${b.pid}:${b.tid}`) ?? 0) - (counts.get(`${a.pid}:${a.tid}`) ?? 0),
  )
  if (named[0]) return named[0]
  const [best] = [...counts].sort((a, b) => b[1] - a[1])[0] ?? ['0:0']
  const [pid = 0, tid = 0] = best.split(':').map(Number)
  return { pid, tid }
}

export function frameKey(frame: GeneratedFrame): string {
  return JSON.stringify([frame.scriptId, frame.url, frame.functionName, frame.line, frame.column])
}

export function isApplicationFrame(frame: GeneratedFrame): boolean {
  if (frame.url.includes('/node_modules/')) return false
  return frame.url.includes('/src/') || frame.url.includes('/@fs/')
}
