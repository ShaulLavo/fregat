import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { validateResult } from '../results.mjs'

const paths = process.argv.slice(2)
assert.equal(paths.length, 2, 'Usage: node summarize-change.mjs BEFORE.json AFTER.json')
const [before, after] = await Promise.all(
  paths.map(async (path) => validateResult(JSON.parse(await readFile(path, 'utf8')))),
)
assert.deepEqual(before.manifest, after.manifest, 'Fixture hashes must match')
assert.deepEqual(before.config, after.config, 'Workloads and build modes must match')
for (const field of ['browser', 'hardware', 'runtime']) {
  assert.deepEqual(before.environment[field], after.environment[field], `${field} must match`)
}
assert.notEqual(before.id, after.id, 'Runs must be independent')

const baseline = groupLatencies(before)
const metrics = [...groupLatencies(after)].map(([key, values]) => {
  const old = summarize(baseline.get(key))
  const next = summarize(values)
  return { key, before: old, after: next, p95Speedup: old.p95Ms / next.p95Ms }
})
console.log(
  JSON.stringify(
    {
      before: before.id,
      after: after.id,
      samplesPerRun: after.samples.length,
      comparable: true,
      correctnessAndCleanupPassed: true,
      metrics,
    },
    null,
    2,
  ),
)

function groupLatencies(result) {
  const groups = new Map()
  for (const sample of result.samples) {
    for (const [metric, values] of Object.entries(sample.latencyMs)) {
      const key = `${sample.fixture}/${sample.scenario}/${sample.state}/${metric}`
      groups.set(key, [...(groups.get(key) ?? []), ...values])
    }
  }
  return groups
}

function summarize(values) {
  const sorted = values.toSorted((a, b) => a - b)
  const at = (fraction) => sorted[Math.ceil(sorted.length * fraction) - 1]
  return { count: values.length, p50Ms: at(0.5), p95Ms: at(0.95) }
}
