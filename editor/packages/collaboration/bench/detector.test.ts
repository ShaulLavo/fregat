import { writeFileSync } from 'node:fs'
import { cpus } from 'node:os'
import { performance } from 'node:perf_hooks'
import { expect, test } from 'vitest'
import { ConfirmedWindow } from '@singapore-editor/collab'
import { characters, lines, workload } from './workload'
import { syntaxFixture } from '../test/merge-review-fixture'

const percentile = (values: readonly number[], quantile: number) =>
  values.toSorted((a, b) => a - b)[Math.floor(values.length * quantile)]!
const results: unknown[] = []

test('confirmed batches on a 100k-line TypeScript file, experiment, shared machine', async () => {
  for (const retained of [100, 8192]) {
    for (const authors of [2, 4, 8]) {
      const fixture = await syntaxFixture()
      try {
        const { prefix, batch, confirmed } = workload(authors, retained)
        const ids = batch.map((edit) => edit.id)
        const expectedPairs = batch.reduce(
          (count, edit, index) =>
            count +
            batch.slice(index + 1).filter((other) => other.id.actor !== edit.id.actor).length,
          0,
        )
        await fixture.syntax(confirmed.buffer, [])
        const samples = { 'query-only': [] as number[], 'complete-detector': [] as number[] }
        for (let sample = -10; sample < 30; sample++) {
          for (const mode of [
            'query-only',
            'complete-detector',
            'complete-detector',
            'query-only',
          ] as const) {
            const window = new ConfirmedWindow(prefix)
            fixture.resetQueries()
            const before = performance.now()
            window.append(batch)
            const result =
              mode === 'query-only'
                ? window.pairs(ids)
                : await fixture.detector.detect(window, confirmed, ids)
            const elapsed = performance.now() - before
            if (!('status' in result)) {
              expect(result).toHaveLength(expectedPairs)
            } else {
              expect(result.status).toBe('complete')
              expect(result.marks).toHaveLength(0)
            }
            if (sample >= 0) samples[mode].push(elapsed)
          }
        }
        for (const [mode, values] of Object.entries(samples))
          results.push({
            authors,
            retained,
            mode,
            medianMs: percentile(values, 0.5),
            p95Ms: percentile(values, 0.95),
            samplesMs: values,
          })
      } finally {
        fixture.dispose()
      }
    }
  }
  const evidence = {
    qualification: 'experiment, shared machine',
    environment: { runtime: process.version, cpu: cpus()[0]?.model, platform: process.platform },
    method:
      '100k TypeScript lines. 100 concurrent single-character replacements, 2/4/8 authors, 100 or 8192 retained records. 60 samples per mode after 20 warmups, alternating A/B/B/A. A appends the batch and queries exact pairs. B appends the batch and runs the detector including footprint mapping and real merge-unit queries. The retained parse is prepared outside timers, as detection runs after parsing. Parent eligibility caches reset before every batch. Setup, authoring, engine application and causal-prefix preparation stay outside timers. IPC, parsing the current snapshot, and UI are excluded. No candidate marks in this independent-unit workload; version rebuilding has a separate correctness corpus.',
    targetMs: 2,
    lines,
    characters,
    results,
  }
  writeFileSync(
    new URL('./detector-evidence.json', import.meta.url),
    JSON.stringify(evidence, null, 2) + '\n',
  )
  console.log(
    JSON.stringify(
      {
        ...evidence,
        results: results.map((entry) => {
          const { samplesMs: _samplesMs, ...summary } = entry as { samplesMs: number[] }
          return summary
        }),
      },
      null,
      2,
    ),
  )
})
