import { isRecord } from '@workspace/utils/objects'
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { createBenchmarkError } from './structured-errors.ts'

const calibrationFile = resolve(import.meta.dirname, 'editor-open-benchmark-calibration.json')
const seeds = [60_061, 60_062, 60_063]
const evidence = []

for (const seed of seeds) evidence.push(await runCalibration(seed))

writeFileSync(calibrationFile, `${JSON.stringify(calibrationBundle(evidence), null, 2)}\n`)
console.log(`EDITOR_OPEN_BENCHMARK_CALIBRATION ${calibrationFile}`)

function calibrationBundle(entries: readonly unknown[]) {
  const first = entries[0]
  const identity = isRecord(first) ? first.identity : undefined
  if (!identity || typeof identity !== 'object' || Array.isArray(identity)) {
    throw createBenchmarkError('calibration runs returned no benchmark identity')
  }

  const serializedIdentity = JSON.stringify(identity)
  for (const entry of entries) {
    if (JSON.stringify(isRecord(entry) ? entry.identity : undefined) === serializedIdentity)
      continue
    throw createBenchmarkError('calibration runs returned different benchmark identities')
  }

  const runs = entries.map((entry) => (isRecord(entry) ? entry.run : undefined))
  if (runs.some((run) => !run || typeof run !== 'object' || Array.isArray(run))) {
    throw createBenchmarkError('calibration run returned no measurements')
  }
  return { schemaVersion: 2, identity, runs }
}

async function runCalibration(seed: number) {
  const child = Bun.spawn({
    cmd: [
      process.execPath,
      'scripts/editor-open-benchmark.ts',
      '--calibrate',
      '--summary-only',
      '--browsers=chromium',
      `--seed=${seed}`,
    ],
    cwd: resolve(import.meta.dirname, '..'),
    stderr: 'pipe',
    stdout: 'pipe',
  })
  const [exitCode, stderr, stdout] = await Promise.all([
    child.exited,
    new Response(child.stderr).text(),
    new Response(child.stdout).text(),
  ])
  if (exitCode !== 0) {
    throw createBenchmarkError(`calibration seed ${seed} failed: ${stderr.trim()}`)
  }

  const prefix = 'EDITOR_OPEN_BENCHMARK_EVIDENCE '
  const evidenceLine = stdout.split('\n').find((line: string) => line.startsWith(prefix))
  if (!evidenceLine) {
    throw createBenchmarkError(`calibration seed ${seed} returned no evidence`)
  }

  const evidence: unknown = JSON.parse(evidenceLine.slice(prefix.length))
  console.log(`EDITOR_OPEN_BENCHMARK_CALIBRATION_RUN ${JSON.stringify(evidence)}`)
  return evidence
}
