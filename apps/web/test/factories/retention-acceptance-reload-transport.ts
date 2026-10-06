import { open, writeFile } from 'node:fs/promises'
import { createWriteStream } from 'node:fs'
import { constants } from 'node:os'
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

function isReceiptPath(path: string, maximumBytes: number = retentionEntryReceiptLimits.pathBytes) {
  if (
    !path.startsWith('/') ||
    Buffer.byteLength(path) > maximumBytes ||
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

function originalReceiptPath(target: string) {
  const raw = target.split(/[?#]/, 1)[0] ?? ''
  if (raw.startsWith('/')) return raw
  return /^[a-z][a-z0-9+.-]*:\/\/[^/]*(\/.*)?$/i.exec(raw)?.[1] ?? null
}

function isOriginalReceiptPath(path: string) {
  return (
    isReceiptPath(path, retentionEntryReceiptLimits.recordBytes) && !path.split('/').includes('.')
  )
}

export function retentionEntryModulePath(root: string, target: string) {
  try {
    const original = originalReceiptPath(target)
    if (!original || !isOriginalReceiptPath(original)) return null
    const pathname = decodeURIComponent(original)
    if (!isOriginalReceiptPath(pathname)) return null
    const url = new URL(target, 'http://localhost')
    if (url.username || url.password || !['http:', 'https:'].includes(url.protocol)) return null
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
const receiptSignal = v.pipe(
  v.string(),
  v.check((value) => Object.hasOwn(constants.signals, value)),
)
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
    signal: v.nullable(receiptSignal),
  }),
  v.strictObject({
    ...receiptBase,
    kind: v.literal('route-failure'),
    transportRequestId: receiptInteger,
    path: receiptPath,
  }),
  v.strictObject({ ...receiptBase, kind: v.literal('refused'), count: receiptInteger }),
  v.strictObject({
    ...receiptBase,
    kind: v.literal('writer-status'),
    dropped: receiptInteger,
    refused: receiptInteger,
    unavailable: v.boolean(),
    code: receiptCode,
  }),
])
type RetentionEntryReceiptEvent = v.InferOutput<typeof entryReceiptSchema>
const wireRecordBytes =
  retentionEntryReceiptLimits.recordBytes + Buffer.byteLength(retentionEntryReceiptPrefix) + 1
let receiptWriter: ReturnType<typeof createRetentionEntryWriter> | undefined

function createRetentionEntryWriter() {
  // This stream owns diagnostic errors and never closes stdout's descriptor.
  const output = createWriteStream('', { fd: 1, autoClose: false })
  let pendingBytes = 0
  let dropped = 0
  let refused = 0
  let unavailable = false
  let code: string | null = null
  let reportedDropped = 0
  let reportedRefused = 0
  const failed = (error: unknown) => {
    if (unavailable) return
    unavailable = true
    code = retentionEntryErrorCode(error)
    if (pendingBytes) dropped++
    pendingBytes = 0
  }
  output.on('error', failed)
  const send = (event: RetentionEntryReceiptEvent) => {
    const frame = Buffer.from(retentionEntryReceiptPrefix + JSON.stringify(event) + '\n')
    if (frame.length > wireRecordBytes) {
      refused++
      return
    }
    pendingBytes = frame.length
    try {
      output.write(frame, completed)
    } catch (error) {
      failed(error)
    }
  }
  const completed = (error?: Error | null) => {
    if (error) {
      failed(error)
      return
    }
    pendingBytes = 0
    if (unavailable || (reportedDropped === dropped && reportedRefused === refused)) return
    reportedDropped = dropped
    reportedRefused = refused
    send({
      ...retentionEntryReceiptTime(),
      kind: 'writer-status',
      dropped,
      refused,
      unavailable,
      code,
    })
  }
  return {
    write(input: unknown) {
      try {
        const parsed = v.safeParse(entryReceiptSchema, input)
        if (!parsed.success) {
          refused++
          return
        }
        if (unavailable || pendingBytes) {
          dropped++
          return
        }
        send(parsed.output)
      } catch {
        refused++
      }
    },
    inspect() {
      return {
        pendingBytes,
        pendingRecords: pendingBytes ? 1 : 0,
        dropped,
        refused,
        unavailable,
        code,
      }
    },
  }
}

export function writeRetentionEntryReceipt(input: unknown) {
  try {
    receiptWriter ??= createRetentionEntryWriter()
    receiptWriter.write(input)
    return receiptWriter
  } catch {
    return undefined
  }
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
  'writer-status',
])
// Reserve both owned stop signals so a full frozen window can still retain teardown.
const lifetimeSlots = lifetimeKinds.size + 1

function lifetimeKey(event: RetentionEntryReceiptEvent) {
  if (event.kind === 'process-stop') return event.kind + '-' + event.signal
  return event.kind
}

function* entryJsonChunks(value: unknown): Generator<Buffer> {
  if (Array.isArray(value)) {
    yield Buffer.from('[')
    for (let index = 0; index < value.length; index++) {
      yield Buffer.from(index ? ',' : '')
      yield* entryJsonChunks(value[index])
    }
    yield Buffer.from(']')
    return
  }
  if (value && typeof value === 'object' && 'kind' in value) {
    yield Buffer.from(JSON.stringify(value))
    return
  }
  if (value && typeof value === 'object') {
    yield Buffer.from('{')
    let separator = ''
    for (const [key, item] of Object.entries(value)) {
      yield Buffer.from(separator + JSON.stringify(key) + ':')
      yield* entryJsonChunks(item)
      separator = ','
    }
    yield Buffer.from('}')
    return
  }
  const encoded = Buffer.from(JSON.stringify(value))
  for (let offset = 0; offset < encoded.length; offset += retentionEntryReceiptLimits.recordBytes)
    yield encoded.subarray(offset, offset + retentionEntryReceiptLimits.recordBytes)
}

function* entryPacketBuffers(payload: unknown) {
  const pending = Buffer.alloc(wireRecordBytes)
  let size = 0
  for (const chunk of entryJsonChunks(payload)) {
    if (size + chunk.length > pending.length) {
      yield pending.subarray(0, size)
      size = 0
    }
    chunk.copy(pending, size)
    size += chunk.length
  }
  if (size) yield pending.subarray(0, size)
}

async function writeEntryPacketFile(path: string, payload: unknown) {
  const file = await open(path, 'w')
  try {
    for (const chunk of entryPacketBuffers(payload)) await writeEntryPacketChunk(file, chunk)
  } finally {
    await file.close()
  }
}

async function writeEntryPacketChunk(file: Awaited<ReturnType<typeof open>>, chunk: Buffer) {
  let offset = 0
  while (offset < chunk.length) {
    const { bytesWritten } = await file.write(chunk.subarray(offset))
    if (!bytesWritten) throw { code: 'EIO' }
    offset += bytesWritten
  }
}

async function archiveEntryReceipt(
  output: string,
  payload: unknown,
  name: 'entry-transport.json' | 'entry-transport.frozen.json' = 'entry-transport.json',
) {
  const codes: (string | null)[] = []
  try {
    await writeEntryPacketFile(join(output, name), payload)
    return { status: 'written' as const, codes }
  } catch (error) {
    codes.push(retentionEntryErrorCode(error))
  }
  try {
    await writeEntryPacketFile(join(output, name + '.fallback.txt'), {
      persistence: { status: 'fallback-written', codes },
      receipt: payload,
    })
    return { status: 'fallback-written' as const, codes }
  } catch (error) {
    codes.push(retentionEntryErrorCode(error))
  }
  return { status: 'unavailable' as const, codes }
}

export function createRetentionEntryCapture() {
  const records = new Map<number, ReceiptRecord>()
  const lifetime = new Map<string, ReceiptRecord>()
  const completions = new Map<string, ReceiptRecord>()
  type Owner = {
    readonly start: number
    readonly bytes: number
    failure: FailureReceipt | null
    immediate: Promise<Awaited<ReturnType<typeof archiveEntryReceipt>>> | null
    immediateStatus: Awaited<ReturnType<typeof archiveEntryReceipt>> | null
    immediateCompletedAt: number | null
  }
  const cases = new Map<string, Owner>()
  const decoder = new StringDecoder('utf8')
  const strictDecoder = new TextDecoder('utf-8', { fatal: true })
  const prefix = Buffer.from(retentionEntryReceiptPrefix)
  const pending = Buffer.alloc(wireRecordBytes)
  const counts = new Map<RetentionEntryReceiptEvent['kind'], number>()
  const statusCounts = new Map<number, number>()
  let sequence = 0,
    bytes = 0,
    lifetimeBytes = 0,
    completionBytes = 0,
    caseBytes = 0,
    pinnedBytes = 0,
    pinnedRecords = 0
  let pendingLength = 0,
    discardLine = false,
    ordinaryLine = false,
    wireEndObserved = false
  let refused = 0,
    dropped = 0,
    writerDropped = 0,
    writerRefused = 0
  const makeRoom = (count: number, size: number) => {
    while (
      records.size + completions.size + pinnedRecords + lifetimeSlots + cases.size * 3 + 2 + count >
        retentionEntryReceiptLimits.records ||
      bytes +
        completionBytes +
        pinnedBytes +
        caseBytes +
        lifetimeSlots * retentionEntryReceiptLimits.recordBytes +
        wireRecordBytes * 2 +
        size >
        retentionEntryReceiptLimits.bytes
    ) {
      const first = records.keys().next().value
      if (first !== undefined) {
        bytes -= records.get(first)?.bytes ?? 0
        records.delete(first)
        dropped++
        continue
      }
      const path = completions.keys().next().value
      if (path === undefined) return false
      completionBytes -= completions.get(path)?.bytes ?? 0
      completions.delete(path)
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
      lifetimeBytes -= lifetime.get(key)?.bytes ?? 0
      lifetime.set(key, record)
      lifetimeBytes += size
    }
    const completed = event.kind === 'response-finish' && event.complete
    if (completed) {
      completionBytes -= completions.get(event.path)?.bytes ?? 0
      completions.delete(event.path)
    }
    if (!makeRoom(completed ? 2 : 1, completed ? size * 2 : size)) {
      dropped++
      return
    }
    if (completed) {
      completions.set(event.path, record)
      completionBytes += size
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
      if (parsed.output.kind === 'writer-status') {
        writerDropped = Math.max(writerDropped, parsed.output.dropped)
        writerRefused = Math.max(writerRefused, parsed.output.refused)
      }
      retain(parsed.output)
    } catch {
      refused++
    }
  }
  const receiveLine = () => {
    try {
      accept(JSON.parse(strictDecoder.decode(pending.subarray(prefix.length, pendingLength))))
    } catch {
      refused++
    }
  }
  const byte = (value: number, other: (value: number) => void) => {
    if (ordinaryLine) {
      other(value)
      if (value === 10) ordinaryLine = false
      return
    }
    if (value === 10) {
      if (!discardLine && pendingLength - prefix.length > retentionEntryReceiptLimits.recordBytes) {
        refused++
        discardLine = true
      }
      if (!discardLine && pendingLength >= prefix.length) receiveLine()
      if (!discardLine && pendingLength < prefix.length)
        for (const item of pending.subarray(0, pendingLength)) other(item)
      if (!discardLine && pendingLength < prefix.length) other(value)
      pendingLength = 0
      discardLine = false
      return
    }
    if (discardLine) return
    if (pendingLength === pending.length) {
      pendingLength = 0
      discardLine = true
      refused++
      return
    }
    pending[pendingLength++] = value
    if (pendingLength <= prefix.length && prefix[pendingLength - 1] !== value) {
      for (const item of pending.subarray(0, pendingLength)) other(item)
      pendingLength = 0
      ordinaryLine = true
    }
  }
  const pin = (values: Iterable<ReceiptRecord>) => {
    const selected: ReceiptRecord[] = []
    for (const record of values) {
      if (!makeRoom(1, record.bytes)) {
        dropped++
        continue
      }
      selected.push(record)
      pinnedBytes += record.bytes
      pinnedRecords++
    }
    return selected
  }
  const packet = (
    failure: FailureReceipt,
    stage: 'failure-frozen' | 'entry-teardown',
    tail: readonly ReceiptRecord[],
    immediateStatus: Owner['immediateStatus'],
    immediateCompletedAt: number | null,
  ) => ({
    version: 1,
    archiveStage: stage,
    archiveStartedAt: Date.now(),
    availability: ['installed', 'listening', 'process-start'].every((kind) =>
      failure.lifetime.some((record) => record.event.kind === kind),
    )
      ? 'observed'
      : 'partial',
    missingFacts: ['installed', 'listening', 'process-start'].filter(
      (kind) => !failure.lifetime.some((record) => record.event.kind === kind),
    ),
    phase: failure.phase,
    failedAt: failure.at,
    endedAt: failure.endedAt,
    refused: refused + writerRefused,
    dropped: dropped + writerDropped,
    wireEndObserved,
    pendingWireBytes: pendingLength,
    optimizerCoverage: 'public-log-markers',
    lifetimeCounts: Object.fromEntries(counts),
    lifetimeStatusCounts: Object.fromEntries(statusCounts),
    truncated: dropped + writerDropped > 0,
    immediatePersistence: immediateStatus ?? { status: 'pending', codes: [] },
    immediateArchiveCompletedAt: immediateCompletedAt,
    lifetimeBeforeFailure: failure.lifetime.map((record) => record.event),
    sameModulePredecessors: failure.predecessors.map((record) => record.event),
    failureWindow: failure.records.map((record) => record.event),
    postFailureTail: tail
      .filter((record) => record.sequence > failure.sequence)
      .map((record) => record.event),
  })
  const freeze = (output: string, phase: RetentionEntryPhase) => {
    const owner = cases.get(output)
    if (!owner) return
    if (owner.failure) return owner.immediate
    const paths = new Set<string>()
    for (const record of records.values())
      if (record.sequence > owner.start && record.event.kind === 'route-failure')
        paths.add(record.event.path)
    const history = pin(lifetime.values())
    const prior = pin(
      [...paths].flatMap((path) => {
        const record = completions.get(path)
        return record ? [record] : []
      }),
    )
    const window: ReceiptRecord[] = []
    for (const record of records.values()) {
      if (record.sequence <= owner.start) continue
      records.delete(record.sequence)
      bytes -= record.bytes
      window.push(record)
      pinnedBytes += record.bytes
      pinnedRecords++
    }
    owner.failure = {
      phase,
      sequence,
      at: Date.now(),
      records: window,
      predecessors: prior,
      lifetime: history,
      endedAt: null,
    }
    const snapshot = packet(owner.failure, 'failure-frozen', [], null, null)
    owner.immediate = archiveEntryReceipt(output, snapshot, 'entry-transport.frozen.json')
      .then((result) => {
        owner.immediateStatus = result
        owner.immediateCompletedAt = Date.now()
        return result
      })
      .catch(() => {
        const result = { status: 'unavailable' as const, codes: [null] }
        owner.immediateStatus = result
        owner.immediateCompletedAt = Date.now()
        return result
      })
    return owner.immediate
  }
  return {
    accept,
    read(chunk: Buffer, other?: (value: string) => void) {
      try {
        const ordinary: number[] = []
        for (const value of chunk) byte(value, (value) => ordinary.push(value))
        const text = decoder.write(Buffer.from(ordinary))
        if (text) other?.(text)
      } catch {
        refused++
      }
    },
    finishWire() {
      guardRetentionEntryObservation(() => {
        decoder.end()
        wireEndObserved = true
        if (pendingLength >= prefix.length || discardLine) refused++
        pendingLength = 0
        discardLine = false
      })
    },
    begin(output: string) {
      guardRetentionEntryObservation(() => {
        const size =
          Buffer.byteLength(output) +
          wireRecordBytes * 2 +
          retentionEntryReceiptLimits.recordBytes * 4
        if (cases.has(output) || !makeRoom(3, size)) {
          refused++
          return
        }
        cases.set(output, {
          start: sequence,
          bytes: size,
          failure: null,
          immediate: null,
          immediateStatus: null,
          immediateCompletedAt: null,
        })
        caseBytes += size
      })
    },
    fail(output: string, phase: RetentionEntryPhase) {
      try {
        return freeze(output, phase)
      } catch {
        refused++
        return undefined
      }
    },
    end(output: string) {
      guardRetentionEntryObservation(() => {
        const owner = cases.get(output)
        if (owner?.failure) {
          owner.failure.endedAt = Date.now()
          return
        }
        caseBytes -= owner?.bytes ?? 0
        cases.delete(output)
      })
    },
    inspect() {
      return {
        refused: refused + writerRefused,
        dropped: dropped + writerDropped,
        retainedBytes:
          bytes + lifetimeBytes + completionBytes + pinnedBytes + caseBytes + wireRecordBytes * 2,
        retainedRecords:
          records.size + lifetime.size + completions.size + pinnedRecords + cases.size * 3 + 2,
        wireEndObserved,
        pendingWireBytes: pendingLength,
      }
    },
    async persistFailures() {
      const tailRecords = new Map(records)
      for (const record of lifetime.values()) tailRecords.set(record.sequence, record)
      for (const record of completions.values()) tailRecords.set(record.sequence, record)
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
        results.push(
          await archiveEntryReceipt(
            output,
            packet(
              owner.failure,
              'entry-teardown',
              tail,
              owner.immediateStatus,
              owner.immediateCompletedAt,
            ),
          ),
        )
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
