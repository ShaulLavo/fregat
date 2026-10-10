import { mkdirSync, writeFileSync } from 'node:fs'
import { cpus } from 'node:os'
import { resolve } from 'node:path'
import { PerformanceObserver, performance } from 'node:perf_hooks'
import { Session } from 'node:inspector'
import { expect, test } from 'vitest'
import { ConfirmedWindow } from '@singapore-editor/collab'
import { syntaxFixture } from '../test/merge-review-fixture'
import { workload } from './workload'

const percentile = (values: readonly number[], q: number) =>
  values.toSorted((a, b) => a - b)[Math.floor(values.length * q)]!

test('attribute ordinary batch tails and sampled allocations', async () => {
  const fixture = await syntaxFixture('typescript', true, 'projected')
  const { prefix, batch, confirmed } = workload(4, 8192)
  const ids = batch.map((edit) => edit.id)
  const collections: { start: number; duration: number }[] = []
  const observer = new PerformanceObserver((list) => {
    for (const entry of list.getEntries())
      collections.push({ start: entry.startTime, duration: entry.duration })
  })
  observer.observe({ entryTypes: ['gc'] })
  const samples: {
    mode: string
    start: number
    end: number
    elapsedMs: number
    heapDeltaBytes: number
    ranges: number
    queries: number
    parses: number
  }[] = []
  const session = new Session()
  session.connect()
  const post = <T>(method: string, params = {}) =>
    new Promise<T>((resolve, reject) => {
      session.post(method, params, (error, result) =>
        error ? reject(error) : resolve(result as T),
      )
    })
  try {
    await fixture.syntax(confirmed.buffer, [])
    for (const mode of ['ordinary', 'gc-control', 'gc-control', 'ordinary']) {
      for (let sample = -10; sample < 50; sample++) {
        const window = new ConfirmedWindow(prefix)
        fixture.resetQueries()
        fixture.resetMetrics()
        if (mode === 'gc-control') globalThis.gc?.()
        const heap = process.memoryUsage().heapUsed
        const start = performance.now()
        window.append(batch)
        const result = await fixture.detector.detect(window, confirmed, ids)
        const end = performance.now()
        const heapDeltaBytes = process.memoryUsage().heapUsed - heap
        expect(result.status).toBe('complete')
        expect(result.marks).toHaveLength(0)
        expect(fixture.metrics.ranges).toBe(100)
        expect(fixture.metrics.queries).toBe(400)
        expect(fixture.metrics.parses).toBe(0)
        if (sample >= 0)
          samples.push({
            mode,
            start,
            end,
            elapsedMs: end - start,
            heapDeltaBytes,
            ranges: fixture.metrics.ranges,
            queries: fixture.metrics.queries,
            parses: fixture.metrics.parses,
          })
        await new Promise<void>((resolve) => setImmediate(resolve))
      }
    }
    const window = new ConfirmedWindow(prefix)
    window.append(batch)
    await post('HeapProfiler.startSampling', {
      samplingInterval: 128,
      includeObjectsCollectedByMajorGC: true,
      includeObjectsCollectedByMinorGC: true,
    })
    for (let index = 0; index < 20; index++) {
      fixture.resetQueries()
      await fixture.detector.detect(window, confirmed, ids)
    }
    type AllocationNode = {
      selfSize: number
      callFrame: { functionName: string }
      children: AllocationNode[]
    }
    const { profile } = await post<{
      profile: { samples: { size: number }[]; head: AllocationNode }
    }>('HeapProfiler.stopSampling')
    const allocations = new Map<string, number>()
    const pending = [{ node: profile.head, parents: [] as string[] }]
    while (pending.length) {
      const { node, parents } = pending.pop()!
      const path = parents.concat([node.callFrame.functionName || '(anonymous)']).slice(-4)
      const name = path.join(' > ')
      allocations.set(name, (allocations.get(name) ?? 0) + node.selfSize)
      for (const child of node.children) pending.push({ node: child, parents: path })
    }
    const allocationSites = Array.from(allocations, ([functionName, estimatedBytes]) => ({
      functionName,
      estimatedBytes,
    }))
      .sort((a, b) => b.estimatedBytes - a.estimatedBytes)
      .slice(0, 20)
    const annotated = samples.map((sample) => ({
      ...sample,
      gcMs: collections.reduce(
        (sum, gc) =>
          sum +
          Math.max(
            0,
            Math.min(sample.end, gc.start + gc.duration) - Math.max(sample.start, gc.start),
          ),
        0,
      ),
    }))
    const summaries = ['ordinary', 'gc-control'].map((mode) => {
      const values = annotated.filter((sample) => sample.mode === mode)
      const p95 = percentile(
        values.map((sample) => sample.elapsedMs),
        0.95,
      )
      return {
        mode,
        medianMs: percentile(
          values.map((sample) => sample.elapsedMs),
          0.5,
        ),
        p95Ms: p95,
        tailSamples: values.filter((sample) => sample.elapsedMs >= p95),
        gcSamples: values.filter((sample) => sample.gcMs > 0).length,
      }
    })
    const evidence = {
      qualification: 'experiment, shared machine',
      environment: { platform: process.platform, cpu: cpus()[0]?.model, runtime: process.version },
      method:
        '100k TypeScript lines, 100 edits, four authors, 8192 retained records. Four complete A/B/B/A blocks compare ordinary batches with explicit GC outside the timer (requires node --expose-gc). Window setup and current parsing are outside timers. 20 warmups and 100 samples per mode. Real query instrumentation is included. GC observer timestamps are intersected with each batch. Separate V8 allocation sampling at 128 bytes includes collected objects over 20 detector-only batches; sample counts are estimates, not exact allocations. Linux timing fields are diagnostics only; Mac on AC under the shared Mac turn supplies timing verdicts.',
      explicitGcAvailable: Boolean(globalThis.gc),
      summaries,
      allocationSampling: {
        intervalBytes: 128,
        batches: 20,
        sampledAllocations: profile.samples.length,
        allocationSites,
        estimatedAllocatedBytes: profile.samples.reduce((sum, sample) => sum + sample.size, 0),
      },
      samples: annotated,
    }
    const directory = process.env.E068_EVIDENCE_DIR ?? new URL('.', import.meta.url).pathname
    mkdirSync(directory, { recursive: true })
    writeFileSync(
      resolve(directory, 'tail-evidence.json'),
      JSON.stringify(evidence, null, 2) + '\n',
    )
    console.log(JSON.stringify({ ...evidence, samples: undefined }, null, 2))
  } finally {
    observer.disconnect()
    session.disconnect()
    fixture.dispose()
  }
}, 180_000)
