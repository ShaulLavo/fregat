import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { CDPSession, Page } from 'playwright'

import { productionAssetKind } from '../../apps/web/test/factories/markdown-production-assets'
import { withProductionDeadline } from './production-deadline'
import { productionWorkerTraceConfig } from './production-worker-trace-config'
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
  readonly transferReceiptError?: string
  /** Sum of Network.dataReceived.dataLength; it is not a full transfer receipt. */
  readonly dataReceivedBytes: number | null
  readonly traceTransferReceipt?: {
    readonly requestId: string
    readonly responseEncodedBytes: number
    readonly receivedEncodedBytes: number
  }
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
  readonly coveredCpuMs: number | null
  readonly taskCount: number
  readonly nestedTaskCount: number
  readonly incompleteTaskCount: number
  readonly boundaryCrossingTaskCount: number
} & (
  | { readonly measurement: 'complete'; readonly cpuMs: number; readonly reason: null }
  | { readonly measurement: 'incomplete'; readonly cpuMs: null; readonly reason: string }
)

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
    const reconciliation = reconcileWorkerRequestCopies(candidate, workerRequest)
    if (!reconciliation) return
    savePageRequest(reconciliation.page)
    if (workerRequest.workerTargetId !== null)
      saveWorkerRequest(workerRequest.workerTargetId, reconciliation.worker)
  }

  session.on('Network.requestWillBeSent', (event) =>
    savePageRequest({
      id: event.requestId,
      url: event.request.url,
      type: event.type ?? 'Other',
      fromCache: false,
      transferredBytes: null,
      completionEncodedBytes: null,
      dataReceivedBytes: null,
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
  session.on('Network.dataReceived', (event) => {
    const request = requests.get(event.requestId)
    if (!request) return
    savePageRequest(addDataReceivedBytes(request, event.dataLength))
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

  const trace = await traceTasks(session, workers, (events) => {
    for (const request of workerRequests.values()) {
      const completed = completeWorkerBootstrapTransfer(
        events,
        Array.from(workers.values()),
        request,
      )
      if (!completed) continue
      saveWorkerRequest(completed.workerTargetId ?? '', completed)
      markWorkerRequestResolved(completed)
    }
  })
  return {
    setPhase: (next: ProductionNetworkRequest['phase']) => {
      phase = next
    },
    read: async () => sampleMetrics(session),
    collect: async () => {
      await session.send('HeapProfiler.collectGarbage')
      return sampleMetrics(session)
    },
    network: () =>
      reconcileProductionNetworkRequests(
        Array.from(requests.values()).concat(Array.from(workerRequests.values())),
      ),
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

function addDataReceivedBytes(request: ProductionNetworkRequest, value: unknown) {
  const received = transferredBytes(value)
  if (received === null) return request
  return {
    ...request,
    dataReceivedBytes: (request.dataReceivedBytes ?? 0) + received,
  }
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
    const previous = requests.get(key)
    const entry: ProductionNetworkRequest = {
      id: requestId,
      url,
      type: typeof params.type === 'string' ? params.type : 'Other',
      fromCache: previous?.fromCache ?? false,
      transferredBytes: previous?.transferredBytes ?? null,
      completionEncodedBytes: previous?.completionEncodedBytes ?? null,
      transferReceiptError: previous?.transferReceiptError,
      dataReceivedBytes: previous?.dataReceivedBytes ?? null,
      transferScope: 'full-request',
      phase: previous?.phase ?? phase,
      kind: productionAssetKind(url),
      failure: previous?.failure ?? null,
      target: 'worker',
      workerTargetId: worker.targetId,
      resolvedByWorkerRequestId: null,
    }
    save(worker.targetId, entry)
    return
  }
  const entry = requests.get(key) ?? workerScriptRequest(worker, requestId, pageRequests)
  if (!entry) return
  if (method === 'Network.dataReceived') {
    save(worker.targetId, addDataReceivedBytes(entry, params.dataLength))
    return
  }
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
    dataReceivedBytes: null,
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

async function traceTasks(
  session: CDPSession,
  workers: ReadonlyMap<string, WorkerTarget>,
  completeTransfers: (events: readonly unknown[]) => void,
) {
  const events: unknown[] = []
  const completion = Promise.withResolvers<{ readonly dataLossOccurred: boolean }>()
  const capture = (chunk: { readonly value: readonly unknown[] }) => {
    for (const event of chunk.value) events.push(event)
  }
  session.on('Tracing.dataCollected', capture)
  session.once('Tracing.tracingComplete', (event) => completion.resolve(event))
  await session.send('Tracing.start', {
    perfettoConfig: productionWorkerTraceConfig(),
    transferMode: 'ReportEvents',
  })
  return async (output: string) => {
    try {
      await session.send('Tracing.end')
      const finished = await withProductionDeadline(
        completion.promise,
        'Chrome trace completion',
        15_000,
      )
      if (finished.dataLossOccurred)
        throw createScriptError('Chrome trace lost events; accounting is incomplete.')
      completeTransfers(events)
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
  return workers.map((worker): ProductionWorkerCpu => {
    const workerMappings = mappings.filter((entry) => entry.workerId === worker.targetId)
    if (workerMappings.length === 0)
      return incompleteWorkerCpu(
        worker,
        null,
        'Trace did not map the worker target to a dedicated thread.',
      )
    if (workerMappings.length !== 1)
      return incompleteWorkerCpu(
        worker,
        null,
        'Trace mapped the worker target to multiple dedicated threads.',
      )
    const mapping = workerMappings[0]
    if (
      mappings.filter((entry) => entry.pid === mapping.pid && entry.threadId === mapping.threadId)
        .length !== 1
    )
      return incompleteWorkerCpu(
        worker,
        mapping,
        'The dedicated thread was mapped to multiple worker lifetimes.',
      )
    if (!interval)
      return incompleteWorkerCpu(worker, mapping, 'Stream measurement marks are missing.')
    const tasks = events.flatMap((event, sequence) =>
      workerTask(event, mapping, interval, sequence),
    )
    if (tasks.length === 0)
      return incompleteWorkerCpu(
        worker,
        mapping,
        'Trace captured no worker tasks to establish task coverage.',
      )
    const outerTasks = selectOuterTasks(tasks)
    const incompleteTaskCount = outerTasks.filter((task) => !task.complete).length
    const boundaryCrossingTaskCount = outerTasks.filter((task) => task.crossesBoundary).length
    const nestedTaskCount = tasks.length - outerTasks.length
    const coveredCpuMs = outerTasks.reduce((sum, task) => sum + (task.cpuUs ?? 0), 0) / 1000
    const taskEvidence = {
      coveredCpuMs,
      taskCount: tasks.length,
      nestedTaskCount,
      incompleteTaskCount,
      boundaryCrossingTaskCount,
    }
    const outerCompleteTasks = outerTasks.filter((task) => task.complete)
    if (hasOverlappingTaskSpans(outerCompleteTasks))
      return {
        ...incompleteWorkerCpu(
          worker,
          mapping,
          'Worker task spans overlap without a nested relationship; CPU ownership is ambiguous.',
        ),
        ...taskEvidence,
        coveredCpuMs: null,
        incompleteTaskCount: outerTasks.length,
      }
    if (boundaryCrossingTaskCount > 0)
      return {
        ...incompleteWorkerCpu(
          worker,
          mapping,
          'A worker task crossed the stream boundary; its CPU is not attributable to the interval.',
        ),
        ...taskEvidence,
      }
    if (incompleteTaskCount > 0)
      return {
        ...incompleteWorkerCpu(worker, mapping, 'A worker task lacked complete thread CPU data.'),
        ...taskEvidence,
      }
    return {
      targetId: worker.targetId,
      url: worker.url,
      threadId: mapping.threadId,
      pid: mapping.pid,
      cpuMs: coveredCpuMs,
      ...taskEvidence,
      measurement: 'complete',
      reason: null,
    }
  })
}

function incompleteWorkerCpu(
  worker: WorkerTargetSummary,
  mapping: { readonly threadId: number; readonly pid: number } | null,
  reason: string,
): Extract<ProductionWorkerCpu, { readonly measurement: 'incomplete' }> {
  return {
    targetId: worker.targetId,
    url: worker.url,
    threadId: mapping?.threadId ?? null,
    pid: mapping?.pid ?? null,
    cpuMs: null,
    coveredCpuMs: null,
    taskCount: 0,
    nestedTaskCount: 0,
    incompleteTaskCount: 0,
    boundaryCrossingTaskCount: 0,
    measurement: 'incomplete',
    reason,
  }
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

type WorkerTaskObservation = {
  readonly sequence: number
  readonly ts: number | null
  readonly finish: number | null
  readonly tts: number | null
  readonly threadFinish: number | null
  readonly cpuUs: number | null
  readonly complete: boolean
  readonly crossesBoundary: boolean
}

function workerTask(
  event: unknown,
  mapping: { threadId: number; pid: number },
  interval: { start: number; end: number },
  sequence: number,
): WorkerTaskObservation[] {
  if (!event || typeof event !== 'object') return []
  const record: Record<string, unknown> = { ...event }
  if (record.name !== 'RunTask' || record.pid !== mapping.pid || record.tid !== mapping.threadId)
    return []
  const start = finiteNumber(record.ts)
  if (start === null) return [unknownTask(sequence)]
  if (start >= interval.end) return [zeroTask(sequence, start)]
  if (record.ph !== 'X') return [unknownTask(sequence, start)]
  const duration = finiteNonnegativeNumber(record.dur)
  if (duration === null) return [unknownTask(sequence, start)]
  const finish = start + duration
  if (finish <= interval.start) return []
  const crossesBoundary = start < interval.start || finish > interval.end
  const tts = finiteNumber(record.tts)
  const tdur = finiteNonnegativeNumber(record.tdur)
  const threadFinish = tts !== null && tdur !== null ? tts + tdur : null
  const complete = !crossesBoundary && tdur !== null
  return [
    {
      sequence,
      ts: start,
      finish,
      tts,
      threadFinish,
      cpuUs: complete ? tdur : null,
      complete,
      crossesBoundary,
    },
  ]
}

function zeroTask(sequence: number, ts: number): WorkerTaskObservation {
  return {
    sequence,
    ts,
    finish: ts,
    tts: null,
    threadFinish: null,
    cpuUs: 0,
    complete: true,
    crossesBoundary: false,
  }
}

function unknownTask(sequence: number, ts: number | null = null): WorkerTaskObservation {
  return {
    sequence,
    ts,
    finish: null,
    tts: null,
    threadFinish: null,
    cpuUs: null,
    complete: false,
    crossesBoundary: false,
  }
}

function selectOuterTasks(tasks: readonly WorkerTaskObservation[]) {
  return tasks.filter(
    (task) => !tasks.some((candidate) => candidate !== task && containsTask(candidate, task)),
  )
}

function containsTask(outer: WorkerTaskObservation, inner: WorkerTaskObservation) {
  if (!outer.complete || !inner.complete) return false
  if (
    outer.ts === null ||
    outer.finish === null ||
    outer.tts === null ||
    outer.threadFinish === null ||
    inner.ts === null ||
    inner.finish === null ||
    inner.tts === null ||
    inner.threadFinish === null
  )
    return false
  const wallContains = outer.ts <= inner.ts && inner.finish <= outer.finish
  const threadContains = outer.tts <= inner.tts && inner.threadFinish <= outer.threadFinish
  if (!wallContains || !threadContains) return false
  const strictContainment =
    outer.ts < inner.ts ||
    inner.finish < outer.finish ||
    outer.tts < inner.tts ||
    inner.threadFinish < outer.threadFinish
  return strictContainment || outer.sequence < inner.sequence
}

function hasOverlappingTaskSpans(tasks: readonly WorkerTaskObservation[]) {
  return tasks.some((task, index) =>
    tasks.slice(index + 1).some((other) => taskSpansOverlap(task, other)),
  )
}

function taskSpansOverlap(left: WorkerTaskObservation, right: WorkerTaskObservation) {
  if (left.ts === null || left.finish === null || right.ts === null || right.finish === null)
    return false
  if (left.ts < right.finish && right.ts < left.finish) return true
  if (
    left.tts === null ||
    left.threadFinish === null ||
    right.tts === null ||
    right.threadFinish === null
  )
    return false
  return left.tts < right.threadFinish && right.tts < left.threadFinish
}

function finiteNumber(value: unknown) {
  if (typeof value !== 'number') return null
  return Number.isFinite(value) ? value : null
}

function finiteNonnegativeNumber(value: unknown) {
  const number = finiteNumber(value)
  return number !== null && number >= 0 ? number : null
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
  const reconciliation = reconcileWorkerRequestCopies(page, worker)
  if (!reconciliation || reconciliation.page.transferReceiptError) return null
  return reconciliation.page
}

export function reconcileWorkerRequestCopies(
  page: ProductionNetworkRequest,
  worker: ProductionNetworkRequest,
) {
  if (
    page.target !== 'page' ||
    page.failure !== null ||
    page.transferReceiptError ||
    worker.target !== 'worker' ||
    worker.transferScope !== 'full-request' ||
    worker.workerTargetId === null ||
    worker.failure !== null ||
    worker.transferReceiptError ||
    transferredBytes(worker.transferredBytes) === null
  )
    return null
  if (worker.id !== worker.workerTargetId && page.workerTargetId !== worker.workerTargetId)
    return null
  if (page.id !== worker.id || page.url !== worker.url || page.kind !== worker.kind) return null
  const workerBytes = worker.transferredBytes
  if (page.transferredBytes !== null && page.transferredBytes !== workerBytes) {
    const transferReceiptError = 'Page and worker transfer receipts disagree.'
    return {
      page: {
        ...page,
        transferredBytes: null,
        transferReceiptError,
        resolvedByWorkerRequestId: worker.id,
      },
      worker: { ...worker, transferredBytes: null, transferReceiptError },
    }
  }
  return { page: { ...page, resolvedByWorkerRequestId: worker.id }, worker }
}

export function reconcileProductionNetworkRequests(network: readonly ProductionNetworkRequest[]) {
  const reconciled = Array.from(network)
  for (const [workerIndex, worker] of reconciled.entries()) {
    if (worker.target !== 'worker') continue
    const pageIndex = reconciled.findIndex(
      (request) =>
        request.target === 'page' &&
        request.id === worker.id &&
        request.url === worker.url &&
        request.kind === worker.kind,
    )
    if (pageIndex < 0) continue
    const reconciliation = reconcileWorkerRequestCopies(reconciled[pageIndex], worker)
    if (!reconciliation) continue
    reconciled[pageIndex] = reconciliation.page
    reconciled[workerIndex] = reconciliation.worker
  }
  return reconciled
}

type TraceResource = {
  readonly name: string
  readonly pid: number
  readonly tid: number
  readonly ts: number
  readonly data: Record<string, unknown>
}

function traceResource(event: unknown): TraceResource[] {
  if (!event || typeof event !== 'object') return []
  const record: Record<string, unknown> = { ...event }
  if (typeof record.name !== 'string' || !record.name.startsWith('Resource')) return []
  if (typeof record.pid !== 'number' || typeof record.tid !== 'number') return []
  if (typeof record.ts !== 'number' || !Number.isFinite(record.ts)) return []
  const data =
    record.args && typeof record.args === 'object' ? objectField(record.args, 'data') : null
  if (!data || typeof data !== 'object') return []
  return [{ name: record.name, pid: record.pid, tid: record.tid, ts: record.ts, data: { ...data } }]
}

export function completeWorkerBootstrapTransfer(
  events: readonly unknown[],
  workers: readonly WorkerTargetSummary[],
  request: ProductionNetworkRequest,
): ProductionNetworkRequest | null {
  if (request.target !== 'worker' || request.transferScope !== 'worker-bootstrap-completion')
    return null
  if (request.failure !== null || request.fromCache) return null
  const worker = workers.find(
    (entry) => entry.targetId === request.workerTargetId && entry.url === request.url,
  )
  if (!worker) return null
  const mappings = events.flatMap((event) => workerTraceMapping(event))
  const workerMappings = mappings.filter((entry) => entry.workerId === worker.targetId)
  if (workerMappings.length !== 1) return null
  const mapping = workerMappings[0]
  if (
    mappings.filter((entry) => entry.pid === mapping.pid && entry.threadId === mapping.threadId)
      .length !== 1
  )
    return null
  const resources = events
    .flatMap(traceResource)
    .filter((entry) => entry.pid === mapping.pid && entry.tid === mapping.threadId)
  const responses = resources.filter(
    (entry) =>
      entry.name === 'ResourceReceiveResponse' && entry.data.mimeType === 'text/javascript',
  )
  // The bootstrap's renderer request id differs from the target-scoped CDP alias.
  if (responses.length !== 1) return null
  const response = responses[0]
  const id = response.data.requestId
  if (typeof id !== 'string' || response.data.fromCache || response.data.fromServiceWorker)
    return null
  const parts = resources.filter((entry) => entry.data.requestId === id)
  const finishes = parts.filter((entry) => entry.name === 'ResourceFinish')
  if (finishes.length !== 1 || finishes[0].data.didFail !== false) return null
  const finish = finishes[0]
  if (finish.ts < response.ts) return null
  const chunks = parts.filter((entry) => entry.name === 'ResourceReceivedData')
  if (chunks.length === 0 || chunks.some((entry) => entry.ts < response.ts || entry.ts > finish.ts))
    return null
  const responseEncodedBytes = transferredBytes(response.data.encodedDataLength)
  const lengths = chunks.map((entry) => transferredBytes(entry.data.encodedDataLength))
  if (responseEncodedBytes === null || lengths.some((entry) => entry === null)) return null
  const receivedEncodedBytes = lengths.reduce<number>((total, entry) => total + (entry ?? 0), 0)
  return {
    ...request,
    transferredBytes: responseEncodedBytes + receivedEncodedBytes,
    transferScope: 'full-request',
    traceTransferReceipt: { requestId: id, responseEncodedBytes, receivedEncodedBytes },
  }
}
