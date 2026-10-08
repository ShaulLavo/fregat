import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { fileURLToPath } from 'node:url'
import { loadAdapter } from './adapters.mjs'
import { loadIdentityAdapter } from './identity-adapter.mjs'
import { makeFixtures } from './fixtures.mjs'
import { execute, validate } from './worker.mjs'
import { fileHashes, packageRoot, sha256, statistics } from './support.mjs'

const filename = fileURLToPath(import.meta.url)
const { values } = parseArgs({
  options: {
    baseline: { type: 'string' },
    output: { type: 'string' },
    samples: { type: 'string', default: '9' },
    worker: { type: 'string' },
    fixture: { type: 'string' },
    root: { type: 'string' },
  },
})

if (values.worker) {
  const fixture = JSON.parse(readFileSync(values.fixture, 'utf8'))
  const factory =
    values.worker === 'on'
      ? await loadIdentityAdapter(values.root)
      : await loadAdapter('singapore', { singapore: values.root })
  for (let warmup = 0; warmup < 2; warmup++) validate(factory, fixture, execute(factory, fixture))
  const result = execute(factory, fixture)
  validate(factory, fixture, result)
  process.stdout.write(
    JSON.stringify({
      elapsedMs: result.elapsedMs,
      retainedBytes: result.retainedBytes,
      structure: result.buffer.stats(),
      correctness: 'passed',
    }),
  )
} else {
  assert(
    values.baseline && values.output,
    'Supply --baseline <frozen dist directory> and --output <json>',
  )
  const samples = Number(values.samples)
  assert(Number.isSafeInteger(samples) && samples >= 3 && samples <= 99, 'samples must be 3–99')
  execFileSync(process.execPath, [path.join(packageRoot, 'scripts/build.mjs')], {
    cwd: packageRoot,
    stdio: 'inherit',
  })
  const current = path.join(packageRoot, 'dist')
  const baseline = path.resolve(values.baseline)
  const temporary = mkdtempSync(path.join(os.tmpdir(), 'textbuffer-identity-'))
  const names = new Set([
    'sequential-typing',
    'typing-with-lookups',
    'random-insertions',
    'random-replacements',
    'mixed-edit-churn',
    'persistent-history',
    'branch-edits',
  ])
  const fixtures = makeFixtures('standard', 20260916).filter((fixture) => names.has(fixture.name))
  const report = {
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    samples,
    warmups: 2,
    environment: {
      node: process.version,
      v8: process.versions.v8,
      cpu: os.cpus()[0]?.model,
      platform: process.platform,
      release: os.release(),
      flags: ['--expose-gc'],
    },
    identities: {
      baseline: fileHashes(baseline),
      current: fileHashes(current),
      harness: fileHashes(path.dirname(filename), (name) => name.endsWith('.mjs')),
    },
    method:
      'Fresh process per mode/sample. Rotating, reversed three-way pair order. Allocation and authoring ID conversion included for on. Setup and full validation outside timer.',
    workloads: [],
  }
  try {
    for (const [index, fixture] of fixtures.entries()) {
      const bytes = JSON.stringify(fixture)
      const fixturePath = path.join(temporary, `${fixture.name}.json`)
      writeFileSync(fixturePath, bytes)
      const raw = { before: [], off: [], on: [] }
      const orders = []
      for (let sample = 0; sample < samples; sample++) {
        const modes = ['before', 'off', 'on']
        const rotate = (sample + index) % 3
        const order = modes.slice(rotate).concat(modes.slice(0, rotate))
        if (sample % 2) order.reverse()
        orders.push(order)
        for (const mode of order) {
          const result = execFileSync(
            process.execPath,
            [
              '--expose-gc',
              filename,
              '--worker',
              mode,
              '--fixture',
              fixturePath,
              '--root',
              mode === 'before' ? baseline : current,
            ],
            { encoding: 'utf8' },
          )
          raw[mode].push(JSON.parse(result))
        }
      }
      const times = Object.fromEntries(
        Object.entries(raw).map(([mode, results]) => {
          const values = results.map((result) => result.elapsedMs)
          return [
            mode,
            { ...statistics(values), min: Math.min(...values), max: Math.max(...values) },
          ]
        }),
      )
      report.workloads.push({
        name: fixture.name,
        operations: fixture.operations.length,
        fixtureSha256: sha256(bytes),
        orders,
        timeMs: times,
        raw,
      })
      console.log(
        `${fixture.name}: before ${times.before.median.toFixed(3)} ms, off ${times.off.median.toFixed(3)} ms, on ${times.on.median.toFixed(3)} ms`,
      )
    }
    writeFileSync(values.output, JSON.stringify(report, null, 2) + '\n')
  } finally {
    rmSync(temporary, { recursive: true, force: true })
  }
}
