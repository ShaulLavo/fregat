import { performance } from 'node:perf_hooks'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import * as v from 'valibot'
import {
  createColdReaderCounters,
  coldReaderSummary,
  measureColdReader,
} from './retention-cold-reader.ts'

const finite = v.pipe(v.number(), v.finite(), v.minValue(0))
const histogram = v.object({
  count: finite,
  sumMs: finite,
  maxMs: finite,
  buckets: v.pipe(v.array(finite), v.length(16)),
})
const clock = v.object({ utcMs: finite, monotonicMs: finite })
const cpu = v.object({
  ...clock.entries,
  userUs: v.nullable(finite),
  systemUs: v.nullable(finite),
  rssKiB: v.nullable(finite),
  voluntarySwitches: v.nullable(finite),
  involuntarySwitches: v.nullable(finite),
  loopActiveMs: v.nullable(finite),
  loopIdleMs: v.nullable(finite),
  reason: v.nullable(v.picklist(['unsupported', 'observer-refused'])),
})
const hash = v.nullable(v.pipe(v.string(), v.regex(/^[a-f0-9]{8,64}$/)))
const cache = v.object({
  hash,
  lockfileHash: hash,
  configHash: hash,
  browserHash: hash,
  optimized: v.nullable(finite),
  discovered: v.nullable(finite),
  modules: v.nullable(finite),
  scanCompleteAt: v.nullable(clock),
  processingCompleteAt: v.nullable(clock),
  reason: v.nullable(v.picklist(['unsupported', 'pending'])),
})
const serverSchema = v.object({
  kind: v.literal('server'),
  version: v.pipe(v.string(), v.regex(/^\d+\.\d+\.\d+$/)),
  phases: v.pipe(
    v.array(
      v.object({
        phase: v.picklist(['startup', 'baseline', 'reload', 'end']),
        cpu,
        cache,
        transforms: histogram,
      }),
    ),
    v.maxLength(4),
  ),
  transforms: histogram,
  transformStarted: finite,
  transformIncomplete: finite,
  transformOverflow: finite,
  observerMs: finite,
})
const browserSchema = v.object({
  kind: v.literal('browser'),
  phase: v.picklist(['dom', 'load', 'hide']),
  utcMs: finite,
  timeOriginMs: finite,
  monotonicMs: finite,
  resources: v.nullable(histogram),
  resourceReason: v.nullable(v.picklist(['unsupported', 'observer-refused'])),
  navigation: v.nullable(
    v.object({
      responseStart: v.nullable(finite),
      responseEnd: v.nullable(finite),
      domInteractive: v.nullable(finite),
      domContentLoadedEventEnd: v.nullable(finite),
      loadEventEnd: v.nullable(finite),
    }),
  ),
  longTasks: v.nullable(histogram),
  bytes: v.nullable(finite),
  reason: v.nullable(v.picklist(['unsupported', 'observer-refused'])),
  observerMs: finite,
})
const packetSchema = v.variant('kind', [serverSchema, browserSchema])
export const coldProfilePrefix = 'RETENTION_COLD_FACT '
const coldProfilePhases = [
  'start',
  'setup',
  'baseline-ready',
  'reload-loaded',
  'reload-ready',
  'font-ready',
  'screenshot',
  'cancelled',
  'cleanup',
] as const
export type ColdProfilePhase = (typeof coldProfilePhases)[number]
export function coldHistogram() {
  return { count: 0, sumMs: 0, maxMs: 0, buckets: Array<number>(16).fill(0) }
}
export function addColdDuration(value: ReturnType<typeof coldHistogram>, ms: number) {
  if (!Number.isFinite(ms) || ms < 0) return
  value.count++
  value.sumMs += ms
  value.maxMs = Math.max(value.maxMs, ms)
  value.buckets[Math.min(15, Math.max(0, Math.ceil(Math.log2(Math.max(1, ms)))))]++
}
export function coldClock() {
  return { utcMs: Date.now(), monotonicMs: performance.now() }
}
export function coldCpu() {
  const at = coldClock()
  try {
    const usage = process.cpuUsage(),
      resource = process.resourceUsage(),
      loop = performance.eventLoopUtilization()
    return {
      ...at,
      userUs: usage.user,
      systemUs: usage.system,
      rssKiB: resource.maxRSS,
      voluntarySwitches: resource.voluntaryContextSwitches,
      involuntarySwitches: resource.involuntaryContextSwitches,
      loopActiveMs: loop.active,
      loopIdleMs: loop.idle,
      reason: null,
    }
  } catch {
    return {
      ...at,
      userUs: null,
      systemUs: null,
      rssKiB: null,
      voluntarySwitches: null,
      involuntarySwitches: null,
      loopActiveMs: null,
      loopIdleMs: null,
      reason: 'unsupported' as const,
    }
  }
}
export function safeColdObserve(action: () => void) {
  try {
    action()
  } catch {}
}
export function parseColdFact(text: string) {
  if (!text.startsWith(coldProfilePrefix) || Buffer.byteLength(text) > 16_384) return null
  try {
    const parsed = v.safeParse(packetSchema, JSON.parse(text.slice(coldProfilePrefix.length)))
    return parsed.success ? parsed.output : null
  } catch {
    return null
  }
}
type ColdWireCoverage = {
  bytesSeen: number
  profileLines: number
  ordinaryLines: number
  ordinaryEofBytes: number
  acceptedFrames: number
  invalidFrames: number
  oversizedFrames: number
  incompleteFrames: number
  inactiveFrames: number
  decodeFailures: number
  discardedBytes: number
  afterEofBytes: number
  observerFailures: number
  eofObserved: boolean
}
type Readers = ReturnType<typeof createReaders>
function createReaders() {
  return {
    firstStarted: false,
    suite: { coldWire: createColdReaderCounters(), capture: createColdReaderCounters() },
    firstCase: { coldWire: createColdReaderCounters(), capture: createColdReaderCounters() },
  }
}
const count = v.pipe(finite, v.integer(), v.maxValue(Number.MAX_SAFE_INTEGER))
const readerSummarySchema = v.object({
  chunks: count,
  bytes: v.nullable(count),
  byteMissing: count,
  observedBytes: count,
  wallMs: v.nullable(finite),
  wallMissing: count,
  throws: count,
  threadUserUs: v.nullable(count),
  threadSystemUs: v.nullable(count),
  observedThreadUserUs: v.nullable(count),
  observedThreadSystemUs: v.nullable(count),
  cpuSamples: count,
  cpuMissing: v.object({ unsupported: count, 'observer-refused': count, 'counter-drift': count }),
  cpuReason: v.nullable(
    v.picklist(['no-calls', 'unsupported', 'observer-refused', 'counter-drift', 'incomplete']),
  ),
})
const readerPairSchema = v.object({ coldWire: readerSummarySchema, capture: readerSummarySchema })
const readerSnapshotSchema = v.object({
  cpuScope: v.literal('current-thread-synchronous-bracket'),
  wallScope: v.literal('synchronous-read-callback'),
  firstCaseState: v.picklist(['not-admitted', 'open', 'closed']),
  suite: readerPairSchema,
  firstCase: readerPairSchema,
})
function firstReaderState(state: Store, readers: Readers) {
  if (!readers.firstStarted) return 'not-admitted' as const
  if (state.record?.readerWindowOpen) return 'open' as const
  return 'closed' as const
}
function readerSnapshot() {
  const state = store(),
    readers = state.readers
  if (!readers) return null
  const value = {
    cpuScope: 'current-thread-synchronous-bracket',
    wallScope: 'synchronous-read-callback',
    firstCaseState: firstReaderState(state, readers),
    suite: {
      coldWire: coldReaderSummary(readers.suite.coldWire),
      capture: coldReaderSummary(readers.suite.capture),
    },
    firstCase: {
      coldWire: coldReaderSummary(readers.firstCase.coldWire),
      capture: coldReaderSummary(readers.firstCase.capture),
    },
  }
  const parsed = v.safeParse(readerSnapshotSchema, value)
  return parsed.success ? parsed.output : null
}
export function createColdReaderObservation(enabled: boolean) {
  if (!enabled) return <T>(_kind: 'coldWire' | 'capture', _chunk: Buffer, read: () => T) => read()
  const state = store(),
    readers = (state.readers ??= createReaders())
  if (state.record) readers.firstStarted = true
  return <T>(kind: 'coldWire' | 'capture', chunk: Buffer, read: () => T) => {
    if (store() !== state || state.readers !== readers || (state.firstSeen && !state.record))
      return read()
    const first = state.record?.readerWindowOpen ? readers.firstCase[kind] : null
    return measureColdReader(readers.suite[kind], first, chunk, read)
  }
}
type Record = {
  output: string
  readerWindowOpen: boolean
  phases: {
    phase: ColdProfilePhase
    cpu: ReturnType<typeof coldCpu>
    pendingRequests: number
    readers: ReturnType<typeof readerSnapshot>
  }[]
  browser: v.InferOutput<typeof browserSchema>[]
  server: v.InferOutput<typeof serverSchema> | null
  refused: number
  wire: ColdWireCoverage | null
  observerMs: number
}
type Store = { firstSeen: boolean; record: Record | null; readers?: Readers }
declare global {
  var __retentionColdCost: Store | undefined
}
function store() {
  return (globalThis.__retentionColdCost ??= { firstSeen: false, record: null })
}
export function beginColdProfile(
  enabled: boolean,
  arm: { syntax: string; font: string; saved: string },
  output: string,
) {
  const state = store()
  if (state.firstSeen) return false
  state.firstSeen = true
  if (!enabled || arm.syntax !== 'plain' || arm.font !== 'normal' || arm.saved !== 'absent')
    return false
  state.record = {
    output,
    readerWindowOpen: true,
    phases: [],
    browser: [],
    server: null,
    refused: 0,
    wire: null,
    observerMs: 0,
  }
  if (state.readers) state.readers.firstStarted = true
  return true
}
export function markColdProfile(phase: ColdProfilePhase, pending = 0) {
  safeColdObserve(() => {
    const record = store().record
    if (!record) return
    if (phase === 'cancelled' || phase === 'cleanup') record.readerWindowOpen = false
    if (record.phases.length >= 9) return
    const start = performance.now()
    record.phases.push({
      phase,
      cpu: coldCpu(),
      pendingRequests: pending,
      readers: readerSnapshot(),
    })
    record.observerMs += performance.now() - start
  })
}
export function acceptColdFact(text: string) {
  try {
    const record = store().record
    if (!record) return 'inactive' as const
    const fact = parseColdFact(text)
    if (!fact) {
      if (text.startsWith(coldProfilePrefix)) record.refused++
      return 'refused' as const
    }
    if (fact.kind === 'server') {
      record.server = fact
      return 'accepted' as const
    }
    if (record.browser.length >= 6) {
      record.refused++
      return 'refused' as const
    }
    record.browser.push(fact)
    return 'accepted' as const
  } catch {
    return 'refused' as const
  }
}
export function readColdWire(enabled: boolean) {
  if (!enabled) return Object.assign((_chunk: Buffer) => {}, { finish: () => {} })
  const prefix = Buffer.from(coldProfilePrefix),
    pending = Buffer.alloc(16_384)
  const decoder = new TextDecoder('utf-8', { fatal: true })
  const coverage: ColdWireCoverage = {
    bytesSeen: 0,
    profileLines: 0,
    ordinaryLines: 0,
    ordinaryEofBytes: 0,
    acceptedFrames: 0,
    invalidFrames: 0,
    oversizedFrames: 0,
    incompleteFrames: 0,
    inactiveFrames: 0,
    decodeFailures: 0,
    discardedBytes: 0,
    afterEofBytes: 0,
    observerFailures: 0,
    eofObserved: false,
  }
  let length = 0,
    lineBytes = 0
  let state: 'prefix' | 'profile' | 'ordinary' | 'oversized' = 'prefix'
  const attach = () => {
    const record = store().record
    if (record) record.wire = coverage
  }
  const refuse = () => {
    const record = store().record
    if (record) record.refused++
  }
  const complete = () => {
    if (state === 'ordinary') {
      coverage.ordinaryLines++
      return
    }
    if (state === 'oversized') {
      coverage.profileLines++
      return
    }
    if (state !== 'profile' && !length) {
      coverage.ordinaryLines++
      return
    }
    if (state !== 'profile') {
      coverage.invalidFrames++
      coverage.discardedBytes += lineBytes
      refuse()
      return
    }
    coverage.profileLines++
    let text: string
    try {
      text = decoder.decode(pending.subarray(0, length))
    } catch {
      coverage.decodeFailures++
      coverage.discardedBytes += lineBytes
      refuse()
      return
    }
    const result = acceptColdFact(text)
    if (result === 'accepted') {
      coverage.acceptedFrames++
      return
    }
    if (result === 'inactive') coverage.inactiveFrames++
    else coverage.invalidFrames++
    coverage.discardedBytes += lineBytes
  }
  const byte = (value: number) => {
    if (value === 10) {
      complete()
      length = 0
      lineBytes = 0
      state = 'prefix'
      return
    }
    lineBytes++
    if (state === 'ordinary') return
    if (state === 'oversized') {
      coverage.discardedBytes++
      return
    }
    if (length === pending.length) {
      state = 'oversized'
      coverage.oversizedFrames++
      coverage.discardedBytes += lineBytes
      refuse()
      length = 0
      return
    }
    pending[length++] = value
    if (state === 'profile') return
    if (prefix[length - 1] !== value) {
      state = 'ordinary'
      length = 0
      return
    }
    if (length === prefix.length) state = 'profile'
  }
  const read = (chunk: Buffer) => {
    attach()
    coverage.bytesSeen += chunk.length
    if (coverage.eofObserved) {
      coverage.afterEofBytes += chunk.length
      return
    }
    try {
      for (const value of chunk) byte(value)
    } catch {
      coverage.observerFailures++
    }
  }
  const finish = () => {
    attach()
    if (coverage.eofObserved) return
    coverage.eofObserved = true
    if (state === 'ordinary') coverage.ordinaryEofBytes = lineBytes
    if (lineBytes && state !== 'ordinary') {
      coverage.incompleteFrames++
      if (state !== 'oversized') {
        coverage.discardedBytes += lineBytes
        refuse()
      }
    }
    length = 0
    lineBytes = 0
  }
  return Object.assign(read, { finish })
}
export async function publishColdProfile() {
  const record = store().record
  if (!record) return
  try {
    const payload = {
      version: 1,
      clocks: {
        controller: 'node-process',
        server: 'serving-node-process',
        browser: 'per-document-timeOrigin',
      },
      ...record,
      output: undefined,
      readerWindowOpen: undefined,
      readers: readerSnapshot(),
      readerObservationReason: !store().readers
        ? 'unavailable'
        : readerSnapshot()
          ? null
          : 'observer-refused',
      readerAdmission:
        'first-case beginColdProfile through cancelled or cleanup-mark entry; helper-lifetime suite; callbacks admitted at invocation',
      readerCpuLimit:
        'public thread counter bracket includes clock/counter edges; whole observer overhead unqualified',
      wireComplete: record.wire?.eofObserved
        ? record.wire.discardedBytes === 0 &&
          record.wire.afterEofBytes === 0 &&
          record.wire.observerFailures === 0
        : null,
      wireReason: !record.wire
        ? 'unavailable'
        : !record.wire.eofObserved
          ? 'eof-unobserved'
          : record.wire.discardedBytes || record.wire.afterEofBytes || record.wire.observerFailures
            ? 'loss-observed'
            : null,
      missingServerReason: record.server ? null : 'unavailable',
      missingBrowserReason: record.browser.length ? null : 'unavailable',
      queueDepth: null,
      queueReason: 'unsupported-public-queue-depth',
      percentileMethod: 'complete-log2-histogram-upper-bounds; final-bucket-overflow',
      processVersion: process.versions.node,
      checkoutSha: /^[a-f0-9]{40}$/.test(process.env.GITHUB_SHA ?? '')
        ? process.env.GITHUB_SHA
        : null,
    }
    const text = JSON.stringify(payload)
    if (Buffer.byteLength(text) > 65_536) return
    await writeFile(join(record.output, 'cold-cost.json'), text)
    console.info('RETENTION_COLD_PROFILE ' + text)
  } catch {
  } finally {
    store().record = null
  }
}

export function observeColdPromise<T>(operation: () => Promise<T>, terminal: () => void) {
  const promise = operation()
  safeColdObserve(() => {
    void promise.then(
      () => {
        safeColdObserve(terminal)
      },
      () => {
        safeColdObserve(terminal)
      },
    )
  })
  return promise
}
