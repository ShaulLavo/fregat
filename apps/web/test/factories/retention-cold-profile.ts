import { performance } from 'node:perf_hooks'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import * as v from 'valibot'

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
  reason: v.nullable(v.literal('unsupported')),
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
  resourceReason: v.nullable(v.literal('unsupported')),
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
  reason: v.nullable(v.literal('unsupported')),
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
type Record = {
  output: string
  phases: { phase: ColdProfilePhase; cpu: ReturnType<typeof coldCpu>; pendingRequests: number }[]
  browser: v.InferOutput<typeof browserSchema>[]
  server: v.InferOutput<typeof serverSchema> | null
  refused: number
  observerMs: number
}
type Store = { firstSeen: boolean; record: Record | null }
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
  state.record = { output, phases: [], browser: [], server: null, refused: 0, observerMs: 0 }
  return true
}
export function markColdProfile(phase: ColdProfilePhase, pending = 0) {
  safeColdObserve(() => {
    const record = store().record
    if (!record || record.phases.length >= 9) return
    const start = performance.now()
    record.phases.push({ phase, cpu: coldCpu(), pendingRequests: pending })
    record.observerMs += performance.now() - start
  })
}
export function acceptColdFact(text: string) {
  safeColdObserve(() => {
    const record = store().record
    if (!record) return
    const fact = parseColdFact(text)
    if (!fact) {
      if (text.startsWith(coldProfilePrefix)) record.refused++
      return
    }
    if (fact.kind === 'server') {
      record.server = fact
      return
    }
    if (record.browser.length < 6) record.browser.push(fact)
    else record.refused++
  })
}
export function readColdWire(enabled: boolean) {
  if (!enabled) return (_chunk: Buffer) => {}
  let pending = ''
  return (chunk: Buffer) =>
    safeColdObserve(() => {
      pending += chunk.toString('utf8')
      const lines = pending.split('\n')
      pending = lines.pop() ?? ''
      if (Buffer.byteLength(pending) > 16_384) pending = ''
      for (const line of lines) if (line.startsWith(coldProfilePrefix)) acceptColdFact(line)
    })
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
  return operation().finally(() => safeColdObserve(terminal))
}
