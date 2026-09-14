import {
  attributeSamples,
  decodeMainThreadSamples,
  type SampleInterval,
  type SampledFrame,
} from './trace-profile'
import { sourceResolver, type CapturedSourceMap, type OriginalFrame } from './trace-source-maps'
import { mainThread, readTrace, traceRecord, type TraceEvent } from './trace-types'

export type TraceSummary = {
  readonly durationMs: number
  readonly longTasks: readonly LongTask[]
  readonly phaseTasks: readonly LongTask[]
  readonly marks: readonly string[]
  readonly split: Readonly<Record<Bucket, number>>
  readonly tasksOver16ms: number
  readonly tasksOver50ms: number
  readonly worstTaskMs: number
}

type LongTask = {
  readonly durationMs: number
  readonly frames: readonly string[]
  readonly sampledFrames: readonly (SampledFrame & { readonly original: OriginalFrame | null })[]
  readonly phase: string | null
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

export function summarizeTrace(
  raw: string,
  sources: readonly CapturedSourceMap[] = [],
): TraceSummary {
  const events = readTrace(raw)
  const main = mainThread(events)
  const onMain = events
    .filter((e) => e.pid === main.pid && e.tid === main.tid && e.ph === 'X')
    .sort((a, b) => a.ts - b.ts)
  const tasks = onMain.filter((e) => e.name === 'RunTask' && (e.dur ?? 0) > 0)
  const first = onMain[0]?.ts ?? 0
  const last = onMain.reduce((end, event) => Math.max(end, event.ts + event.dur), first)
  const samples = decodeMainThreadSamples(events, main)
  const resolve = sourceResolver(sources)
  const describe = (task: TraceEvent, phase: string | null = null) =>
    describeTask(task, { first, phase, samples, siblings: onMain, resolve })
  const split: Record<Bucket, number> = { scripting: 0, layout: 0, paint: 0, other: 0 }
  for (const event of onMain) {
    const bucket = BUCKETS[event.name]
    if (!bucket) continue
    split[bucket] += selfTime(event, onMain) / 1000
  }
  const longTasks = tasks
    .filter((task) => (task.dur ?? 0) >= 50_000)
    .sort((a, b) => (b.dur ?? 0) - (a.dur ?? 0))
    .slice(0, 5)
    .map((task) => describe(task))
  const phaseTasks = worstPhaseTasks(
    events.filter((event) => event.pid === main.pid && event.tid === main.tid),
    tasks,
  ).map(({ task, phase }) => describe(task, phase))
  const marks = events
    .filter(isTimingMark)
    .map((e) => e.name)
    .filter((name, index, all) => all.indexOf(name) === index)
    .slice(0, 40)
  return {
    durationMs: round((last - first) / 1000),
    longTasks,
    phaseTasks,
    marks,
    split: {
      scripting: round(split.scripting),
      layout: round(split.layout),
      paint: round(split.paint),
      other: round(split.other),
    },
    tasksOver16ms: tasks.filter((t) => (t.dur ?? 0) >= 16_000).length,
    tasksOver50ms: tasks.filter((t) => (t.dur ?? 0) >= 50_000).length,
    worstTaskMs: round(tasks.reduce((duration, task) => Math.max(duration, task.dur), 0) / 1000),
  }
}

export function formatTraceSummary(summary: TraceSummary): string[] {
  const lines = [
    `duration: ${summary.durationMs}ms`,
    `main thread: scripting ${summary.split.scripting}ms, layout ${summary.split.layout}ms, paint ${summary.split.paint}ms`,
    `tasks over 16ms: ${summary.tasksOver16ms}, over 50ms: ${summary.tasksOver50ms}`,
  ]
  const table = new Map(summary.longTasks.map((task) => [task.startMs, task]))
  for (const task of summary.phaseTasks) table.set(task.startMs, task)
  if (table.size > 0) {
    lines.push(
      '',
      'Samples attribute elapsed intervals to the deepest application frame on each stack, including its callees. They are estimates, not measured function self time. Task duration is wall time.',
      '',
      '| phase | start | task wall | sampled application frames / fallback |',
      '| --- | --- | --- | --- |',
    )
    for (const task of [...table.values()].sort((a, b) => a.startMs - b.startMs)) {
      const frames =
        task.sampledFrames.length > 0 ? task.sampledFrames.map(formatSampledFrame) : task.frames
      lines.push(
        `| ${task.phase ?? 'long task'} | ${task.startMs}ms | ${task.durationMs}ms | ${frames.join(' · ') || '(no attributed frames)'} |`,
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
    row('worst task ms', before.worstTaskMs, after.worstTaskMs),
  ]
}

function describeTask(
  task: TraceEvent,
  context: {
    readonly first: number
    readonly phase: string | null
    readonly samples: readonly SampleInterval[]
    readonly siblings: readonly TraceEvent[]
    readonly resolve: ReturnType<typeof sourceResolver>
  },
): LongTask {
  const sampledFrames = attributeSamples(task, context.samples).map((frame) => ({
    ...frame,
    sampledMs: round(frame.sampledMs),
    original: context.resolve(frame.generated),
  }))
  return {
    durationMs: round(task.dur / 1000),
    frames: sampledFrames.length === 0 ? topFrames(task, context.siblings) : [],
    sampledFrames,
    phase: context.phase,
    startMs: round((task.ts - context.first) / 1000),
  }
}

function worstPhaseTasks(events: readonly TraceEvent[], tasks: readonly TraceEvent[]) {
  const marks = events
    .filter(
      (event) =>
        isTimingMark(event) &&
        (event.name.startsWith('fregat:step:') || event.name === 'fregat:scenario:start'),
    )
    .sort((a, b) => a.ts - b.ts)
  return marks.flatMap((mark, index) => {
    const previous = marks[index - 1]
    if (!previous || !mark.name.startsWith('fregat:step:')) return []
    const task = tasks
      .filter((task) => task.ts >= previous.ts && task.ts < mark.ts)
      .sort((a, b) => b.dur - a.dur)[0]
    return task ? [{ task, phase: mark.name.slice('fregat:step:'.length) }] : []
  })
}

function isTimingMark(event: TraceEvent): boolean {
  return event.cat.includes('blink.user_timing') && (event.ph === 'R' || event.ph === 'I')
}

function formatSampledFrame(frame: LongTask['sampledFrames'][number]): string {
  const location = frame.original
  const name = location?.functionName ?? frame.generated.functionName
  const source = (location?.source ?? frame.generated.url)
    .replace(/^https?:\/\/[^/]+/, '')
    .split('?')[0]
  const line = location?.line ?? frame.generated.line + 1
  const column = location?.column ?? frame.generated.column + 1
  const mapping = location ? '' : ' [generated]'
  return `${name} ${source}:${line}:${column}${mapping} ${frame.sampledMs}ms sampled`.replaceAll(
    '|',
    '\\|',
  )
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
    const data = traceRecord(call.args.data)
    const name = String(data.functionName || '(anonymous)')
    const url = String(data.url ?? '')
      .split('/')
      .slice(-2)
      .join('/')
    const line = data.lineNumber !== undefined ? `:${data.lineNumber}` : ''
    return `${name} ${url}${line} ${round((call.dur ?? 0) / 1000)}ms FunctionCall wall (no application samples)`.trim()
  })
}

function round(value: number) {
  return Math.round(value * 10) / 10
}
