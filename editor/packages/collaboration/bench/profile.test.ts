import { writeFileSync } from 'node:fs'
import { Session } from 'node:inspector'
import type { Profiler } from 'node:inspector'
import { expect, test } from 'vitest'
import { ConfirmedWindow } from '@singapore-editor/collab'
import { syntaxFixture } from '../test/merge-review-fixture'
import { workload } from './workload'

function category(stack: readonly string[]): string {
  if (stack.includes('ConfirmedWindow')) return 'outside-timer: window setup'
  if (stack.includes('projectEffects')) return 'projectEffects rebuilds'
  if (stack.includes('append')) return 'concurrency append'
  if (stack.includes('pairs')) return 'exact concurrent pairs'
  if (
    stack.some((name) =>
      [
        'enclosingMergeUnit',
        'touchingMergeUnits',
        'analyzeLineMergeUnit',
        'rangeContentKey',
        'unitAt',
        'parentEligibility',
        'nodeContentKey',
        'mergeRangeHasErrors',
      ].includes(name),
    )
  )
    return 'parse/query and unit selection'
  if (
    stack.some((name) =>
      [
        'collectCandidates',
        'normalizeSignature',
        'sharedDeletion',
        'sameUnit',
        'sameCommutativeParent',
      ].includes(name),
    )
  )
    return 'signature/candidate checks'
  if (stack.some((name) => ['orphanPair', 'orphan'].includes(name))) return 'orphan checks'
  if (stack.some((name) => ['touchedRanges', 'spanRanges', 'effectActive'].includes(name)))
    return 'identity mapping/effect visibility'
  if (stack.includes('detect')) return 'detector bookkeeping'
  return 'outside-timer: setup, validation, GC, harness'
}

function samplesByCategory(profile: Profiler.Profile) {
  const nodes = new Map(profile.nodes.map((node) => [node.id, node]))
  const parents = new Map<number, number>()
  for (const node of profile.nodes)
    for (const child of node.children ?? []) parents.set(child, node.id)
  const totals: Record<string, number> = {}
  for (const [index, id] of (profile.samples ?? []).entries()) {
    const stack: string[] = []
    for (
      let current: number | undefined = id;
      current !== undefined;
      current = parents.get(current)
    ) {
      const node = nodes.get(current)!
      stack.push(node.callFrame.functionName)
    }
    const key = category(stack)
    totals[key] = (totals[key] ?? 0) + (profile.timeDeltas?.[index] ?? 0) / 1000
  }
  return totals
}

const mean = (values: readonly number[]) =>
  values.reduce((sum, value) => sum + value, 0) / values.length

test('profile a retained 100k-line / 100-edit batch, experiment, shared machine', async () => {
  const fixture = await syntaxFixture('typescript', true)
  const { prefix, batch, confirmed } = workload(4, 8192)
  const ids = batch.map((edit) => edit.id)
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
    for (let index = 0; index < 20; index++) {
      const window = new ConfirmedWindow(prefix)
      window.append(batch)
      await fixture.detector.detect(window, confirmed, ids)
    }
    fixture.resetMetrics()
    const append: number[] = []
    const pairs: number[] = []
    const detector: number[] = []
    await post('Profiler.enable')
    await post('Profiler.setSamplingInterval', { interval: 100 })
    const cpu: Record<string, number> = {}
    for (let sample = 0; sample < 40; sample++) {
      for (const mode of ['pairs', 'detector', 'detector', 'pairs'] as const) {
        const window = new ConfirmedWindow(prefix)
        fixture.resetQueries()
        await post('Profiler.start')
        const before = performance.now()
        window.append(batch)
        const appended = performance.now()
        const result =
          mode === 'pairs'
            ? window.pairs(ids)
            : await fixture.detector.detect(window, confirmed, ids)
        const elapsed = performance.now() - appended
        const { profile } = await post<{ profile: Profiler.Profile }>('Profiler.stop')
        for (const [key, value] of Object.entries(samplesByCategory(profile)))
          cpu[key] = (cpu[key] ?? 0) + value
        append.push(appended - before)
        if (!('status' in result)) {
          pairs.push(elapsed)
          expect(result).toHaveLength(3750)
        } else {
          detector.push(elapsed)
          expect(result.status).toBe('complete')
          expect(result.marks).toHaveLength(0)
        }
      }
    }
    const measured = Object.entries(cpu).filter(([key]) => !key.startsWith('outside-timer:'))
    const batches = detector.length
    const cpuPerBatch = measured.map(
      ([key, value]) =>
        [
          key,
          value /
            (key === 'concurrency append' || key === 'exact concurrent pairs'
              ? batches * 2
              : batches),
        ] as const,
    )
    const sampledMs = cpuPerBatch.reduce((sum, [, value]) => sum + value, 0)
    const evidence = {
      qualification:
        'experiment, shared machine; profiling overhead included, not the cost-gate result',
      workload: {
        lines: 100_000,
        edits: 100,
        authors: 4,
        retained: 8192,
        detectorBatches: batches,
      },
      method:
        'Retained current parse prepared outside timing. 20 warmups, then A/B/B/A with 80 samples per mode. A: exact pairs. B: complete detector. Append separately timed in both modes. Query instrumentation calls the original real Query.matches. V8 CPU sampling at 100 microseconds starts after each window setup and stops before validation; GC/harness remain separately reported. CPU categories normalize append and pair samples across both modes to one complete batch. CPU shares are sampling estimates, not additive wall timings.',
      wall: {
        appendMeanMs: mean(append),
        exactPairsMeanMs: mean(pairs),
        detectorWithoutAppendMeanMs: mean(detector),
        currentUnitLookupsMeanMs: fixture.metrics.unitsMs / batches,
        queryMatchesMeanMs: fixture.metrics.queryMs / batches,
        unitLookupsPerBatch: fixture.metrics.ranges / batches,
        unitLookupsPerEdit: fixture.metrics.ranges / batches / 100,
        queryMatchesPerBatch: fixture.metrics.queries / batches,
        queryMatchesPerEdit: fixture.metrics.queries / batches / 100,
        parseCallsInsideTiming: fixture.metrics.parses,
        parseMsInsideTiming: fixture.metrics.parseMs,
        projectEffectsRebuildsInsideTiming: 0,
      },
      reconstruction:
        'This independent-unit batch produces no candidates: no projected snapshots, version parsing, content fingerprints or projectEffects rebuilds. The conflict corpus separately exercises reconstruction; this profile does not bound its cost.',
      cpuSampledMs: cpu,
      cpuPerBatchEstimatedMs: Object.fromEntries(cpuPerBatch),
      cpuMeasuredShares: Object.fromEntries(
        cpuPerBatch.map(([key, value]) => [key, value / sampledMs]),
      ),
    }
    expect(fixture.metrics.ranges / batches).toBe(100)
    expect(fixture.metrics.parses).toBe(0)
    writeFileSync(
      new URL('./detector-profile-evidence.json', import.meta.url),
      JSON.stringify(evidence, null, 2) + '\n',
    )
    console.log(JSON.stringify(evidence, null, 2))
  } finally {
    session.disconnect()
    fixture.dispose()
  }
})
