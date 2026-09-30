import { readFile } from 'node:fs/promises'
import { gunzipSync } from 'node:zlib'
import { fail } from './errors.mjs'

const paths = process.argv.slice(2)
if (paths.length < 1) fail('Pass one or more E034 first-paint result files')
const results = await Promise.all(paths.map(readResult))
const first = results[0]
for (const result of results) {
  if (!result.config.fallbackCases) fail('Expected fallback cases')
  if (JSON.stringify(result.manifest) !== JSON.stringify(first.manifest))
    fail('Fixture manifests differ')
  if (JSON.stringify(result.config) !== JSON.stringify(first.config))
    fail('Benchmark settings differ')
  if (result.environment.cpuAffinity !== first.environment.cpuAffinity) fail('CPU affinity differs')
  if (result.samples.some((sample) => !sample.correct || !sample.fallback))
    fail('Incomplete or incorrect sample')
}
console.log(
  JSON.stringify(
    results.map((result, index) => summarize(paths[index], result)),
    null,
    2,
  ),
)

async function readResult(path) {
  const bytes = await readFile(path)
  const content = path.endsWith('.gz') ? gunzipSync(bytes) : bytes
  return JSON.parse(content.toString('utf8'))
}

function distribution(values) {
  const sorted = values.toSorted((left, right) => left - right)
  const quantile = (fraction) => sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)]
  return { count: sorted.length, p50: quantile(0.5), p95: quantile(0.95), max: sorted.at(-1) }
}

function summarize(path, result) {
  return {
    path,
    sourceHash: result.environment.sourceHash,
    bundleHash: result.environment.bundleHash,
    coreBuildHash: result.environment.coreBuildHash,
    cpuAffinity: result.environment.cpuAffinity ?? null,
    diagnostics: result.config.diagnostics,
    foldGutter: result.config.foldGutter,
    groups: result.config.modes.flatMap((mode) =>
      result.config.states.map((state) => summarizeGroup(result, mode, state)),
    ),
  }
}

function summarizeGroup(result, mode, state) {
  const samples = result.samples.filter((sample) => sample.mode === mode && sample.state === state)
  const bursts = samples.flatMap((sample) => sample.fallback.bursts)
  const input = bursts.flatMap((burst) => burst.events)
  const work = samples.flatMap((sample) =>
    sample.observation.diagnostics.filter((event) => event.name.includes('fallbackFold')),
  )
  if (work.some((event) => Number(event.detail?.materializations ?? 0) !== 0))
    fail('Fallback work materialized a document')
  return {
    mode,
    state,
    milliseconds: {
      buffer: distribution(samples.map((sample) => sample.latencyMs.buffer)),
      constructor: distribution(samples.map((sample) => sample.latencyMs.constructor)),
      attach: distribution(samples.map((sample) => sample.latencyMs.attach)),
      textCallback: distribution(samples.map((sample) => sample.latencyMs.textCallback)),
      visibleTextUpperBound: distribution(
        samples.map((sample) => sample.latencyMs.visibleTextUpperBound),
      ),
      preparation: distribution(samples.map((sample) => sample.latencyMs.preparation)),
      inputApplied: distribution(input.map((event) => event.appliedAt - event.at)),
      inputFrame: distribution(input.map((event) => event.frameAt - event.at)),
      firstFoldCommand: distribution(
        samples.map((sample) => sample.fallback.commands[0].durationMs),
      ),
      foldAll: distribution(samples.map((sample) => sample.fallback.commands[2].durationMs)),
    },
    bytes: {
      initialHeap: distribution(samples.map((sample) => sample.fallback.initialHeap.usedSize)),
      editedHeap: distribution(samples.map((sample) => sample.fallback.editedHeap.usedSize)),
      initialBackingStorage: distribution(
        samples.map((sample) => sample.fallback.initialHeap.backingStorageSize),
      ),
      editedBackingStorage: distribution(
        samples.map((sample) => sample.fallback.editedHeap.backingStorageSize),
      ),
    },
    work,
  }
}
