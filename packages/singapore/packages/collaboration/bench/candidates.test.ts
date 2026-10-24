import { writeFileSync } from 'node:fs'
import { cpus } from 'node:os'
import { performance } from 'node:perf_hooks'
import { expect, test, vi } from 'vitest'
import { ConfirmedWindow, TextbufferEngine } from '@singapore-editor/collab'
import { MergeReviewDetector } from '../src/merge-review'
import { syntaxFixture } from '../test/merge-review-fixture'
import { characters, lines, workload } from './workload'

const percentile = (values: readonly number[], quantile: number) =>
  values.toSorted((a, b) => a - b)[Math.floor(values.length * quantile)]!

test('marked batches include projections, version parses and fingerprints, experiment, shared machine', async () => {
  const fixture = await syntaxFixture('typescript', true, 'projected')
  const { prefix, batch, confirmed } = workload(4, 8192, true)
  const ids = batch.map((edit) => edit.id)
  const projections = vi.spyOn(TextbufferEngine.prototype, 'projectEffects')
  let fingerprints = 0
  const detector = new MergeReviewDetector(
    (snapshot, ranges, contentKey, selection, baseSnapshot) => {
      if (contentKey) fingerprints += ranges.length
      return fixture.syntax(snapshot, ranges, contentKey, selection, baseSnapshot)
    },
  )
  const samples: ({
    elapsedMs: number
    projections: number
    fingerprints: number
    marks: number
  } & typeof fixture.metrics)[] = []
  try {
    for (let sample = -2; sample < 8; sample++) {
      fixture.clear()
      await fixture.syntax(confirmed.buffer, [])
      fixture.resetMetrics()
      projections.mockClear()
      fingerprints = 0
      const window = new ConfirmedWindow(prefix)
      const before = performance.now()
      window.append(batch)
      const result = await detector.detect(window, confirmed, ids)
      const elapsedMs = performance.now() - before
      expect(result.status).toBe('complete')
      expect([...new Set(result.marks.map((mark) => mark.kind))].sort()).toEqual([
        'overlap',
        'parse',
      ])
      expect(
        result.marks.every((mark) =>
          mark.edits.every((edit) =>
            ids.slice(98).some((id) => id.actor === edit.actor && id.seq === edit.seq),
          ),
        ),
      ).toBe(true)
      expect(projections.mock.calls.length).toBeGreaterThan(0)
      expect(fixture.metrics.parses).toBeGreaterThan(0)
      expect(fingerprints).toBeGreaterThan(0)
      if (sample >= 0)
        samples.push({
          elapsedMs,
          projections: projections.mock.calls.length,
          fingerprints,
          marks: result.marks.length,
          ...fixture.metrics,
        })
    }
    const evidence = {
      qualification: 'experiment, shared machine',
      environment: { runtime: process.version, cpu: cpus()[0]?.model, platform: process.platform },
      versionParsing: samples.some((sample) => sample.boundedParses)
        ? 'bounded parent context'
        : 'cold full reparse',
      targetMedianMs: 8,
      method:
        '100k TypeScript lines, 100 concurrent edits, 4 authors, 8192 retained records. 96 independent replacements, a whitespace/content pair and two conflicting string replacements. Current parse, authoring and causal prefix prepared outside timing. Complete append/detection includes projected snapshots, bounded parent-context version parses (copied-tree incremental fallback) and content fingerprints. Two warmups and eight samples. Retained trees are released between batches. Parse/query instrumentation calls the real implementation. Before/after order is supplied by the four A/B/B/A invocations, not by this test. IPC and UI excluded.',
      lines,
      characters,
      medianMs: percentile(
        samples.map((sample) => sample.elapsedMs),
        0.5,
      ),
      p95Ms: percentile(
        samples.map((sample) => sample.elapsedMs),
        0.95,
      ),
      samples,
    }
    writeFileSync(
      new URL('./candidate-evidence.json', import.meta.url),
      JSON.stringify(evidence, null, 2) + '\n',
    )
    console.log(JSON.stringify(evidence, null, 2))
    if (samples.some((sample) => sample.boundedParses)) expect(evidence.medianMs).toBeLessThan(8)
  } finally {
    projections.mockRestore()
    fixture.dispose()
  }
})
