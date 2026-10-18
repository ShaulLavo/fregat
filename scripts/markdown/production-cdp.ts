import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { CDPSession, Page } from 'playwright'

import { productionAssetKind } from '../../apps/web/test/factories/markdown-production-assets'
import { withProductionDeadline } from './production-deadline'
import { summarizeTrace } from '../agent/trace-summary.ts'
import { createScriptError } from '../structured-errors'

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
  readonly completionEncodedBytes: number | null
  readonly transferScope: 'full-request' | 'worker-bootstrap-completion'
  readonly phase: 'navigation' | 'prewarm' | 'measurement' | 'scenes'
  readonly kind: 'host' | 'grammar' | 'resolver' | 'javascript' | 'other'
  readonly failure: string | null
  readonly target: 'page' | 'worker'
  readonly workerTargetId: string | null
  readonly resolvedByWorkerRequestId: string | null
}

type WorkerTarget = {
  readonly targetId: string
  readonly sessionId: string
  readonly url: string
  readonly attachedAtMs: number
  detachedAtMs: number | null
  instrumentationError: string | null
}

type WorkerTargetSummary = {
  readonly targetId: string
  readonly url: string
  readonly attachedAtMs: number
  readonly detachedAtMs: number | null
}

export type ProductionWorkerCpu = {
  readonly targetId: string
  readonly url: string
  readonly threadId: number | null
  readonly pid: number | null
  readonly cpuMs: number | null
  readonly measurement: 'complete' | 'incomplete'
  readonly reason: string | null
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
  const workers = new Map<string, WorkerTarget>()
  const workerRequests = new Map<string, ProductionNetworkRequest>()
  const workerCommandIds = new Map<string, number>()
  const workerCommands = new Map<
    string,
    Map<number, { resolve: (value: unknown) => void; reject: (error: unknown) => void }>
  >()
  let phase: ProductionNetworkRequest['phase'] = 'navigation'

  const savePageRequest = (request: ProductionNetworkRequest) => requests.set(request.id, request)
  const saveWorkerRequest = (targetId: string, request: ProductionNetworkRequest) => {
    workerRequests.set(`${targetId}:${request.id}`, request)
  }
  const markWorkerRequestResolved = (workerRequest: ProductionNetworkRequest) => {
    const candidate = requests.get(workerRequest.id)
    if (!candidate) return
    const resolved = completedWorkerAlias(candidate, workerRequest)
    if (resolved) savePageRequest(resolved)
  }

  session.on('Network.requestWillBeSent', (event) =>
    savePageRequest({
      id: event.requestId,
      url: event.request.url,
      type: event.type ?? 'Other',
      fromCache: false,
      transferredBytes: null,
      completionEncodedBytes: null,
      transferScope: 'full-request',
      phase,
      kind: productionAssetKind(event.request.url),
      failure: null,
      target: 'page',
      workerTargetId: null,
      resolvedByWorkerRequestId: null,
    }),
  )
  session.on('Network.loadingFailed', (event) => {
    const request = requests.get(event.requestId)
    if (request) savePageRequest({ ...request, failure: event.errorText })
  })
  session.on('Network.requestServedFromCache', (event) => {
    const request = requests.get(event.requestId)
    if (request) savePageRequest({ ...request, fromCache: true })
  })
  session.on('Network.responseReceived', (event) => {
    const request = requests.get(event.requestId)
    if (!request) return
    savePageRequest({
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
    savePageRequest({
      ...request,
      transferredBytes: transferredBytes(event.encodedDataLength),
      completionEncodedBytes: transferredBytes(event.encodedDataLength),
    })
  })

  session.on('Target.receivedMessageFromTarget', (event) => {
    const message = parseWorkerMessage(event.message)
    if (!message) return
    const commands = workerCommands.get(event.sessionId)
    if (message.id !== null && commands?.has(message.id)) {
      const command = commands.get(message.id)
      commands?.delete(message.id)
      if (message.error) command?.reject(message.error)
      else command?.resolve(message.result)
      return
    }
    const worker = Array.from(workers.values()).find((entry) => entry.sessionId === event.sessionId)
    if (!worker) return
    handleWorkerEvent(
      worker,
      message.method,
      message.params,
      workerRequests,
      requests,
      saveWorkerRequest,
      markWorkerRequestResolved,
      phase,
    )
  })
  session.on('Target.attachedToTarget', (event) => {
    if (event.targetInfo.type !== 'worker') return
    const worker: WorkerTarget = {
      targetId: event.targetInfo.targetId,
      sessionId: event.sessionId,
      url: event.targetInfo.url,
      attachedAtMs: performance.now(),
      detachedAtMs: null,
      instrumentationError: null,
    }
    workers.set(worker.targetId, worker)
    void initializeWorker(worker, session, workerCommandIds, workerCommands)
  })
  session.on('Target.detachedFromTarget', (event) => {
    const worker = Array.from(workers.values()).find((entry) => entry.sessionId === event.sessionId)
    if (!worker) return
    worker.detachedAtMs = performance.now()
    const commands = workerCommands.get(worker.sessionId)
    for (const command of commands?.values() ?? [])
      command.reject(createScriptError('The observed worker target detached.'))
    workerCommands.delete(worker.sessionId)
    workerCommandIds.delete(worker.sessionId)
  })

  await session.send('Target.setAutoAttach', {
    autoAttach: true,
    waitForDebuggerOnStart: true,
    flatten: false,
  })

  const trace = await traceTasks(session, workers)
  return {
    setPhase: (next: ProductionNetworkRequest['phase']) => {
      phase = next
    },
    read: async () => sampleMetrics(session),
    collect: async () => {
      await session.send('HeapProfiler.collectGarbage')
      return sampleMetrics(session)
    },
    network: () => Array.from(requests.values()).concat(Array.from(workerRequests.values())),
    workers: () => ({
      created: workers.size,
      active: page.workers().length,
      targets: Array.from(workers.values(), ({ sessionId: _sessionId, ...target }) => target),
      urls: Array.from(workers.values(), (worker) => worker.url),
    }),
    finishTrace: (output: string) => trace(output),
    close: async () => {
      const error = createScriptError('Production worker instrumentation closed.')
      for (const commands of workerCommands.values()) rejectWorkerCommands(commands.values(), error)
      workerCommands.clear()
      await session
        .send('Target.setAutoAttach', {
          autoAttach: false,
          waitForDebuggerOnStart: false,
          flatten: false,
        })
        .catch(() => undefined)
      await session.detach()
    },
  }
}

function transferredBytes(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
}

type WorkerMessage = {
  readonly id: number | null
  readonly method: string | null
  readonly params: Record<string, unknown>
  readonly result: unknown
  readonly error: unknown
}

function parseWorkerMessage(raw: string): WorkerMessage | null {
  try {
    const value: unknown = JSON.parse(raw)
    if (!value || typeof value !== 'object') return null
    const record: Record<string, unknown> = { ...value }
    return {
      id: typeof record.id === 'number' ? record.id : null,
      method: typeof record.method === 'string' ? record.method : null,
      params: record.params && typeof record.params === 'object' ? { ...record.params } : {},
      result: record.result,
      error: record.error,
    }
  } catch {
    return null
  }
}

function rejectWorkerCommands(
  commands: Iterable<{ readonly reject: (error: unknown) => void }>,
  error: unknown,
) {
  for (const command of commands) command.reject(error)
}

async function initializeWorker(
  worker: WorkerTarget,
  session: CDPSession,
  commandIds: Map<string, number>,
  commands: Map<
    string,
    Map<number, { resolve: (value: unknown) => void; reject: (error: unknown) => void }>
  >,
) {
  try {
    await workerCommand(worker.sessionId, session, commandIds, commands, 'Network.enable')
    await workerCommand(worker.sessionId, session, commandIds, commands, 'Runtime.enable')
  } catch (error) {
    worker.instrumentationError = JSON.stringify(error)
  } finally {
    await workerCommand(
      worker.sessionId,
      session,
      commandIds,
      commands,
      'Runtime.runIfWaitingForDebugger',
    ).catch((error: unknown) => {
      worker.instrumentationError = JSON.stringify(error)
    })
  }
}

async function workerCommand(
  sessionId: string,
  session: CDPSession,
  commandIds: Map<string, number>,
  commands: Map<
    string,
    Map<number, { resolve: (value: unknown) => void; reject: (error: unknown) => void }>
  >,
  method: string,
) {
  const id = (commandIds.get(sessionId) ?? 0) + 1
  commandIds.set(sessionId, id)
  const pending = commands.get(sessionId) ?? new Map()
  commands.set(sessionId, pending)
  const response = Promise.withResolvers<unknown>()
  pending.set(id, response)
  try {
    await session.send('Target.sendMessageToTarget', {
      sessionId,
      message: JSON.stringify({ id, method }),
    })
    return await withProductionDeadline(response.promise, `Worker ${method}`, 10_000)
  } finally {
    pending.delete(id)
  }
}

export function handleWorkerEvent(
  worker: Pick<WorkerTarget, 'targetId' | 'url'>,
  method: string | null,
  params: Record<string, unknown>,
  requests: Map<string, ProductionNetworkRequest>,
  pageRequests: ReadonlyMap<string, ProductionNetworkRequest>,
  save: (targetId: string, request: ProductionNetworkRequest) => void,
  resolvePageRequest: (request: ProductionNetworkRequest) => void,
  phase: ProductionNetworkRequest['phase'],
) {
  if (!method || !method.startsWith('Network.')) return
  const requestId = typeof params.requestId === 'string' ? params.requestId : null
  if (!requestId) return
  const key = `${worker.targetId}:${requestId}`
  if (method === 'Network.requestWillBeSent') {
    const request = params.request
    if (!request || typeof request !== 'object') return
    const rawUrl = objectField(request, 'url')
    if (typeof rawUrl !== 'string') return
    const url = rawUrl
    const entry: ProductionNetworkRequest = {
      id: requestId,
      url,
      type: typeof params.type === 'string' ? params.type : 'Other',
      fromCache: false,
      transferredBytes: null,
      completionEncodedBytes: null,
      transferScope: 'full-request',
      phase,
      kind: productionAssetKind(url),
      failure: null,
      target: 'worker',
      workerTargetId: worker.targetId,
      resolvedByWorkerRequestId: null,
    }
    save(worker.targetId, entry)
    return
  }
  const entry = requests.get(key) ?? workerScriptRequest(worker, requestId, pageRequests)
  if (!entry) return
  if (method === 'Network.responseReceived') {
    const response = params.response
    const fromCache =
      response && typeof response === 'object'
        ? Boolean(
            objectField(response, 'fromDiskCache') || objectField(response, 'fromServiceWorker'),
          )
        : false
    save(worker.targetId, {
      ...entry,
      type: typeof params.type === 'string' ? params.type : entry.type,
      fromCache: entry.fromCache || fromCache,
    })
    return
  }
  if (method === 'Network.requestServedFromCache') {
    save(worker.targetId, { ...entry, fromCache: true })
    return
  }
  if (method === 'Network.loadingFinished') {
    // Bootstrap completion can report headers after the body arrived before worker attachment.
    const completed = {
      ...entry,
      transferredBytes:
        entry.transferScope === 'full-request' ? transferredBytes(params.encodedDataLength) : null,
      completionEncodedBytes: transferredBytes(params.encodedDataLength),
    }
    save(worker.targetId, completed)
    resolvePageRequest(completed)
    return
  }
  if (method === 'Network.loadingFailed') {
    save(worker.targetId, {
      ...entry,
      failure:
        typeof params.errorText === 'string' ? params.errorText : 'Worker network request failed',
    })
  }
}

function workerScriptRequest(
  worker: Pick<WorkerTarget, 'targetId' | 'url'>,
  requestId: string,
  pageRequests: ReadonlyMap<string, ProductionNetworkRequest>,
): ProductionNetworkRequest | null {
  if (requestId !== worker.targetId) return null
  const pageRequest = pageRequests.get(requestId)
  if (!pageRequest || pageRequest.url !== worker.url) return null
  return {
    ...pageRequest,
    target: 'worker',
    workerTargetId: worker.targetId,
    transferredBytes: null,
    completionEncodedBytes: null,
    transferScope: 'worker-bootstrap-completion',
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

async function traceTasks(session: CDPSession, workers: ReadonlyMap<string, WorkerTarget>) {
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
        workerCpu: workerCpuReceipts(events, Array.from(workers.values())),
        streamMainThreadCpuMs: streamMainThreadCpu(events),
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

export function workerCpuReceipts(
  events: readonly unknown[],
  workers: readonly WorkerTargetSummary[],
): ProductionWorkerCpu[] {
  const interval = traceMarkInterval(events, 'markdown-stream-start', 'markdown-stream-end')
  const mappings = events.flatMap((event) => workerTraceMapping(event))
  return workers.map((worker) => {
    const mapping = mappings.find((entry) => entry.workerId === worker.targetId)
    if (!mapping)
      return {
        targetId: worker.targetId,
        url: worker.url,
        threadId: null,
        pid: null,
        cpuMs: null,
        measurement: 'incomplete',
        reason: 'Trace did not map the worker target to a dedicated thread.',
      }
    if (
      mappings.filter((entry) => entry.pid === mapping.pid && entry.threadId === mapping.threadId)
        .length !== 1
    )
      return {
        targetId: worker.targetId,
        url: worker.url,
        threadId: mapping.threadId,
        pid: mapping.pid,
        cpuMs: null,
        measurement: 'incomplete',
        reason: 'The dedicated thread was mapped to multiple worker lifetimes.',
      }
    if (!interval)
      return {
        targetId: worker.targetId,
        url: worker.url,
        threadId: mapping.threadId,
        pid: mapping.pid,
        cpuMs: null,
        measurement: 'incomplete',
        reason: 'Stream measurement marks are missing.',
      }
    const tasks = events.flatMap((event) => workerTask(event, mapping, interval))
    if (tasks.length === 0 || tasks.some((task) => task.crossesBoundary))
      return {
        targetId: worker.targetId,
        url: worker.url,
        threadId: mapping.threadId,
        pid: mapping.pid,
        cpuMs: null,
        measurement: 'incomplete',
        reason:
          tasks.length === 0
            ? 'Trace captured no worker tasks to establish task coverage.'
            : 'A worker task had missing CPU/span data or crossed the stream boundary.',
      }
    return {
      targetId: worker.targetId,
      url: worker.url,
      threadId: mapping.threadId,
      pid: mapping.pid,
      cpuMs: tasks.reduce((sum, task) => sum + task.cpuUs, 0) / 1000,
      measurement: 'complete',
      reason: null,
    }
  })
}

function traceMarkInterval(events: readonly unknown[], startName: string, endName: string) {
  const marks = events.flatMap((event) => {
    if (!event || typeof event !== 'object') return []
    const record: Record<string, unknown> = { ...event }
    if (record.name !== startName && record.name !== endName) return []
    if (typeof record.ts !== 'number' || !Number.isFinite(record.ts)) return []
    if (typeof record.pid !== 'number' || typeof record.tid !== 'number') return []
    return [
      {
        name: record.name,
        ts: record.ts,
        tts: record.tts,
        pid: record.pid,
        tid: record.tid,
      },
    ]
  })
  const starts = marks.filter((mark) => mark.name === startName)
  const ends = marks.filter((mark) => mark.name === endName)
  if (starts.length !== 1 || ends.length !== 1) return null
  const start = starts[0]
  const end = ends[0]
  if (start.pid !== end.pid || start.tid !== end.tid || end.ts < start.ts) return null
  const mainCpuMs =
    typeof start.tts === 'number' && typeof end.tts === 'number' && end.tts >= start.tts
      ? (end.tts - start.tts) / 1000
      : null
  return { start: start.ts, end: end.ts, mainCpuMs }
}

export function streamMainThreadCpu(events: readonly unknown[]) {
  return (
    traceMarkInterval(events, 'markdown-stream-start', 'markdown-stream-end')?.mainCpuMs ?? null
  )
}

function workerTraceMapping(event: unknown) {
  if (!event || typeof event !== 'object') return []
  const record: Record<string, unknown> = { ...event }
  if (
    record.name !== 'TracingSessionIdForWorker' ||
    typeof record.tid !== 'number' ||
    typeof record.pid !== 'number'
  )
    return []
  const data =
    record.args && typeof record.args === 'object' ? objectField(record.args, 'data') : null
  if (!data || typeof data !== 'object') return []
  const rawWorkerId = objectField(data, 'workerId')
  const workerId = typeof rawWorkerId === 'string' ? rawWorkerId : null
  if (!workerId) return []
  return [{ workerId, threadId: record.tid, pid: record.pid }]
}

function workerTask(
  event: unknown,
  mapping: { threadId: number; pid: number },
  interval: { start: number; end: number },
) {
  if (!event || typeof event !== 'object') return []
  const record: Record<string, unknown> = { ...event }
  if (record.name !== 'RunTask' || record.pid !== mapping.pid || record.tid !== mapping.threadId)
    return []
  if (
    record.ph !== 'X' ||
    typeof record.ts !== 'number' ||
    !Number.isFinite(record.ts) ||
    typeof record.dur !== 'number' ||
    !Number.isFinite(record.dur) ||
    record.dur < 0
  )
    return [{ cpuUs: 0, crossesBoundary: true }]
  const finish = record.ts + record.dur
  if (finish <= interval.start || record.ts >= interval.end)
    return [{ cpuUs: 0, crossesBoundary: false }]
  const complete = record.ts >= interval.start && finish <= interval.end
  const tdur =
    typeof record.tdur === 'number' && Number.isFinite(record.tdur) && record.tdur >= 0
      ? record.tdur
      : null
  return [{ cpuUs: tdur ?? 0, crossesBoundary: !complete || tdur === null }]
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

async function sampleMetrics(session: CDPSession) {
  const metrics = readMetrics(await session.send('Performance.getMetrics'))
  const heap = await session.send('Runtime.getHeapUsage')
  return {
    ...metrics,
    jsHeapUsedBytes: heap.usedSize,
    jsHeapReservedBytes: heap.totalSize,
    backingStorageBytes: heap.backingStorageSize ?? null,
  }
}

function objectField(value: object, key: string): unknown {
  const record: Record<string, unknown> = { ...value }
  return record[key]
}

export function isSustainedProductStream(request: Pick<ProductionNetworkRequest, 'type' | 'url'>) {
  if (request.type !== 'EventSource') return false
  const pathname = new URL(request.url).pathname
  return pathname.endsWith('/events')
}

export function completedWorkerAlias(
  page: ProductionNetworkRequest,
  worker: ProductionNetworkRequest,
) {
  if (
    page.target !== 'page' ||
    page.failure !== null ||
    page.transferredBytes !== null ||
    page.resolvedByWorkerRequestId !== null ||
    worker.target !== 'worker' ||
    worker.transferScope !== 'full-request' ||
    worker.workerTargetId === null ||
    worker.failure !== null ||
    transferredBytes(worker.transferredBytes) === null
  )
    return null
  if (page.id !== worker.id || page.url !== worker.url || page.kind !== worker.kind) return null
  return { ...page, resolvedByWorkerRequestId: worker.id }
}
