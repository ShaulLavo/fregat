import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { CDPSession, Page } from 'playwright'

import { summarizeTrace } from '../agent/trace-summary.ts'

type Metrics = { readonly metrics: readonly { readonly name: string; readonly value: number }[] }

export async function startProductionCdp(page: Page) {
  const session = await page.context().newCDPSession(page)
  await session.send('Performance.enable', { timeDomain: 'threadTicks' })
  await session.send('HeapProfiler.enable')
  return {
    read: async () => readMetrics(await session.send('Performance.getMetrics')),
    collect: async () => {
      await session.send('HeapProfiler.collectGarbage')
      return readMetrics(await session.send('Performance.getMetrics'))
    },
    trace: (output: string) => traceTasks(session, output),
    close: () => session.detach(),
  }
}

function readMetrics(result: Metrics) {
  const values = new Map(result.metrics.map((entry) => [entry.name, entry.value]))
  return {
    mainThreadTaskCpuMs: metricMilliseconds(values, 'TaskDuration'),
    scriptCpuMs: metricMilliseconds(values, 'ScriptDuration'),
    layoutCpuMs: metricMilliseconds(values, 'LayoutDuration'),
    styleCpuMs: metricMilliseconds(values, 'RecalcStyleDuration'),
    jsHeapUsedBytes: values.get('JSHeapUsedSize') ?? null,
    jsHeapReservedBytes: values.get('JSHeapTotalSize') ?? null,
    domNodes: values.get('Nodes') ?? null,
  }
}

function metricMilliseconds(values: ReadonlyMap<string, number>, key: string) {
  const value = values.get(key)
  return value === undefined ? null : value * 1000
}

async function traceTasks(session: CDPSession, output: string) {
  const events: unknown[] = []
  const completion = Promise.withResolvers<void>()
  const capture = (chunk: { readonly value: readonly unknown[] }) => {
    for (const event of chunk.value) events.push(event)
  }
  session.on('Tracing.dataCollected', capture)
  session.once('Tracing.tracingComplete', () => completion.resolve())
  await session.send('Tracing.start', {
    categories:
      'devtools.timeline,v8.execute,blink.user_timing,disabled-by-default-devtools.timeline,disabled-by-default-v8.cpu_profiler',
    transferMode: 'ReportEvents',
  })
  return async () => {
    try {
      await session.send('Tracing.end')
      await completion.promise
      const raw = JSON.stringify({ traceEvents: events })
      await writeFile(path.join(output, 'production-trace.json'), raw)
      const summary = summarizeTrace(raw)
      const updateCpu = updateCpuReceipts(events)
      await writeFile(
        path.join(output, 'production-trace-summary.json'),
        JSON.stringify({ ...summary, updateCpu }, null, 2) + '\n',
      )
      return { ...summary, updateCpu }
    } finally {
      session.removeListener('Tracing.dataCollected', capture)
    }
  }
}

function updateCpuReceipts(events: readonly unknown[]) {
  const marks = new Map<string, { revision: number; start: number | null; commit: number | null }>()
  for (const event of events) recordCpuMark(event, marks)
  return Array.from(marks.values()).flatMap((entry) => {
    if (entry.start === null || entry.commit === null) return []
    return [{ revision: entry.revision, mainThreadCpuMs: (entry.commit - entry.start) / 1000 }]
  })
}

function recordCpuMark(
  event: unknown,
  marks: Map<string, { revision: number; start: number | null; commit: number | null }>,
) {
  if (!event || typeof event !== 'object' || !('name' in event) || typeof event.name !== 'string')
    return
  if (!('tts' in event) || typeof event.tts !== 'number') return
  if (
    !('pid' in event) ||
    typeof event.pid !== 'number' ||
    !('tid' in event) ||
    typeof event.tid !== 'number'
  )
    return
  const match = /^markdown-update-(\d+)-(start|commit)$/u.exec(event.name)
  if (!match) return
  const revision = Number(match[1])
  const key = `${event.pid}:${event.tid}:${revision}`
  const entry = marks.get(key) ?? { revision, start: null, commit: null }
  if (match[2] === 'start') entry.start = event.tts
  else entry.commit = event.tts
  marks.set(key, entry)
}
