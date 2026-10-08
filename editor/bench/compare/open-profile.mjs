export function installOpenProbe() {
  const probe = { diagnostics: [], messages: [], outputs: [], outputCount: 0 }
  globalThis.__compareOpenProbe = probe
  globalThis.__EDITOR_PERFORMANCE_DIAGNOSTICS__ = (event) => {
    probe.diagnostics.push(event)
  }
  const workers = []
  let nextInspection = -1
  probe.inspectRetention = async () =>
    Promise.all(
      workers.map(
        (worker) =>
          new Promise((resolve, reject) => {
            const id = nextInspection--
            const timer = setTimeout(() => {
              worker.removeEventListener('message', receive)
              reject(new RangeError('Worker retention inspection exceeded 30 seconds'))
            }, 30000)
            const receive = ({ data }) => {
              if (data?.id !== id) return
              clearTimeout(timer)
              worker.removeEventListener('message', receive)
              if (!data.ok || !data.result?.retention) {
                reject(new RangeError('Worker retention inspection returned no snapshot'))
                return
              }
              resolve({ worker: worker.probeId, ...data.result.retention })
            }
            worker.addEventListener('message', receive)
            worker.postMessage({ id, payload: { type: 'idleFence', includeRetention: true } })
          }),
      ),
    )
  let nextWorker = 0
  const OriginalWorker = globalThis.Worker
  globalThis.Worker = class extends OriginalWorker {
    constructor(...args) {
      super(...args)
      this.probeId = ++nextWorker
      workers.push(this)
      this.addEventListener('message', ({ data }) => {
        if (data?.result?.tokensPacked) {
          probe.outputCount++
          probe.outputs[0] = data.result
          probe.proof = undefined
        }
        probe.messages.push({
          direction: 'received',
          worker: this.probeId,
          at: performance.now(),
          id: data?.id,
          ok: data?.ok,
          hasResult: data?.result !== undefined,
          timings: data?.result?.timings,
          statistics: data?.result?.statistics,
          analysis: data?.result?.analysis,
          degraded: data?.result?.degraded,
          workerReceivedAt: data?.__compareReceivedAt,
          workerPostedAt: data?.__comparePostedAt,
          absoluteAt: performance.timeOrigin + performance.now(),
        })
      })
    }
    postMessage(...args) {
      const [data] = args
      const command = data?.payload?.command
      const sent = {
        direction: 'sent',
        worker: this.probeId,
        at: performance.now(),
        id: data?.id,
        absoluteAt: performance.timeOrigin + performance.now(),
        type: data?.payload?.type,
        resultMode: data?.payload?.resultMode,
        documentId: data?.payload?.documentId,
        runtimeSessionId: data?.payload?.runtimeSessionId,
        sourceCommand: command?.kind,
        sourceCodeUnits: command?.chunks?.reduce((sum, chunk) => sum + chunk.length, 0),
      }
      probe.messages.push(sent)
      const start = performance.now()
      try {
        return super.postMessage(...args)
      } finally {
        sent.postMessageMs = performance.now() - start
      }
    }
  }
}

function unionMs(spans) {
  const sorted = spans.toSorted((a, b) => a[0] - b[0])
  let end = -Infinity
  let total = 0
  for (const [start, stop] of sorted) {
    total += Math.max(0, stop - Math.max(start, end))
    end = Math.max(end, stop)
  }
  return total / 1000
}

export function summarizeOpenProfile(events, probe) {
  const marks = events.filter((event) => event.name.startsWith('compare-open-'))
  const start = marks.find((event) => event.name === 'compare-open-start')
  if (!start) throw new RangeError('Missing open-start trace marker')
  const settled = marks.find((event) => event.name === 'compare-open-settled')
  const end = settled?.ts ?? marks.find((event) => event.name === 'compare-open-capture-end')?.ts
  if (end === undefined) throw new RangeError('Missing open-end trace marker')
  const main = events.filter(
    (event) =>
      event.ph === 'X' &&
      event.pid === start.pid &&
      event.tid === start.tid &&
      event.ts < end &&
      event.ts + event.dur > start.ts,
  )
  const work = new Set([
    'FunctionCall',
    'EvaluateScript',
    'RunMicrotasks',
    'EventDispatch',
    'UpdateLayoutTree',
    'Layout',
    'PrePaint',
    'Paint',
    'CompositeLayers',
  ])
  const rendering = new Set(['UpdateLayoutTree', 'Layout', 'PrePaint', 'Paint', 'CompositeLayers'])
  const spans = (names) =>
    main
      .filter((event) => names.has(event.name))
      .map((event) => [Math.max(start.ts, event.ts), Math.min(end, event.ts + event.dur)])
  const requests = probe.messages
    .filter((message) => message.direction === 'sent')
    .map((sent) => {
      const received = probe.messages.find(
        (message) =>
          sent.id !== undefined &&
          message.direction === 'received' &&
          message.worker === sent.worker &&
          message.id === sent.id,
      )
      return {
        ...sent,
        receivedAt: received?.at,
        responseOk: received?.ok,
        returnedResult: received?.hasResult,
        roundTripMs: received ? received.at - sent.at : null,
        timings: received?.timings,
        statistics: received?.statistics,
        analysis: received?.analysis,
        degraded: received?.degraded,
        outboundMs:
          received?.workerReceivedAt === undefined
            ? null
            : received.workerReceivedAt - sent.absoluteAt,
        inboundMs:
          received?.workerPostedAt === undefined
            ? null
            : received.absoluteAt - received.workerPostedAt,
      }
    })
  const tasks = main.filter((event) =>
    ['RunTask', 'ThreadControllerImpl::RunTask'].includes(event.name),
  )
  return {
    completed: !!settled,
    startedAtMs: probe.startedAtMs,
    warmup: probe.warmup,
    marksMs: Object.fromEntries(marks.map((event) => [event.name, (event.ts - start.ts) / 1000])),
    mainTaskCount: tasks.length,
    largestMainTaskMs: tasks.length ? Math.max(...tasks.map((event) => event.dur / 1000)) : null,
    mainWorkMs: unionMs(spans(work)),
    mainRenderingMs: unionMs(spans(rendering)),
    requests,
    diagnostics: probe.diagnostics,
  }
}
