import { writeFile } from 'node:fs/promises'
import { isAbsolute, join, relative } from 'node:path'
import { inspect } from 'node:util'
import { StringDecoder } from 'node:string_decoder'
import type { EventEmitter } from 'node:events'
import * as v from 'valibot'

type ForwardOutcome =
  | { readonly kind: 'succeeded' }
  | { readonly kind: 'failed'; readonly error: unknown }
  | { readonly kind: 'cancelled' }

type ForwardSettlement = Exclude<ForwardOutcome, { readonly kind: 'cancelled' }>

type ForwardObservation = {
  readonly requestId: number
  readonly url: string
  readonly phase: 'operation' | 'restoration' | 'shutdown'
  readonly operationInvoked: boolean
  readonly registeredAt: number
  action: {
    kind: 'fulfill' | 'abort'
    selectedAt: number
    settledAt: number | null
    error: string | null
  } | null
  skippedActions: ('fulfill' | 'abort')[]
  terminal: { kind: ForwardOutcome['kind']; at: number } | null
  settlement: {
    kind: 'succeeded' | 'failed' | 'not-started'
    at: number
    error: string | null
  } | null
}

type RecordForwardError = (observation: ForwardObservation, stage: string, error: unknown) => void

type FulfillForward = (action: () => Promise<void>) => Promise<void>

function createRetentionRouteAction(
  observation: ForwardObservation,
  abort: () => Promise<void>,
  record: RecordForwardError,
) {
  let owned: Promise<void> | null = null
  const claim = (kind: 'fulfill' | 'abort', action: () => Promise<void>) => {
    if (observation.action) {
      observation.skippedActions.push(kind)
      return Promise.resolve()
    }
    const state: NonNullable<ForwardObservation['action']> = {
      kind,
      selectedAt: Date.now(),
      settledAt: null,
      error: null,
    }
    observation.action = state
    owned = performRetentionRouteAction(state, action).catch((error: unknown) => {
      record(observation, 'route-action-' + kind, error)
      throw error
    })
    void owned.catch(() => {})
    return owned
  }
  return {
    fulfill: (action: () => Promise<void>) => claim('fulfill', action),
    abort: () => claim('abort', abort),
    join: () => owned ?? Promise.resolve(),
  }
}

async function performRetentionRouteAction(
  state: NonNullable<ForwardObservation['action']>,
  action: () => Promise<void>,
) {
  try {
    await action()
    state.settledAt = Date.now()
  } catch (error) {
    state.settledAt = Date.now()
    state.error = String(error)
    throw error
  }
}

function createRetentionForward(
  observation: ForwardObservation,
  record: RecordForwardError,
  failed: (error: unknown) => void,
) {
  let outcome: ForwardOutcome | null = null
  let resolve: (value: ForwardOutcome) => void = () => {}
  const terminal = new Promise<ForwardOutcome>((complete) => {
    resolve = complete
  })
  const select = (value: ForwardOutcome) => {
    if (outcome) return false
    outcome = value
    observation.terminal = { kind: value.kind, at: Date.now() }
    if (value.kind === 'failed') {
      record(observation, 'forward', value.error)
      failed(value.error)
    }
    resolve(value)
    return true
  }
  return { terminal, select, cancel: () => select({ kind: 'cancelled' }) }
}

async function observeRetentionForward(
  operation: () => Promise<void>,
  select: (outcome: ForwardOutcome) => void,
): Promise<ForwardSettlement> {
  try {
    await operation()
    const outcome: ForwardSettlement = { kind: 'succeeded' }
    select(outcome)
    return outcome
  } catch (error) {
    const outcome: ForwardSettlement = { kind: 'failed', error }
    select(outcome)
    return outcome
  }
}

async function completeRetentionForward(
  observation: ForwardObservation,
  terminal: Promise<ForwardOutcome>,
  actual: Promise<ForwardSettlement> | null,
  routeAction: ReturnType<typeof createRetentionRouteAction>,
  record: RecordForwardError,
) {
  const outcome = await terminal
  if (outcome.kind !== 'succeeded') {
    void routeAction.abort().catch(() => {})
  }
  if (!actual) {
    observation.settlement = { kind: 'not-started', at: Date.now(), error: null }
    await routeAction.join().catch(() => {})
    return
  }
  const settled = await actual
  observation.settlement = {
    kind: settled.kind === 'failed' ? 'failed' : 'succeeded',
    at: Date.now(),
    error: settled.kind === 'failed' ? String(settled.error) : null,
  }
  if (outcome.kind === 'cancelled' && settled.kind === 'failed')
    record(observation, 'settled-after-owned-cancellation', settled.error)
  await routeAction.join().catch(() => {})
}

export function createRetentionReloadTransport() {
  const tasks = new Set<Promise<void>>()
  const routeActions: ReturnType<typeof createRetentionRouteAction>[] = []
  const pending = new Set<() => void>()
  const requests: ForwardObservation[] = []
  const failures: { requestId: number; url: string; at: number; stage: string; error: string }[] =
    []
  let phase: ForwardObservation['phase'] = 'operation'
  let admitting = true
  let firstFailure: { error: unknown } | null = null
  let fail: (error: unknown) => void = () => {}
  const failure = new Promise<unknown>((resolve) => {
    fail = resolve
  })
  const record: RecordForwardError = (observation, stage, error) => {
    failures.push({
      requestId: observation.requestId,
      url: observation.url,
      at: Date.now(),
      stage,
      error: error instanceof Error ? error.message : String(error),
    })
  }
  const failed = (error: unknown) => {
    if (firstFailure) return
    firstFailure = { error }
    fail(error)
  }
  return {
    failures,
    requests,
    get firstError() {
      return firstFailure?.error
    },
    get hasFailure() {
      return firstFailure !== null
    },
    get needsContextClose() {
      return requests.some(
        (request) =>
          request.action !== null &&
          (request.action.settledAt === null || request.action.error !== null),
      )
    },
    beginRestoration() {
      phase = 'restoration'
    },
    stopAdmission() {
      admitting = false
      phase = 'shutdown'
    },
    async cancelPending() {
      await Promise.resolve()
      for (const cancel of pending) cancel()
    },
    async race<T>(operation: Promise<T>): Promise<T> {
      return Promise.race([
        operation,
        failure.then((error): never => {
          throw error
        }),
      ])
    },
    run(
      url: string,
      operation: (fulfill: FulfillForward) => Promise<void>,
      abort: () => Promise<void>,
    ) {
      const observation: ForwardObservation = {
        requestId: requests.length + 1,
        url,
        phase,
        operationInvoked: admitting,
        registeredAt: Date.now(),
        action: null,
        skippedActions: [],
        terminal: null,
        settlement: null,
      }
      requests.push(observation)
      const request = createRetentionForward(observation, record, failed)
      const routeAction = createRetentionRouteAction(observation, abort, record)
      routeActions.push(routeAction)
      const cancel = () => {
        if (!request.cancel()) return
        void routeAction.abort().catch(() => {})
      }
      pending.add(cancel)
      const actual = admitting
        ? observeRetentionForward(() => operation(routeAction.fulfill), request.select)
        : null
      if (!admitting) request.cancel()
      const task = completeRetentionForward(
        observation,
        request.terminal,
        actual,
        routeAction,
        record,
      )
      tasks.add(task)
      return task.finally(() => {
        pending.delete(cancel)
        tasks.delete(task)
      })
    },
    async drain() {
      await Promise.all(tasks)
      await Promise.all(routeActions.map((action) => action.join()))
    },
  }
}

export async function archiveRetentionReloadArtifact(
  output: string,
  name: string,
  payload: unknown,
) {
  const failures: unknown[] = []
  try {
    await writeFile(join(output, name), JSON.stringify(payload))
  } catch (error) {
    failures.push(error)
    try {
      const diagnostic = inspect(
        { artifact: name, failures, payload },
        {
          depth: null,
          maxArrayLength: null,
          maxStringLength: null,
          customInspect: false,
        },
      )
      await writeFile(join(output, name + '.fallback.txt'), diagnostic)
    } catch (fallbackError) {
      failures.push(fallbackError)
    }
  }
  return failures
}

export function archiveRetentionReloadFailure(output: string, payload: unknown) {
  return archiveRetentionReloadArtifact(output, 'failed-raw.json', payload)
}

export async function settleRetentionReloadCleanup(
  actions: readonly {
    readonly stage: string
    readonly run: () => Promise<unknown>
  }[],
) {
  const outcomes: { stage: string; at: number; error: unknown }[] = []
  for (const action of actions) {
    try {
      await action.run()
      outcomes.push({ stage: action.stage, at: Date.now(), error: null })
    } catch (error) {
      outcomes.push({ stage: action.stage, at: Date.now(), error })
    }
  }
  return outcomes
}

export const retentionEntryReceiptLimits = {
  records: 32768,
  bytes: 8 * 1024 * 1024,
  recordBytes: 4096,
  pathBytes: 1024,
} as const

export const retentionEntryReceiptPrefix = 'retention-entry-receipt '

function isReceiptPath(path: string) {
  if (
    !path.startsWith('/') ||
    Buffer.byteLength(path) > retentionEntryReceiptLimits.pathBytes ||
    /[?#\\]/.test(path) ||
    path.split('/').includes('..')
  )
    return false
  for (const character of path) {
    const code = character.charCodeAt(0)
    if (code < 32 || code === 127) return false
  }
  return true
}

export function retentionEntryModulePath(root: string, target: string) {
  try {
    const url = new URL(target, 'http://localhost')
    if (url.username || url.password) return null
    const pathname = decodeURIComponent(url.pathname)
    if (!pathname.startsWith('/@fs/')) {
      const path = '/apps/web' + pathname
      return isReceiptPath(path) ? path : null
    }
    const full = pathname.slice(4).replace(/^\/([a-zA-Z]:\/)/, '$1')
    const local = relative(root, full)
    if (local === '..' || local.startsWith('../') || local.startsWith('..\\') || isAbsolute(local))
      return null
    const path = '/' + local.replaceAll('\\', '/')
    return isReceiptPath(path) ? path : null
  } catch {
    return null
  }
}

export function guardRetentionEntryObservation(observe: () => void) {
  try {
    observe()
  } catch {}
}

// Observing emit preserves the emitter's existing error listeners and throws.
export function observeRetentionEntryEvents(
  emitter: EventEmitter,
  observe: (event: string | symbol, args: readonly unknown[]) => void,
) {
  const original = emitter.emit
  emitter.emit = function (event, ...args: unknown[]) {
    guardRetentionEntryObservation(() => observe(event, args))
    return Reflect.apply(original, this, [event, ...args])
  }
}

export function retentionEntryErrorCode(error: unknown) {
  try {
    if (!error || typeof error !== 'object' || !('code' in error)) return null
    const code = error.code
    return typeof code === 'string' && /^[A-Z][A-Z0-9_]{0,63}$/.test(code) ? code : null
  } catch {
    return null
  }
}

export function retentionEntryReceiptTime() {
  return { at: Date.now(), pid: process.pid, tick: process.hrtime.bigint().toString() }
}

const receiptInteger = v.pipe(
  v.number(),
  v.integer(),
  v.minValue(0),
  v.maxValue(Number.MAX_SAFE_INTEGER),
)
const receiptStatus = v.pipe(v.number(), v.integer(), v.minValue(100), v.maxValue(599))
const receiptCode = v.nullable(v.pipe(v.string(), v.regex(/^[A-Z][A-Z0-9_]{0,63}$/)))
const receiptPath = v.pipe(v.string(), v.check(isReceiptPath))
const receiptPhase = v.picklist([
  'entry',
  'entry-owner',
  'fixture-open',
  'baseline-ready',
  'reload',
  'code-font-loaded',
])
export type RetentionEntryPhase = v.InferOutput<typeof receiptPhase>
const receiptBase = {
  at: receiptInteger,
  pid: receiptInteger,
  tick: v.pipe(v.string(), v.regex(/^\d{1,24}$/)),
}
const entryReceiptSchema = v.variant('kind', [
  v.strictObject({
    ...receiptBase,
    kind: v.literal('installed'),
    port: receiptInteger,
    keepAliveTimeout: receiptInteger,
    headersTimeout: receiptInteger,
    requestTimeout: receiptInteger,
    maxRequestsPerSocket: receiptInteger,
  }),
  v.strictObject({ ...receiptBase, kind: v.literal('listening'), port: receiptInteger }),
  v.strictObject({
    ...receiptBase,
    kind: v.literal('request'),
    requestId: receiptInteger,
    socketId: receiptInteger,
    path: receiptPath,
    method: v.picklist(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']),
  }),
  v.strictObject({
    ...receiptBase,
    kind: v.picklist(['response-finish', 'response-close']),
    requestId: receiptInteger,
    socketId: receiptInteger,
    path: receiptPath,
    status: receiptStatus,
    complete: v.boolean(),
  }),
  v.strictObject({
    ...receiptBase,
    kind: v.literal('request-aborted'),
    requestId: receiptInteger,
    socketId: receiptInteger,
  }),
  v.strictObject({
    ...receiptBase,
    kind: v.picklist(['request-error', 'response-error']),
    requestId: receiptInteger,
    socketId: receiptInteger,
    code: receiptCode,
  }),
  v.strictObject({
    ...receiptBase,
    kind: v.literal('socket-open'),
    socketId: receiptInteger,
    port: receiptInteger,
  }),
  v.strictObject({
    ...receiptBase,
    kind: v.picklist(['socket-end', 'socket-timeout', 'socket-close']),
    socketId: receiptInteger,
  }),
  v.strictObject({
    ...receiptBase,
    kind: v.literal('socket-error'),
    socketId: receiptInteger,
    code: receiptCode,
  }),
  v.strictObject({
    ...receiptBase,
    kind: v.picklist([
      'server-close',
      'optimizer-bundling',
      'optimizer-optimized',
      'optimizer-reload',
      'optimizer-error',
      'full-reload',
    ]),
  }),
  v.strictObject({ ...receiptBase, kind: v.literal('server-error'), code: receiptCode }),
  v.strictObject({ ...receiptBase, kind: v.literal('process-start'), childPid: receiptInteger }),
  v.strictObject({
    ...receiptBase,
    kind: v.literal('process-stop'),
    childPid: receiptInteger,
    signal: v.picklist(['SIGTERM', 'SIGKILL']),
  }),
  v.strictObject({
    ...receiptBase,
    kind: v.literal('process-exit'),
    childPid: receiptInteger,
    exitCode: v.nullable(receiptInteger),
    signal: v.nullable(v.picklist(['SIGTERM', 'SIGKILL'])),
  }),
  v.strictObject({
    ...receiptBase,
    kind: v.literal('route-failure'),
    transportRequestId: receiptInteger,
    path: receiptPath,
  }),
  v.strictObject({ ...receiptBase, kind: v.literal('refused'), count: receiptInteger }),
])
type RetentionEntryReceiptEvent = v.InferOutput<typeof entryReceiptSchema>
export function writeRetentionEntryReceipt(input: unknown) {
  guardRetentionEntryObservation(() => {
    const parsed = v.safeParse(entryReceiptSchema, input)
    const event = parsed.success
      ? parsed.output
      : { ...retentionEntryReceiptTime(), kind: 'refused', count: 1 }
    process.stdout.write(retentionEntryReceiptPrefix + JSON.stringify(event) + '\n')
  })
}

type ReceiptRecord = {
  readonly event: RetentionEntryReceiptEvent
  readonly bytes: number
  readonly sequence: number
}
type FailureReceipt = {
  readonly phase: RetentionEntryPhase
  readonly sequence: number
  readonly at: number
  readonly records: readonly ReceiptRecord[]
  readonly predecessors: readonly ReceiptRecord[]
  readonly lifetime: readonly ReceiptRecord[]
  endedAt: number | null
}

const lifetimeKinds = new Set<RetentionEntryReceiptEvent['kind']>([
  'installed',
  'listening',
  'process-start',
  'process-stop',
  'process-exit',
  'optimizer-bundling',
  'optimizer-optimized',
  'optimizer-reload',
  'optimizer-error',
  'server-close',
  'server-error',
  'full-reload',
])
// Reserve both owned stop signals so a full frozen window can still retain teardown.
const lifetimeSlots = lifetimeKinds.size + 1

function lifetimeKey(event: RetentionEntryReceiptEvent) {
  if (event.kind === 'process-stop') return event.kind + '-' + event.signal
  return event.kind
}

async function archiveEntryReceipt(output: string, payload: unknown) {
  const codes: (string | null)[] = []
  try {
    await writeFile(join(output, 'entry-transport.json'), JSON.stringify(payload))
    return { status: 'written' as const, codes }
  } catch (error) {
    codes.push(retentionEntryErrorCode(error))
  }
  try {
    await writeFile(
      join(output, 'entry-transport.json.fallback.txt'),
      JSON.stringify({ persistence: { status: 'fallback-written', codes }, receipt: payload }),
    )
    return { status: 'fallback-written' as const, codes }
  } catch (error) {
    codes.push(retentionEntryErrorCode(error))
  }
  return { status: 'unavailable' as const, codes }
}

export function createRetentionEntryCapture() {
  const records = new Map<number, ReceiptRecord>()
  const lifetime = new Map<string, ReceiptRecord>()
  const cases = new Map<string, { readonly start: number; failure: FailureReceipt | null }>()
  const decoder = new StringDecoder('utf8')
  const counts = new Map<RetentionEntryReceiptEvent['kind'], number>()
  const statusCounts = new Map<number, number>()
  let sequence = 0
  let bytes = 0
  let lifetimeBytes = 0
  let pinnedBytes = 0
  let pinnedRecords = 0
  let pending = ''
  let discardLine = false
  let ordinaryLine = false
  let wireEndObserved = false
  let refused = 0
  let dropped = 0
  const makeRoom = (count: number, size: number) => {
    while (
      records.size + lifetimeSlots + pinnedRecords + count > retentionEntryReceiptLimits.records ||
      bytes + lifetimeSlots * retentionEntryReceiptLimits.recordBytes + pinnedBytes + size >
        retentionEntryReceiptLimits.bytes
    ) {
      const first = records.keys().next().value
      if (first === undefined) return false
      bytes -= records.get(first)?.bytes ?? 0
      records.delete(first)
      dropped++
    }
    return true
  }
  const retain = (event: RetentionEntryReceiptEvent) => {
    const size = Buffer.byteLength(JSON.stringify(event))
    if (size > retentionEntryReceiptLimits.recordBytes) {
      refused++
      return
    }
    counts.set(event.kind, (counts.get(event.kind) ?? 0) + 1)
    if (event.kind === 'response-finish')
      statusCounts.set(event.status, (statusCounts.get(event.status) ?? 0) + 1)
    const record = Object.freeze({ event: Object.freeze(event), bytes: size, sequence: ++sequence })
    if (lifetimeKinds.has(event.kind)) {
      const key = lifetimeKey(event)
      const previous = lifetime.get(key)
      lifetimeBytes -= previous?.bytes ?? 0
      lifetime.set(key, record)
      lifetimeBytes += size
    }
    if (!makeRoom(1, size)) {
      dropped++
      return
    }
    records.set(record.sequence, record)
    bytes += size
  }
  const accept = (input: unknown) => {
    try {
      const parsed = v.safeParse(entryReceiptSchema, input)
      if (!parsed.success) {
        refused++
        return
      }
      if (parsed.output.kind === 'refused') {
        refused += parsed.output.count
        return
      }
      retain(parsed.output)
    } catch {
      refused++
    }
  }
  const line = (value: string) => {
    if (!value.startsWith(retentionEntryReceiptPrefix)) return
    try {
      accept(JSON.parse(value.slice(retentionEntryReceiptPrefix.length)))
    } catch {
      refused++
    }
  }
  const character = (value: string, other: (value: string) => void) => {
    if (ordinaryLine) {
      other(value)
      if (value === '\n') ordinaryLine = false
      return
    }
    if (value === '\n') {
      if (!discardLine && pending.startsWith(retentionEntryReceiptPrefix)) line(pending)
      if (!discardLine && !pending.startsWith(retentionEntryReceiptPrefix)) other(pending + value)
      pending = ''
      discardLine = false
      return
    }
    if (discardLine) return
    pending += value
    if (
      pending.length <= retentionEntryReceiptPrefix.length &&
      !retentionEntryReceiptPrefix.startsWith(pending)
    ) {
      other(pending)
      pending = ''
      ordinaryLine = true
      return
    }
    if (
      Buffer.byteLength(pending) <=
      retentionEntryReceiptLimits.recordBytes + retentionEntryReceiptPrefix.length
    )
      return
    pending = ''
    discardLine = true
    refused++
  }
  const freeze = (output: string, phase: RetentionEntryPhase) => {
    const owner = cases.get(output)
    if (!owner || owner.failure) return
    const history = [...lifetime.values()]
    const historyBytes = history.reduce((total, record) => total + record.bytes, 0)
    if (!makeRoom(history.length, historyBytes)) {
      dropped += history.length
      history.length = 0
    }
    const window = [...records.values()].filter((record) => record.sequence > owner.start)
    const paths = new Set(
      window.flatMap((record) =>
        record.event.kind === 'route-failure' ? [record.event.path] : [],
      ),
    )
    const predecessors = new Map<string, ReceiptRecord>()
    for (const record of records.values()) {
      const event = record.event
      if (
        record.sequence > owner.start ||
        event.kind !== 'response-finish' ||
        !event.complete ||
        !paths.has(event.path)
      )
        continue
      predecessors.set(event.path, record)
    }
    const prior = [...predecessors.values()]
    for (const record of [...window, ...prior]) {
      records.delete(record.sequence)
      bytes -= record.bytes
    }
    pinnedBytes +=
      window.reduce((total, record) => total + record.bytes, 0) +
      prior.reduce((total, record) => total + record.bytes, 0) +
      history.reduce((total, record) => total + record.bytes, 0)
    pinnedRecords += window.length + prior.length + history.length
    owner.failure = {
      phase,
      sequence,
      at: Date.now(),
      records: window,
      predecessors: prior,
      lifetime: history,
      endedAt: null,
    }
  }
  return {
    accept,
    read(chunk: Buffer, other?: (value: string) => void) {
      try {
        let ordinary = ''
        for (const value of decoder.write(chunk))
          character(value, (value) => {
            ordinary += value
          })
        if (ordinary) other?.(ordinary)
      } catch {
        refused++
      }
    },
    finishWire() {
      guardRetentionEntryObservation(() => {
        const final = decoder.end()
        for (const value of final) character(value, () => {})
        wireEndObserved = true
        if (pending.startsWith(retentionEntryReceiptPrefix) || discardLine) refused++
        pending = ''
        discardLine = false
      })
    },
    begin(output: string) {
      guardRetentionEntryObservation(() => cases.set(output, { start: sequence, failure: null }))
    },
    fail(output: string, phase: RetentionEntryPhase) {
      guardRetentionEntryObservation(() => freeze(output, phase))
    },
    end(output: string) {
      guardRetentionEntryObservation(() => {
        const owner = cases.get(output)
        if (owner?.failure) {
          owner.failure.endedAt = Date.now()
          return
        }
        cases.delete(output)
      })
    },
    inspect() {
      return {
        refused,
        dropped,
        retainedBytes: bytes + lifetimeBytes + pinnedBytes,
        retainedRecords: records.size + lifetime.size + pinnedRecords,
        wireEndObserved,
        pendingWireBytes: Buffer.byteLength(pending),
      }
    },
    async persistFailures() {
      const tailRecords = new Map(records)
      for (const record of lifetime.values()) tailRecords.set(record.sequence, record)
      for (const owner of cases.values()) {
        if (!owner.failure) continue
        for (const record of [
          ...owner.failure.records,
          ...owner.failure.predecessors,
          ...owner.failure.lifetime,
        ])
          tailRecords.set(record.sequence, record)
      }
      const tail = [...tailRecords.values()].sort((a, b) => a.sequence - b.sequence)
      const results: Awaited<ReturnType<typeof archiveEntryReceipt>>[] = []
      for (const [output, owner] of cases) {
        if (!owner.failure) continue
        const failure = owner.failure
        const missingFacts = ['installed', 'listening', 'process-start'].filter(
          (kind) => !failure.lifetime.some((record) => record.event.kind === kind),
        )
        const result = await archiveEntryReceipt(output, {
          version: 1,
          availability: missingFacts.length === 0 ? 'observed' : 'partial',
          missingFacts,
          phase: failure.phase,
          failedAt: failure.at,
          endedAt: failure.endedAt,
          refused,
          dropped,
          wireEndObserved,
          pendingWireBytes: Buffer.byteLength(pending),
          optimizerCoverage: 'public-log-markers',
          lifetimeCounts: Object.fromEntries(counts),
          lifetimeStatusCounts: Object.fromEntries(statusCounts),
          truncated: dropped > 0,
          lifetimeBeforeFailure: failure.lifetime.map((record) => record.event),
          sameModulePredecessors: failure.predecessors.map((record) => record.event),
          failureWindow: failure.records.map((record) => record.event),
          postFailureTail: tail
            .filter((record) => record.sequence > failure.sequence)
            .map((record) => record.event),
        })
        results.push(result)
      }
      return results
    },
  }
}

type RetentionEntryCapture = ReturnType<typeof createRetentionEntryCapture>
declare global {
  var __retentionEntryCaptures: Map<string, RetentionEntryCapture> | undefined
}
function entryCaptures() {
  return (globalThis.__retentionEntryCaptures ??= new Map())
}
export function registerRetentionEntryCapture(origin: string, capture: RetentionEntryCapture) {
  guardRetentionEntryObservation(() => entryCaptures().set(origin, capture))
}
export function releaseRetentionEntryCapture(origin: string) {
  guardRetentionEntryObservation(() => entryCaptures().delete(origin))
}
export function beginRetentionEntryCase(origin: string, output: string) {
  guardRetentionEntryObservation(() => entryCaptures().get(origin)?.begin(output))
}
export function failRetentionEntryCase(
  origin: string,
  output: string,
  phase: RetentionEntryPhase,
  requests: readonly { readonly requestId: number; readonly url: string }[] = [],
) {
  guardRetentionEntryObservation(() => {
    const capture = entryCaptures().get(origin)
    if (!capture) return
    for (const request of requests) {
      const path = retentionEntryModulePath(join(import.meta.dirname, '../../../..'), request.url)
      if (path)
        capture.accept({
          ...retentionEntryReceiptTime(),
          kind: 'route-failure',
          transportRequestId: request.requestId,
          path,
        })
    }
    capture.fail(output, phase)
  })
}
export function endRetentionEntryCase(origin: string, output: string) {
  guardRetentionEntryObservation(() => entryCaptures().get(origin)?.end(output))
}
