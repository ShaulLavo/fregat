import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { Session } from 'node:inspector/promises'
import { performance, PerformanceObserver } from 'node:perf_hooks'
import { setImmediate as nextTurn } from 'node:timers/promises'
import { loadAdapter } from './adapters.mjs'
import { prepareState, runOperations, execute, validate } from './worker.mjs'
import {
  createCounters,
  summarizeCpu,
  summarizeHeap,
  gcWithin,
  structure,
} from './profile-support.mjs'
import { sha256, statistics } from './support.mjs'

const [
  engine,
  filename,
  expectedHash,
  mode,
  repeatsText,
  output,
  rootsFile,
  warmupsText,
  retention = 'always',
] = process.argv.slice(2)
assert(['cpu', 'heap', 'gc', 'counters'].includes(mode), 'Unknown diagnostic mode')
const bytes = readFileSync(filename)
assert.equal(sha256(bytes), expectedHash, 'Fixture hash mismatch')
const fixture = JSON.parse(bytes)
assert(fixture.category !== 'singapore-only' || engine === 'singapore', 'Unsupported capability')
assert(globalThis.gc, 'Run profile worker with --expose-gc')
const repeats = Number(repeatsText)
assert(Number.isSafeInteger(repeats) && repeats > 0 && repeats <= 100)
const warmups = Number(warmupsText)
assert(Number.isSafeInteger(warmups) && warmups >= 0 && warmups <= 20)
const counters = createCounters()
globalThis.__textbufferBenchCounters = counters
const roots = mode === 'counters' ? JSON.parse(readFileSync(rootsFile, 'utf8')) : {}
const factory = await loadAdapter(engine, roots, retention)
for (let index = 0; index < warmups; index += 1) {
  const result = execute(factory, fixture)
  validate(factory, fixture, result)
}
const session = new Session()
if (mode === 'cpu' || mode === 'heap') {
  session.connect()
  if (mode === 'cpu') {
    await session.post('Profiler.enable')
    await session.post('Profiler.setSamplingInterval', { interval: 100 })
  } else await session.post('HeapProfiler.enable')
}
const cpuProfiles = []
const heapProfiles = []
const epochs = []
mkdirSync(output, { recursive: true })
try {
  for (let repeat = 0; repeat < repeats; repeat += 1) {
    globalThis.gc()
    const context = fixture.mode === 'load' ? null : prepareState(factory, fixture)
    globalThis.gc()
    globalThis.gc()
    const entries = []
    let observer
    if (mode === 'gc') {
      observer = new PerformanceObserver((list) => entries.push(...list.getEntries()))
      observer.observe({ entryTypes: ['gc'] })
    }
    if (mode === 'cpu') await session.post('Profiler.start')
    if (mode === 'heap')
      await session.post('HeapProfiler.startSampling', {
        samplingInterval: 16384,
        includeObjectsCollectedByMajorGC: true,
        includeObjectsCollectedByMinorGC: true,
      })
    if (mode === 'counters') counters.start()
    const started = performance.now()
    const result = runOperations(factory, fixture, context)
    const ended = performance.now()
    const work = counters.stop()
    if (mode === 'cpu') {
      const { profile } = await session.post('Profiler.stop')
      cpuProfiles.push(profile)
      writeFileSync(path.join(output, `${repeat}.cpuprofile`), JSON.stringify(profile))
    }
    if (mode === 'heap') {
      const { profile } = await session.post('HeapProfiler.stopSampling')
      heapProfiles.push(profile)
      writeFileSync(path.join(output, `${repeat}.heapprofile`), JSON.stringify(profile))
    }
    if (observer) {
      // GC notifications arrive asynchronously. Forced setup collections are filtered by interval.
      await nextTurn()
      await nextTurn()
      entries.push(...observer.takeRecords())
      observer.disconnect()
    }
    const gc = gcWithin(entries, started, ended)
    const shape = structure(result.buffer)
    validate(factory, fixture, result)
    let warmQueryCounters = null
    if (mode === 'counters' && fixture.mode === 'query') {
      counters.start()
      const warmResult = runOperations(factory, fixture, { buffer: result.buffer, anchors: [] })
      warmQueryCounters = counters.stop()
      validate(factory, fixture, warmResult)
    }
    epochs.push({
      diagnosticElapsedMs: ended - started,
      checksum: result.checksum,
      counters: work,
      warmQueryCounters,
      gc,
      gcMs: gc.reduce((total, event) => total + event.durationMs, 0),
      structure: shape,
      correctness: 'passed',
    })
  }
} finally {
  if (mode === 'cpu' || mode === 'heap') session.disconnect()
  delete globalThis.__textbufferBenchCounters
}
const report = {
  engine,
  mode,
  retention: factory.retention ?? null,
  fixtureSha256: expectedHash,
  repeats,
  diagnosticOnly: true,
  diagnosticTimeMs: statistics(epochs.map((epoch) => epoch.diagnosticElapsedMs)),
  cpu: mode === 'cpu' ? summarizeCpu(cpuProfiles) : null,
  heap: mode === 'heap' ? summarizeHeap(heapProfiles) : null,
  gc:
    mode === 'gc'
      ? {
          events: epochs.reduce((total, epoch) => total + epoch.gc.length, 0),
          durationMs: statistics(epochs.map((epoch) => epoch.gcMs)),
        }
      : null,
  epochs,
}
writeFileSync(path.join(output, 'summary.json'), JSON.stringify(report, null, 2) + '\n')
process.stdout.write(JSON.stringify(report) + '\n')
