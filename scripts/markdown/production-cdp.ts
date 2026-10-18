import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { CDPSession, Page } from 'playwright'

import { productionAssetKind } from '../../apps/web/test/factories/markdown-production-assets'
import { withProductionDeadline } from './production-deadline'
import { summarizeTrace } from '../agent/trace-summary.ts'

export type ProductionCpuMetrics = {
  readonly mainThreadTaskCpuMs: number | null
  readonly scriptCpuMs: number | null
  readonly layoutCpuMs: number | null
  readonly styleCpuMs: number | null
  readonly jsHeapUsedBytes: number | null
  readonly jsHeapReservedBytes: number | null
  readonly domNodes: number | null
  readonly backingStorageBytes: number | null
}
type Metrics = {
  readonly metrics: readonly {
    readonly name: string
    readonly value: number
  }[]
}
export type ProductionNetworkRequest = {
  readonly id: string
  readonly url: string
  readonly type: string
  readonly fromCache: boolean
  readonly transferredBytes: number | null
  readonly phase: 'navigation' | 'prewarm' | 'measurement' | 'scenes'
  readonly kind: 'host' | 'grammar' | 'resolver' | 'javascript' | 'other'
  readonly failure: string | null
}

export async function startProductionCdp(page: Page) {
  const session = await page.context().newCDPSession(page)
  try {
    return await initializeProductionCdp(page, session)
  } catch (error) {
    await session.detach().catch(() => undefined)
    throw error
  }
}

async function initializeProductionCdp(page: Page, session: CDPSession) {
  await session.send('Performance.enable', { timeDomain: 'threadTicks' })
  await session.send('HeapProfiler.enable')
  await session.send('Network.enable')
  const requests = new Map<string, ProductionNetworkRequest>()
  let phase: ProductionNetworkRequest['phase'] = 'navigation'
  session.on('Network.requestWillBeSent', (event) =>
    requests.set(event.requestId, {
      id: event.requestId,
      url: event.request.url,
      type: event.type ?? 'Other',
      fromCache: false,
      transferredBytes: null,
      phase,
      kind: productionAssetKind(event.request.url),
      failure: null,
    }),
  )
  session.on('Network.loadingFailed', (event) => {
    const request = requests.get(event.requestId)
    if (request) requests.set(event.requestId, { ...request, failure: event.errorText })
  })
  session.on('Network.requestServedFromCache', (event) => {
    const request = requests.get(event.requestId)
    if (request) requests.set(event.requestId, { ...request, fromCache: true })
  })
  const workers: string[] = []
  const createdWorker = (worker: import('playwright').Worker) => workers.push(worker.url())
  page.on('worker', createdWorker)
  session.on('Network.responseReceived', (event) => {
    const request = requests.get(event.requestId)
    if (!request) return
    requests.set(event.requestId, {
      ...request,
      type: event.type,
      fromCache:
        request.fromCache ||
        event.response.fromDiskCache ||
        event.response.fromServiceWorker ||
        false,
    })
  })
  session.on('Network.loadingFinished', (event) => {
    const request = requests.get(event.requestId)
    if (!request) return
    requests.set(event.requestId, {
      ...request,
      transferredBytes: event.encodedDataLength,
    })
  })
  const trace = await traceTasks(session)
  return {
    setPhase: (next: ProductionNetworkRequest['phase']) => {
      phase = next
    },
    read: async () => sampleMetrics(session),
    collect: async () => {
      await session.send('HeapProfiler.collectGarbage')
      return sampleMetrics(session)
    },
    network: () => Array.from(requests.values()),
    workers: () => ({
      created: workers.length,
      active: page.workers().length,
      urls: workers.slice(),
    }),
    finishTrace: (output: string) => trace(output),
    close: async () => {
      page.removeListener('worker', createdWorker)
      await session.detach()
    },
  }
}

function readMetrics(result: Metrics): ProductionCpuMetrics {
  const values = new Map(result.metrics.map((entry) => [entry.name, entry.value]))
  return {
    mainThreadTaskCpuMs: metricMilliseconds(values, 'TaskDuration'),
    scriptCpuMs: metricMilliseconds(values, 'ScriptDuration'),
    layoutCpuMs: metricMilliseconds(values, 'LayoutDuration'),
    styleCpuMs: metricMilliseconds(values, 'RecalcStyleDuration'),
    jsHeapUsedBytes: values.get('JSHeapUsedSize') ?? null,
    jsHeapReservedBytes: values.get('JSHeapTotalSize') ?? null,
    domNodes: values.get('Nodes') ?? null,
    backingStorageBytes: null,
  }
}

function metricMilliseconds(values: ReadonlyMap<string, number>, key: string) {
  const value = values.get(key)
  return value === undefined ? null : value * 1000
}

async function traceTasks(session: CDPSession) {
  const events: unknown[] = []
  const completion = Promise.withResolvers<void>()
  const capture = (chunk: { readonly value: readonly unknown[] }) => {
    for (const event of chunk.value) events.push(event)
  }
  session.on('Tracing.dataCollected', capture)
  session.once('Tracing.tracingComplete', () => completion.resolve())
  await session.send('Tracing.start', {
    categories:
      'toplevel,devtools.timeline,v8.execute,blink.user_timing,disabled-by-default-devtools.timeline',
    transferMode: 'ReportEvents',
  })
  return async (output: string) => {
    try {
      await session.send('Tracing.end')
      await withProductionDeadline(completion.promise, 'Chrome trace completion', 15_000)
      const raw = JSON.stringify({ traceEvents: events })
      await writeFile(path.join(output, 'production-trace.json'), raw)
      const summary = {
        ...summarizeTrace(raw),
        updateCpu: updateCpuReceipts(events),
      }
      await writeFile(
        path.join(output, 'production-trace-summary.json'),
        JSON.stringify(summary, null, 2) + '\n',
      )
      return summary
    } finally {
      session.removeListener('Tracing.dataCollected', capture)
    }
  }
}

export function updateCpuReceipts(events: readonly unknown[]) {
  const marks = new Map<string, { revision: number; start: number | null; commit: number | null }>()
  for (const event of events) recordCpuMark(event, marks)
  return Array.from(marks.values()).flatMap((entry) => {
    if (entry.start === null || entry.commit === null || entry.commit < entry.start) return []
    return [
      {
        revision: entry.revision,
        mainThreadCpuMs: (entry.commit - entry.start) / 1000,
      },
    ]
  })
}

function recordCpuMark(
  event: unknown,
  marks: Map<string, { revision: number; start: number | null; commit: number | null }>,
) {
  if (!event || typeof event !== 'object' || !('name' in event) || typeof event.name !== 'string')
    return
  if (!('tts' in event) || typeof event.tts !== 'number' || !Number.isFinite(event.tts)) return
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

async function sampleMetrics(session: CDPSession) {
  const metrics = readMetrics(await session.send('Performance.getMetrics'))
  const heap = await session.send('Runtime.getHeapUsage')
  return { ...metrics, backingStorageBytes: heap.backingStorageSize ?? null }
}
