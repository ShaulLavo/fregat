type TraceEvent = {
  readonly args?: Record<string, unknown>
  readonly cat?: string
  readonly dur?: number
  readonly name: string
  readonly ph: string
  readonly pid: number
  readonly tid: number
  readonly ts: number
}

export type TraceSummary = {
  readonly durationMs: number
  readonly longTasks: readonly LongTask[]
  readonly marks: readonly string[]
  readonly split: Readonly<Record<Bucket, number>>
  readonly tasksOver16ms: number
  readonly tasksOver50ms: number
}

type LongTask = {
  readonly durationMs: number
  readonly frames: readonly string[]
  readonly startMs: number
}

type Bucket = 'scripting' | 'layout' | 'paint' | 'other'

const BUCKETS: Readonly<Record<string, Bucket>> = {
  EvaluateScript: 'scripting',
  FunctionCall: 'scripting',
  EventDispatch: 'scripting',
  TimerFire: 'scripting',
  FireAnimationFrame: 'scripting',
  RunMicrotasks: 'scripting',
  'v8.compile': 'scripting',
  'V8.GC': 'scripting',
  MajorGC: 'scripting',
  MinorGC: 'scripting',
  Layout: 'layout',
  UpdateLayoutTree: 'layout',
  RecalculateStyles: 'layout',
  ScheduleStyleRecalculation: 'layout',
  Paint: 'paint',
  PrePaint: 'paint',
  Layerize: 'paint',
  Commit: 'paint',
  CompositeLayers: 'paint',
  UpdateLayer: 'paint',
}

export function summarizeTrace(raw: string): TraceSummary {
  const parsed = JSON.parse(raw) as { traceEvents?: TraceEvent[] } | TraceEvent[]
  const events = Array.isArray(parsed) ? parsed : (parsed.traceEvents ?? [])
  const main = mainThread(events)
  const onMain = events.filter((e) => e.pid === main.pid && e.tid === main.tid && e.ph === 'X')
  const tasks = onMain.filter((e) => e.name === 'RunTask' && (e.dur ?? 0) > 0)
  const first = Math.min(...onMain.map((e) => e.ts))
  const last = Math.max(...onMain.map((e) => e.ts + (e.dur ?? 0)))
  const split: Record<Bucket, number> = { scripting: 0, layout: 0, paint: 0, other: 0 }
  for (const event of onMain) {
    const bucket = BUCKETS[event.name]
    if (!bucket) continue
    split[bucket] += selfTime(event, onMain) / 1000
  }
  const longTasks = tasks
    .filter((task) => (task.dur ?? 0) >= 50_000)
    .sort((a, b) => (b.dur ?? 0) - (a.dur ?? 0))
    .slice(0, 10)
    .map((task) => ({
      durationMs: round((task.dur ?? 0) / 1000),
      frames: topFrames(task, onMain),
      startMs: round((task.ts - first) / 1000),
    }))
  const marks = events
    .filter((e) => e.cat?.includes('blink.user_timing') && e.ph === 'R')
    .map((e) => e.name)
    .filter((name, index, all) => all.indexOf(name) === index)
    .slice(0, 40)
  return {
    durationMs: round((last - first) / 1000),
    longTasks,
    marks,
    split: {
      scripting: round(split.scripting),
      layout: round(split.layout),
      paint: round(split.paint),
      other: round(split.other),
    },
    tasksOver16ms: tasks.filter((t) => (t.dur ?? 0) >= 16_000).length,
    tasksOver50ms: tasks.filter((t) => (t.dur ?? 0) >= 50_000).length,
  }
}

export function formatTraceSummary(summary: TraceSummary): string[] {
  const lines = [
    `duration: ${summary.durationMs}ms`,
    `main thread: scripting ${summary.split.scripting}ms, layout ${summary.split.layout}ms, paint ${summary.split.paint}ms`,
    `tasks over 16ms: ${summary.tasksOver16ms}, over 50ms: ${summary.tasksOver50ms}`,
  ]
  if (summary.longTasks.length > 0) {
    lines.push('', '| start | task | top frames |', '| --- | --- | --- |')
    for (const task of summary.longTasks) {
      lines.push(
        `| ${task.startMs}ms | ${task.durationMs}ms | ${task.frames.join(' · ') || '(no attributed frames)'} |`,
      )
    }
  }
  if (summary.marks.length > 0) lines.push('', `marks: ${summary.marks.join(', ')}`)
  return lines
}

export function compareTraceSummaries(before: TraceSummary, after: TraceSummary): string[] {
  const row = (label: string, a: number, b: number) =>
    `| ${label} | ${a} | ${b} | ${b - a >= 0 ? '+' : ''}${round(b - a)} |`
  return [
    '| metric | before | after | delta |',
    '| --- | --- | --- | --- |',
    row('duration ms', before.durationMs, after.durationMs),
    row('scripting ms', before.split.scripting, after.split.scripting),
    row('layout ms', before.split.layout, after.split.layout),
    row('paint ms', before.split.paint, after.split.paint),
    row('tasks over 16ms', before.tasksOver16ms, after.tasksOver16ms),
    row('tasks over 50ms', before.tasksOver50ms, after.tasksOver50ms),
    row('worst task ms', before.longTasks[0]?.durationMs ?? 0, after.longTasks[0]?.durationMs ?? 0),
  ]
}

function mainThread(events: readonly TraceEvent[]) {
  const named = events.find(
    (e) =>
      e.name === 'thread_name' &&
      (e.args as { name?: string } | undefined)?.name === 'CrRendererMain',
  )
  if (named) return { pid: named.pid, tid: named.tid }
  const counts = new Map<string, number>()
  for (const e of events) {
    if (e.name !== 'RunTask') continue
    const key = `${e.pid}:${e.tid}`
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  const [best] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0] ?? ['0:0']
  const [pid, tid] = best.split(':').map(Number)
  return { pid: pid ?? 0, tid: tid ?? 0 }
}

// Self time: the event's duration minus its direct children on the same thread.
function selfTime(event: TraceEvent, siblings: readonly TraceEvent[]) {
  const end = event.ts + (event.dur ?? 0)
  let children = 0
  let cursor = event.ts
  for (const other of siblings) {
    if (other === event || other.ts < event.ts || other.ts + (other.dur ?? 0) > end) continue
    if (!BUCKETS[other.name] || other.ts < cursor) continue
    children += other.dur ?? 0
    cursor = other.ts + (other.dur ?? 0)
  }
  return Math.max(0, (event.dur ?? 0) - children)
}

function topFrames(task: TraceEvent, siblings: readonly TraceEvent[]) {
  const end = task.ts + (task.dur ?? 0)
  const calls = siblings
    .filter((e) => e.name === 'FunctionCall' && e.ts >= task.ts && e.ts + (e.dur ?? 0) <= end)
    .sort((a, b) => (b.dur ?? 0) - (a.dur ?? 0))
    .slice(0, 3)
  return calls.map((call) => {
    const data = (call.args as { data?: Record<string, unknown> } | undefined)?.data ?? {}
    const name = String(data.functionName || '(anonymous)')
    const url = String(data.url ?? '')
      .split('/')
      .slice(-2)
      .join('/')
    const line = data.lineNumber !== undefined ? `:${data.lineNumber}` : ''
    return `${name} ${url}${line} ${round((call.dur ?? 0) / 1000)}ms`.trim()
  })
}

function round(value: number) {
  return Math.round(value * 10) / 10
}
