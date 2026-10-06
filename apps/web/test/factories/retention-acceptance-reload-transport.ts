import { open, writeFile } from 'node:fs/promises'
import { createWriteStream } from 'node:fs'
import { constants } from 'node:os'
import { isAbsolute, join, relative } from 'node:path'
import { inspect } from 'node:util'
import { StringDecoder } from 'node:string_decoder'
import type { EventEmitter } from 'node:events'
import * as v from 'valibot'
import { createScriptError } from '../../../../scripts/structured-errors.ts'
import {
  associateRetentionSocketFailure,
  createRetentionSocketProvenance,
  isRetentionSocketJournalName,
  removeRetentionSocketJournal,
  retentionSocketLimits,
  snapshotRetentionSocketJournal,
  type RetentionSocketAssociation,
  type RetentionSocketSnapshot,
} from './retention-acceptance-socket-provenance.ts'

type ForwardOutcome =
  | { readonly kind: 'succeeded' }
  | { readonly kind: 'failed'; readonly error: unknown }
  | { readonly kind: 'cancelled' }

type ForwardSettlement = Exclude<ForwardOutcome, { readonly kind: 'cancelled' }>

export type RetentionReloadTimings = {
  headersCompleted: { requestId: number; at: number } | null
  baselineReadyAt: number | null
  reloadReadyAt: number | null
  fontReadyAt: number | null
  screenshotCompleteAt: number | null
  browserTimeOrigin: number | null
}

export function createRetentionReloadTimings(): RetentionReloadTimings {
  return {
    headersCompleted: null,
    baselineReadyAt: null,
    reloadReadyAt: null,
    fontReadyAt: null,
    screenshotCompleteAt: null,
    browserTimeOrigin: null,
  }
}

type ReloadOwner = Readonly<{ sessionId: string; testPath: string | undefined }>
type OwnedReload<T> = Readonly<{ result: Promise<T>; close: () => Promise<void> }>

export function createRetentionReloadCases() {
  const cases = new Map<string, { owner: ReloadOwner; finish: () => Promise<void> }>()
  return {
    run<T>(owner: ReloadOwner, id: string, start: (signal: AbortSignal) => OwnedReload<T>) {
      const valid = v.safeParse(v.pipe(v.string(), v.uuid()), id).success
      if (!valid || cases.has(id))
        throw createScriptError('Reload operation identity is unavailable', {
          internal: { valid, active: cases.has(id) },
        })
      const controller = new AbortController()
      const { result: pending, close: release } = start(controller.signal)
      let closed: Promise<unknown[]> | null = null
      const close = () =>
        (closed ??= Promise.resolve()
          .then(release)
          .then(
            () => [],
            (error: unknown) => [error],
          ))
      const result = pending.finally(close)
      const settled = result.then(
        () => undefined,
        () => undefined,
      )
      let finished: Promise<void> | null = null
      const finish = () =>
        (finished ??= (async () => {
          controller.abort()
          const errors = await close()
          await settled
          cases.delete(id)
          if (errors.length)
            throw createScriptError('Reload operation cleanup failed', {
              internal: { count: errors.length },
            })
        })())
      cases.set(id, { owner, finish })
      return result
    },
    finish(owner: ReloadOwner, id: string) {
      const operation = cases.get(id)
      if (!operation) return Promise.resolve()
      if (
        operation.owner.sessionId !== owner.sessionId ||
        operation.owner.testPath !== owner.testPath
      )
        throw createScriptError('Reload operation belongs to another caller', {
          internal: { matched: false },
        })
      return operation.finish()
    },
    get activeCount() {
      return cases.size
    },
  }
}

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

export function createRetentionReloadTransport(
  observer?: {
    run: (request: ForwardObservation, operation: () => Promise<void>) => Promise<void>
    settled: (request: ForwardObservation) => void
  },
  timings?: RetentionReloadTimings,
) {
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
      operation: (fulfill: FulfillForward, headersCompleted: () => void) => Promise<void>,
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
      const headersCompleted = () => {
        if (timings) timings.headersCompleted = { requestId: observation.requestId, at: Date.now() }
      }
      const request = createRetentionForward(observation, record, failed)
      const routeAction = createRetentionRouteAction(observation, abort, record)
      routeActions.push(routeAction)
      const cancel = () => {
        if (!request.cancel()) return
        guardRetentionEntryObservation(() => observer?.settled(observation))
        void routeAction.abort().catch(() => {})
      }
      pending.add(cancel)
      const actual = admitting
        ? observeRetentionForward(
            () =>
              observer?.run(observation, () => operation(routeAction.fulfill, headersCompleted)) ??
              operation(routeAction.fulfill, headersCompleted),
            (outcome) => {
              const selected = request.select(outcome)
              guardRetentionEntryObservation(() => observer?.settled(observation))
              return selected
            },
          )
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
  mainOperation?: Promise<unknown>,
) {
  const outcomes: { stage: string; at: number; error: unknown }[] = []
  const complete = mainOperation
    ? [...actions, { stage: 'join-main-operation', run: () => mainOperation }]
    : actions
  for (const action of complete) {
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
const entryReceiptFactSchema = v.variant('kind', [
  v.strictObject({
    ...receiptBase,
    kind: v.literal('socket-journal'),
    basename: v.pipe(v.string(), v.check(isRetentionSocketJournalName)),
  }),
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
])
const entryReceiptSchema = v.variant('kind', [
  ...entryReceiptFactSchema.options,
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
type FactualEntryEvent = v.InferOutput<typeof entryReceiptFactSchema>
const factDropCounts = {
  'socket-journal': 0,
  installed: 0,
  listening: 0,
  request: 0,
  'response-finish': 0,
  'response-close': 0,
  'request-aborted': 0,
  'request-error': 0,
  'response-error': 0,
  'socket-open': 0,
  'socket-end': 0,
  'socket-timeout': 0,
  'socket-close': 0,
  'socket-error': 0,
  'server-close': 0,
  'optimizer-bundling': 0,
  'optimizer-optimized': 0,
  'optimizer-reload': 0,
  'optimizer-error': 0,
  'full-reload': 0,
  'server-error': 0,
  'process-start': 0,
  'process-stop': 0,
  'process-exit': 0,
  'route-failure': 0,
} satisfies Record<FactualEntryEvent['kind'], number>

function receiptCounterTotal(counts: readonly number[]) {
  let total = 0
  for (const count of counts) {
    if (count > Number.MAX_SAFE_INTEGER - total) return null
    total += count
  }
  return total
}

const entryCoverageSchema = v.pipe(
  v.strictObject({
    observed: receiptInteger,
    dropped: receiptInteger,
    refused: receiptInteger,
    countersExact: v.boolean(),
    droppedByKind: v.pipe(
      v.record(v.string(), receiptInteger),
      v.check((values) => Object.keys(values).every((kind) => Object.hasOwn(factDropCounts, kind))),
    ),
    refusedByReason: v.strictObject({
      'input-schema': receiptInteger,
      'record-bytes': receiptInteger,
      'tap-path': receiptInteger,
    }),
    queuedRecords: v.pipe(receiptInteger, v.maxValue(64)),
    queuedBytes: receiptInteger,
    inFlightRecords: v.pipe(receiptInteger, v.maxValue(64)),
    inFlightBytes: receiptInteger,
    unavailable: v.boolean(),
    code: receiptCode,
  }),
  v.check((value) => {
    const droppedTotal = receiptCounterTotal(Object.values(value.droppedByKind))
    const refusedTotal = receiptCounterTotal(Object.values(value.refusedByReason))
    return (
      value.queuedRecords + value.inFlightRecords <= 64 &&
      value.queuedBytes === value.queuedRecords * retentionEntryReceiptLimits.recordBytes &&
      value.inFlightBytes === value.inFlightRecords * retentionEntryReceiptLimits.recordBytes &&
      value.dropped === (droppedTotal ?? Number.MAX_SAFE_INTEGER) &&
      value.refused === (refusedTotal ?? Number.MAX_SAFE_INTEGER) &&
      (!value.countersExact || (droppedTotal !== null && refusedTotal !== null)) &&
      value.observed - value.dropped >= value.queuedRecords + value.inFlightRecords
    )
  }),
)
const entryWireFactSchema = v.strictObject({
  observationSequence: receiptInteger,
  event: entryReceiptFactSchema,
})
const entryWireSchema = v.pipe(
  v.variant('kind', [
    v.strictObject({
      version: v.literal(2),
      kind: v.literal('facts'),
      pid: receiptInteger,
      emittedAt: receiptInteger,
      emittedTick: receiptBase.tick,
      facts: v.pipe(v.array(entryWireFactSchema), v.minLength(1), v.maxLength(64)),
      coverage: entryCoverageSchema,
    }),
    v.strictObject({
      version: v.literal(2),
      kind: v.literal('summary'),
      pid: receiptInteger,
      emittedAt: receiptInteger,
      emittedTick: receiptBase.tick,
      coverage: entryCoverageSchema,
    }),
  ]),
  v.check((frame) =>
    frame.kind === 'summary'
      ? frame.coverage.queuedRecords === 0 && frame.coverage.inFlightRecords === 0
      : frame.coverage.inFlightRecords === frame.facts.length &&
        frame.facts.every(
          (fact) =>
            fact.event.pid === frame.pid &&
            fact.observationSequence > 0 &&
            fact.observationSequence <= frame.coverage.observed,
        ),
  ),
)
type EntryCoverage = v.InferOutput<typeof entryCoverageSchema>
type EntryWire = v.InferOutput<typeof entryWireSchema>
type PendingEntryFact = v.InferOutput<typeof entryWireFactSchema>
const producerFactCells = 64
const producerFixedCells = 5
export const retentionEntryBudget = {
  producer: {
    records: producerFactCells + producerFixedCells + 1,
    bytes:
      (producerFactCells + producerFixedCells) * retentionEntryReceiptLimits.recordBytes +
      wireRecordBytes,
    factCells: producerFactCells,
  },
  relay: {
    records:
      retentionEntryReceiptLimits.records -
      producerFactCells -
      producerFixedCells -
      1 -
      retentionSocketLimits.client.records -
      retentionSocketLimits.serving.records,
    bytes:
      retentionEntryReceiptLimits.bytes -
      (producerFactCells + producerFixedCells) * retentionEntryReceiptLimits.recordBytes -
      wireRecordBytes -
      retentionSocketLimits.client.bytes -
      retentionSocketLimits.serving.bytes,
  },
  clientJournal: retentionSocketLimits.client,
  servingJournal: retentionSocketLimits.serving,
} as const
let receiptWriter: ReturnType<typeof createRetentionEntryWriter> | undefined

function createRetentionEntryWriter() {
  const output = createWriteStream('', { fd: 1, autoClose: false })
  const queue: PendingEntryFact[] = []
  const droppedByKind = { ...factDropCounts }
  const refusedByReason = { 'input-schema': 0, 'record-bytes': 0, 'tap-path': 0 }
  type Flight = { readonly frame: EntryWire; readonly encoded: Buffer }
  type Encoding =
    | { kind: 'encoded'; flight: Flight }
    | { kind: 'record-bytes' }
    | { kind: 'schema' }
  type WriterState =
    | { kind: 'idle' }
    | { kind: 'writing'; flight: Flight }
    | { kind: 'unavailable'; code: string | null }
  let state: WriterState = { kind: 'idle' }
  let needsIdleSummary = false,
    dirty = false,
    countersExact = true
  let observed = 0,
    dropped = 0,
    refused = 0
  const addCounter = (previous: number, count: number) => {
    const next = receiptCounterTotal([previous, count])
    if (next !== null) return next
    countersExact = false
    return Number.MAX_SAFE_INTEGER
  }
  const flightFacts = () =>
    state.kind === 'writing' && state.flight.frame.kind === 'facts'
      ? state.flight.frame.facts.length
      : 0
  const coverage = (queued = queue.length, writing = flightFacts()): EntryCoverage => ({
    observed,
    dropped,
    refused,
    countersExact,
    droppedByKind: { ...droppedByKind },
    refusedByReason: { ...refusedByReason },
    queuedRecords: queued,
    queuedBytes: queued * retentionEntryReceiptLimits.recordBytes,
    inFlightRecords: writing,
    inFlightBytes: writing * retentionEntryReceiptLimits.recordBytes,
    unavailable: state.kind === 'unavailable',
    code: state.kind === 'unavailable' ? state.code : null,
  })
  const lose = (fact: PendingEntryFact) => {
    dropped = addCounter(dropped, 1)
    droppedByKind[fact.event.kind] = addCounter(droppedByKind[fact.event.kind], 1)
    dirty = true
  }
  const reject = (reason: keyof typeof refusedByReason, count = 1) => {
    refused = addCounter(refused, count)
    refusedByReason[reason] = addCounter(refusedByReason[reason], count)
    dirty = true
  }
  const failed = (error: unknown) => {
    if (state.kind === 'unavailable') return
    const code = retentionEntryErrorCode(error)
    for (const fact of queue) lose(fact)
    if (state.kind === 'writing' && state.flight.frame.kind === 'facts')
      for (const fact of state.flight.frame.facts) lose(fact)
    queue.length = 0
    state = { kind: 'unavailable', code }
  }
  output.on('error', failed)
  const encode = (facts: readonly PendingEntryFact[]): Encoding => {
    const time = retentionEntryReceiptTime()
    const base = {
      version: 2,
      pid: time.pid,
      emittedAt: time.at,
      emittedTick: time.tick,
      coverage: coverage(queue.length - facts.length, facts.length),
    }
    const input = facts.length ? { ...base, kind: 'facts', facts } : { ...base, kind: 'summary' }
    const parsed = v.safeParse(entryWireSchema, input)
    if (!parsed.success) return { kind: 'schema' }
    const body = JSON.stringify(parsed.output)
    if (Buffer.byteLength(body) > retentionEntryReceiptLimits.recordBytes)
      return { kind: 'record-bytes' }
    return {
      kind: 'encoded',
      flight: {
        frame: parsed.output,
        encoded: Buffer.from(retentionEntryReceiptPrefix + body + '\n'),
      },
    }
  }
  const pump = () => {
    if (state.kind !== 'idle') return
    const facts: PendingEntryFact[] = []
    let selected: Flight | null = null
    for (const fact of queue) {
      const next = encode([...facts, fact])
      if (next.kind === 'schema') {
        failed({ code: 'WIRE_SCHEMA' })
        return
      }
      if (next.kind === 'record-bytes') break
      facts.push(fact)
      selected = next.flight
    }
    if (!selected && queue.length) {
      const fact = queue.shift()
      if (fact) lose(fact)
      reject('record-bytes')
      pump()
      return
    }
    if (!selected && (needsIdleSummary || dirty)) {
      const summary = encode([])
      if (summary.kind !== 'encoded') {
        failed({ code: summary.kind === 'schema' ? 'WIRE_SCHEMA' : 'WIRE_RECORD_BYTES' })
        return
      }
      selected = summary.flight
    }
    if (!selected) return
    queue.splice(0, facts.length)
    needsIdleSummary = false
    dirty = false
    state = { kind: 'writing', flight: selected }
    try {
      output.write(selected.encoded, completed)
    } catch (error) {
      failed(error)
    }
  }
  const completed = (error?: Error | null) => {
    if (error) {
      failed(error)
      return
    }
    if (state.kind !== 'writing') return
    needsIdleSummary = state.flight.frame.kind === 'facts' && queue.length === 0
    state = { kind: 'idle' }
    pump()
  }
  return {
    write(input: unknown) {
      try {
        const parsed = v.safeParse(entryReceiptSchema, input)
        if (!parsed.success) {
          reject('input-schema')
          pump()
          return
        }
        if (parsed.output.kind === 'refused') {
          reject('tap-path', parsed.output.count)
          pump()
          return
        }
        if (parsed.output.kind === 'writer-status') {
          reject('input-schema')
          pump()
          return
        }
        const nextObserved = receiptCounterTotal([observed, 1])
        if (nextObserved === null) {
          countersExact = false
          failed({ code: 'COUNTER_OVERFLOW' })
          lose({ observationSequence: observed, event: parsed.output })
          return
        }
        observed = nextObserved
        const fact = { observationSequence: observed, event: Object.freeze(parsed.output) }
        dirty = true
        if (state.kind === 'unavailable' || queue.length + flightFacts() >= producerFactCells) {
          lose(fact)
          return
        }
        queue.push(fact)
        pump()
      } catch {
        reject('input-schema')
        pump()
      }
    },
    inspect() {
      return {
        pendingBytes: state.kind === 'writing' ? state.flight.encoded.length : 0,
        pendingRecords: state.kind === 'writing' ? 1 : 0,
        queuedRecords: queue.length,
        inFlightFactRecords: flightFacts(),
        retainedRecords: queue.length + flightFacts() + producerFixedCells + 1,
        retainedBytes:
          (queue.length + flightFacts() + producerFixedCells) *
            retentionEntryReceiptLimits.recordBytes +
          wireRecordBytes,
        dropped,
        refused,
        countersExact,
        droppedByKind: { ...droppedByKind },
        refusedByReason: { ...refusedByReason },
        unavailable: state.kind === 'unavailable',
        code: state.kind === 'unavailable' ? state.code : null,
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
type ProducerSample = Readonly<{
  pid: number
  emittedAt: number
  emittedTick: string
  receivedAt: number
  coverage: EntryCoverage
}>
type ObservationCoverage = Readonly<{
  lastReceived: number
  gaps: number
  firstGap: Readonly<{ from: number; to: number }> | null
  lastGap: Readonly<{ from: number; to: number }> | null
}>
type FailureReceipt = {
  readonly timings: RetentionReloadTimings | undefined
  readonly phase: RetentionEntryPhase
  readonly sequence: number
  readonly at: number
  readonly records: readonly ReceiptRecord[]
  readonly predecessors: readonly ReceiptRecord[]
  readonly lifetime: readonly ReceiptRecord[]
  readonly producerAtFailure: ProducerSample | null
  readonly observationsAtFailure: ObservationCoverage
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
  'socket-journal',
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
  name:
    | 'entry-transport.json'
    | 'entry-transport.frozen.json'
    | 'socket-provenance.json'
    | 'socket-provenance.frozen.json' = 'entry-transport.json',
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

export function createRetentionEntryCapture(socketOptions?: { entryPort: number; root: string }) {
  const clientJournal = socketOptions
    ? createRetentionSocketProvenance({
        side: 'client',
        entryPort: socketOptions.entryPort,
        normalizePath: (path) => retentionEntryModulePath(socketOptions.root, path),
      })
    : null
  const caseRecords = clientJournal ? 10 : 3
  const caseJournalBytes = clientJournal
    ? 6 * retentionEntryReceiptLimits.recordBytes + wireRecordBytes
    : 0
  let servingJournal: string | null = null,
    servingJournalAmbiguous = false,
    socketCaseSequence = 0
  const records = new Map<number, ReceiptRecord>()
  const lifetime = new Map<string, ReceiptRecord>()
  const completions = new Map<string, ReceiptRecord>()
  type Owner = {
    readonly timings: RetentionReloadTimings | undefined
    readonly start: number
    readonly bytes: number
    failure: FailureReceipt | null
    immediate: Promise<Awaited<ReturnType<typeof archiveEntryReceipt>>> | null
    immediateStatus: Awaited<ReturnType<typeof archiveEntryReceipt>> | null
    immediateCompletedAt: number | null
    socketCaseId: number
    socketFrozen: {
      client: RetentionSocketSnapshot | null
      serving: RetentionSocketSnapshot | null
      association: RetentionSocketAssociation
    } | null
    socketImmediate: Promise<Awaited<ReturnType<typeof archiveEntryReceipt>>> | null
    socketImmediateStatus: Awaited<ReturnType<typeof archiveEntryReceipt>> | null
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
  let relayCountersExact = true
  let producerSample: ProducerSample | null = null
  let lastReceived = 0,
    gaps = 0
  let firstGap: ObservationCoverage['firstGap'] = null
  let lastGap: ObservationCoverage['lastGap'] = null
  const observations = (): ObservationCoverage => ({ lastReceived, gaps, firstGap, lastGap })
  const addRelayCounter = (previous: number, count = 1) => {
    const next = receiptCounterTotal([previous, count])
    if (next !== null) return next
    relayCountersExact = false
    return Number.MAX_SAFE_INTEGER
  }
  const totals = () => {
    const refusedTotal = receiptCounterTotal([refused, writerRefused])
    const droppedTotal = receiptCounterTotal([dropped, writerDropped])
    return {
      refused: refusedTotal ?? Number.MAX_SAFE_INTEGER,
      dropped: droppedTotal ?? Number.MAX_SAFE_INTEGER,
      countersExact:
        relayCountersExact &&
        producerSample?.coverage.countersExact !== false &&
        refusedTotal !== null &&
        droppedTotal !== null,
    }
  }
  const continuesCounters = (previous: Record<string, number>, next: Record<string, number>) =>
    Object.entries(previous).every(([key, value]) => (next[key] ?? 0) >= value)
  const continuesCoverage = (frame: EntryWire) => {
    const current = frame.coverage
    const accounted = receiptCounterTotal([
      lastReceived - gaps,
      current.queuedRecords,
      current.inFlightRecords,
      current.dropped,
    ])
    if (accounted === null && current.countersExact) return false
    if ((accounted ?? Number.MAX_SAFE_INTEGER) > current.observed) return false
    if (current.observed < lastReceived) return false
    if (!producerSample) return true
    const previous = producerSample.coverage
    return (
      frame.pid === producerSample.pid &&
      current.observed >= previous.observed &&
      current.dropped >= previous.dropped &&
      current.refused >= previous.refused &&
      (previous.countersExact || !current.countersExact) &&
      continuesCounters(previous.droppedByKind, current.droppedByKind) &&
      continuesCounters(previous.refusedByReason, current.refusedByReason)
    )
  }
  const makeRoom = (count: number, size: number) => {
    while (
      records.size +
        completions.size +
        pinnedRecords +
        lifetimeSlots +
        cases.size * caseRecords +
        1 +
        count >
        retentionEntryBudget.relay.records ||
      bytes +
        completionBytes +
        pinnedBytes +
        caseBytes +
        lifetimeSlots * retentionEntryReceiptLimits.recordBytes +
        wireRecordBytes +
        size >
        retentionEntryBudget.relay.bytes
    ) {
      const first = records.keys().next().value
      if (first !== undefined) {
        bytes -= records.get(first)?.bytes ?? 0
        records.delete(first)
        dropped = addRelayCounter(dropped)
        continue
      }
      const path = completions.keys().next().value
      if (path === undefined) return false
      completionBytes -= completions.get(path)?.bytes ?? 0
      completions.delete(path)
      dropped = addRelayCounter(dropped)
    }
    return true
  }
  const retain = (event: RetentionEntryReceiptEvent) => {
    const size = Buffer.byteLength(JSON.stringify(event))
    if (size > retentionEntryReceiptLimits.recordBytes) {
      refused = addRelayCounter(refused)
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
      dropped = addRelayCounter(dropped)
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
        refused = addRelayCounter(refused)
        return
      }
      if (parsed.output.kind === 'refused') {
        refused = addRelayCounter(refused, parsed.output.count)
        return
      }
      if (parsed.output.kind === 'writer-status') {
        writerDropped = Math.max(writerDropped, parsed.output.dropped)
        writerRefused = Math.max(writerRefused, parsed.output.refused)
      }
      if (parsed.output.kind === 'socket-journal') {
        if (!parsed.output.basename.startsWith(`retention-socket-serving-${parsed.output.pid}-`)) {
          refused = addRelayCounter(refused)
          return
        }
        if (servingJournal && servingJournal !== parsed.output.basename)
          servingJournalAmbiguous = true
        servingJournal ??= parsed.output.basename
      }
      retain(parsed.output)
    } catch {
      refused = addRelayCounter(refused)
    }
  }
  const receive = (input: unknown) => {
    const parsed = v.safeParse(entryWireSchema, input)
    if (!parsed.success) {
      refused = addRelayCounter(refused)
      return
    }
    const frame = parsed.output
    if (!continuesCoverage(frame)) {
      refused = addRelayCounter(refused)
      return
    }
    if (
      frame.kind === 'facts' &&
      frame.facts.some(
        (fact, index) =>
          fact.observationSequence <=
          (index ? (frame.facts[index - 1]?.observationSequence ?? 0) : lastReceived),
      )
    ) {
      refused = addRelayCounter(refused)
      return
    }
    writerDropped = Math.max(writerDropped, frame.coverage.dropped)
    writerRefused = Math.max(writerRefused, frame.coverage.refused)
    producerSample = Object.freeze({
      pid: frame.pid,
      emittedAt: frame.emittedAt,
      emittedTick: frame.emittedTick,
      receivedAt: Date.now(),
      coverage: frame.coverage,
    })
    if (frame.kind === 'summary') return
    for (const fact of frame.facts) {
      if (fact.observationSequence > lastReceived + 1) {
        const gap = Object.freeze({ from: lastReceived + 1, to: fact.observationSequence - 1 })
        gaps += gap.to - gap.from + 1
        firstGap ??= gap
        lastGap = gap
      }
      lastReceived = fact.observationSequence
      accept(fact.event)
    }
  }
  const receiveLine = () => {
    try {
      receive(JSON.parse(strictDecoder.decode(pending.subarray(prefix.length, pendingLength))))
    } catch {
      refused = addRelayCounter(refused)
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
        refused = addRelayCounter(refused)
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
      refused = addRelayCounter(refused)
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
        dropped = addRelayCounter(dropped)
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
    version: 2,
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
    ...(failure.timings && { timings: failure.timings }),
    failedAt: failure.at,
    endedAt: failure.endedAt,
    ...totals(),
    wireEndObserved,
    pendingWireBytes: pendingLength,
    optimizerCoverage: 'public-log-markers',
    lifetimeCounts: Object.fromEntries(counts),
    lifetimeStatusCounts: Object.fromEntries(statusCounts),
    truncated: dropped > 0 || writerDropped > 0,
    immediatePersistence: immediateStatus ?? { status: 'pending', codes: [] },
    immediateArchiveCompletedAt: immediateCompletedAt,
    producerAtFailure: failure.producerAtFailure,
    observationsAtFailure: failure.observationsAtFailure,
    producerAtArchive: producerSample,
    observationsAtArchive: observations(),
    budget: retentionEntryBudget,
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
    let primaryForwardId: number | null = null
    for (const record of records.values())
      if (record.sequence > owner.start && record.event.kind === 'route-failure') {
        paths.add(record.event.path)
        primaryForwardId ??= record.event.transportRequestId
      }
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
      timings: owner.timings && { ...owner.timings },
      phase,
      sequence,
      at: Date.now(),
      records: window,
      predecessors: prior,
      lifetime: history,
      producerAtFailure: producerSample,
      observationsAtFailure: observations(),
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
    guardRetentionEntryObservation(() => {
      const client = clientJournal
        ? snapshotRetentionSocketJournal(clientJournal.basename, output, 'frozen')
        : null
      const serving =
        servingJournal && !servingJournalAmbiguous
          ? snapshotRetentionSocketJournal(servingJournal, output, 'frozen')
          : null
      const association: RetentionSocketAssociation =
        client && serving && primaryForwardId !== null
          ? associateRetentionSocketFailure(
              output,
              client,
              serving,
              owner.socketCaseId,
              primaryForwardId,
            )
          : {
              status: 'unavailable',
              why: servingJournalAmbiguous
                ? 'serving-journal-ambiguous'
                : 'journal-or-primary-unavailable',
            }
      owner.socketFrozen = { client, serving, association }
      if (clientJournal || servingJournal)
        owner.socketImmediate = archiveEntryReceipt(
          output,
          {
            version: 1,
            caseId: owner.socketCaseId,
            primaryForwardId,
            stage: 'failure-frozen',
            observation: owner.socketFrozen,
          },
          'socket-provenance.frozen.json',
        ).then((result) => {
          owner.socketImmediateStatus = result
          return result
        })
    })
    return owner.immediate
  }
  return {
    accept,
    observeForward<T>(output: string, observation: { requestId: number }, operation: () => T): T {
      const owner = cases.get(output)
      return clientJournal && owner
        ? clientJournal.runForward(owner.socketCaseId, observation, operation)
        : operation()
    },
    endForward(observation: object) {
      guardRetentionEntryObservation(() => clientJournal?.endForward(observation))
    },
    read(chunk: Buffer, other?: (value: string) => void) {
      try {
        const ordinary: number[] = []
        for (const value of chunk) byte(value, (value) => ordinary.push(value))
        const text = decoder.write(Buffer.from(ordinary))
        if (text) other?.(text)
      } catch {
        refused = addRelayCounter(refused)
      }
    },
    finishWire() {
      guardRetentionEntryObservation(() => {
        decoder.end()
        wireEndObserved = true
        if (pendingLength >= prefix.length || discardLine) refused = addRelayCounter(refused)
        pendingLength = 0
        discardLine = false
      })
    },
    begin(output: string, timings?: RetentionReloadTimings) {
      guardRetentionEntryObservation(() => {
        if (
          timings &&
          Buffer.byteLength(JSON.stringify(timings)) > retentionEntryReceiptLimits.recordBytes
        ) {
          refused = addRelayCounter(refused)
          return
        }
        const size =
          Buffer.byteLength(output) +
          wireRecordBytes * 2 +
          retentionEntryReceiptLimits.recordBytes * 4 +
          caseJournalBytes
        if (cases.has(output) || !makeRoom(caseRecords, size)) {
          refused = addRelayCounter(refused)
          return
        }
        cases.set(output, {
          timings,
          start: sequence,
          bytes: size,
          failure: null,
          immediate: null,
          immediateStatus: null,
          immediateCompletedAt: null,
          socketCaseId: ++socketCaseSequence,
          socketFrozen: null,
          socketImmediate: null,
          socketImmediateStatus: null,
        })
        caseBytes += size
      })
    },
    fail(output: string, phase: RetentionEntryPhase) {
      try {
        return freeze(output, phase)
      } catch {
        refused = addRelayCounter(refused)
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
        ...totals(),
        retainedBytes:
          bytes +
          lifetimeBytes +
          completionBytes +
          pinnedBytes +
          caseBytes +
          wireRecordBytes +
          retentionEntryBudget.producer.bytes +
          retentionEntryBudget.clientJournal.bytes +
          retentionEntryBudget.servingJournal.bytes,
        retainedRecords:
          records.size +
          lifetime.size +
          completions.size +
          pinnedRecords +
          cases.size * caseRecords +
          1 +
          retentionEntryBudget.producer.records +
          retentionEntryBudget.clientJournal.records +
          retentionEntryBudget.servingJournal.records,
        wireEndObserved,
        pendingWireBytes: pendingLength,
        producer: producerSample,
        observations: observations(),
        relayDropped: dropped,
        relayRefused: refused,
        socketJournal: clientJournal?.inspect() ?? null,
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
        if (owner.socketImmediate) results.push(await owner.socketImmediate)
        let socketFinal: {
          client: RetentionSocketSnapshot | null
          serving: RetentionSocketSnapshot | null
        } | null = null
        guardRetentionEntryObservation(() => {
          const client = clientJournal
            ? snapshotRetentionSocketJournal(clientJournal.basename, output, 'final')
            : null
          const serving =
            servingJournal && !servingJournalAmbiguous
              ? snapshotRetentionSocketJournal(servingJournal, output, 'final')
              : null
          socketFinal = { client, serving }
        })
        if (!clientJournal && !servingJournal) continue
        results.push(
          await archiveEntryReceipt(
            output,
            {
              version: 1,
              caseId: owner.socketCaseId,
              frozen: owner.socketFrozen,
              immediatePersistence: owner.socketImmediateStatus,
              final: socketFinal ?? null,
              finalWindowAfterFailureAt: owner.failure.at,
            },
            'socket-provenance.json',
          ),
        )
      }
      return results
    },
    dispose() {
      guardRetentionEntryObservation(() => clientJournal?.close())
      guardRetentionEntryObservation(() => clientJournal?.remove())
      if (servingJournal) removeRetentionSocketJournal(servingJournal)
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
  guardRetentionEntryObservation(() => {
    entryCaptures().get(origin)?.dispose()
    entryCaptures().delete(origin)
  })
}
export function observeRetentionEntryForward<T>(
  origin: string,
  output: string,
  observation: { requestId: number },
  operation: () => T,
): T {
  const capture = entryCaptures().get(origin)
  return capture ? capture.observeForward(output, observation, operation) : operation()
}
export function endRetentionEntryForward(origin: string, observation: object) {
  guardRetentionEntryObservation(() => entryCaptures().get(origin)?.endForward(observation))
}
export function beginRetentionEntryCase(
  origin: string,
  output: string,
  timings?: RetentionReloadTimings,
) {
  guardRetentionEntryObservation(() => entryCaptures().get(origin)?.begin(output, timings))
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
