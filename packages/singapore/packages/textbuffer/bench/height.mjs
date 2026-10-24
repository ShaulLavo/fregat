import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import { applyOperation, loadAdapter } from './adapters.mjs'
import { applyOracle } from './fixtures.mjs'
import { fixtureHash, makeHeightFixtures, samplePoints } from './height-fixtures.mjs'
import { measureBuffer } from './tree-shape.mjs'
import { benchRoot, fileHashes, packageRoot, sha256, upstreamRoot } from './support.mjs'

export function unsignedList(value) {
  const values = value.split(',').map((part) => {
    assert(/^\d+$/.test(part), 'Seeds must be unsigned integers')
    const number = Number(part)
    assert(Number.isSafeInteger(number) && number <= 0xffffffff, 'Seed outside uint32 range')
    return number
  })
  assert.equal(new Set(values).size, values.length, 'Duplicate seeds')
  return values
}

export function runHeightTrace(buffer, fixture, every, onSample) {
  const points = samplePoints(fixture.operations.length, every)
  let expected = fixture.initial
  function sample(operation) {
    assert.equal(buffer.full(), expected, `${fixture.name} text at operation ${operation}`)
    onSample({ operation, textSha256: sha256(expected), trees: measureBuffer(buffer) })
  }
  sample(0)
  for (let index = 0; index < fixture.operations.length; index += 1) {
    const operation = fixture.operations[index]
    applyOperation(buffer, operation)
    expected = applyOracle(expected, operation)
    if (points.has(index + 1)) sample(index + 1)
  }
  assert.equal(expected, fixture.expected, `${fixture.name} fixture oracle`)
  assert.deepEqual(buffer.issues(), [], `${fixture.name} tree invariants`)
}

function git(args) {
  try {
    return execFileSync('git', args, {
      cwd: packageRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
  } catch {
    return null
  }
}

function positive(value, maximum) {
  assert(/^\d+$/.test(value), 'Expected a positive integer')
  const number = Number(value)
  assert(number > 0 && number <= maximum, `Expected integer <= ${maximum}`)
  return number
}

async function main() {
  const { values } = parseArgs({
    args: process.argv.slice(2).filter((arg) => arg !== '--'),
    options: {
      profile: { type: 'string', default: 'standard' },
      'trace-seeds': { type: 'string', default: '20260916,7' },
      every: { type: 'string', default: '250' },
      'stress-edits': { type: 'string' },
      engines: { type: 'string', default: 'singapore,vscode' },
      workloads: { type: 'string' },
      out: { type: 'string' },
      help: { type: 'boolean', default: false },
    },
  })
  if (values.help) {
    console.log('node bench/height.mjs [--profile smoke|standard] [--stress-edits 5000]')
    console.log('  [--trace-seeds 20260916,7] [--every 250]')
    console.log(
      '  [--engines singapore,vscode] [--workloads prepend,hotspot-churn] [--out directory]',
    )
    return
  }
  assert(['smoke', 'standard'].includes(values.profile), 'Unknown profile')
  const traceSeeds = unsignedList(values['trace-seeds'])
  const every = positive(values.every, 1000000)
  const stressEdits = positive(
    values['stress-edits'] ?? (values.profile === 'smoke' ? '64' : '5000'),
    1000000,
  )
  const engines = values.engines.split(',')
  assert(engines.length && new Set(engines).size === engines.length, 'Invalid engines')
  assert(
    engines.every((engine) => ['singapore', 'vscode'].includes(engine)),
    'Unknown engine',
  )
  const selected = values.workloads?.split(',')
  const fixtures = traceSeeds.flatMap((seed) => {
    const all = makeHeightFixtures(values.profile, seed, stressEdits)
    if (selected)
      for (const name of selected)
        assert(
          all.some((item) => item.name === name),
          `Unknown workload: ${name}`,
        )
    return all
      .filter((fixture) => !selected || selected.includes(fixture.name))
      .map((fixture) => ({ seed, fixture }))
  })
  // Validate options before downloading the pinned control or creating output.
  let upstream = null
  if (engines.includes('vscode')) {
    const { prepare } = await import('./prepare.mjs')
    upstream = await prepare()
  }
  const directory = path.resolve(
    values.out ?? path.join(benchRoot, 'results', `height-${values.profile}`),
  )
  mkdirSync(directory, { recursive: true })
  const adapters = {}
  for (const engine of engines) adapters[engine] = await loadAdapter(engine)
  const api = engines.includes('singapore') ? await import('@singapore-editor/textbuffer') : null
  const result = {
    schemaVersion: 1,
    kind: 'tree-height',
    complete: false,
    createdAt: new Date().toISOString(),
    sourceCommit: git(['rev-parse', 'HEAD']),
    workingTree: git(['status', '--porcelain']),
    runtime: {
      node: process.version,
      v8: process.versions.v8,
      platform: process.platform,
      arch: process.arch,
    },
    config: {
      profile: values.profile,
      traceSeeds,
      every,
      stressEdits,
      engines,
      workloads: selected ?? null,
    },
    definitions: {
      height: 'Number of non-NIL levels; empty=0, root-only=1.',
      depth: 'Root depth=0. Mean/p95 are over stored pieces; tombstones are included.',
      heightOverLog2: 'height / log2(pieces + 1), null for an empty tree.',
      minimumHeight: 'ceil(log2(pieces + 1)); counting lower bound for a binary tree.',
      sampling:
        'Initial, final, powers of two, and every configured interval. Peaks between samples may be missed.',
      timing: 'Separate structural replay; no latency or allocation measurements.',
    },
    provenance: {
      sourceSha256: fileHashes(path.join(packageRoot, 'src'), (name) => !name.endsWith('.test.ts')),
      buildSha256: fileHashes(path.join(packageRoot, 'dist')),
      harnessSha256: fileHashes(benchRoot, (name) => /\.(mjs|json|py)$/.test(name)),
      upstream,
    },
    fixtures: fixtures.map(({ seed, fixture }) => ({
      traceSeed: seed,
      name: fixture.name,
      operations: fixture.operations.length,
      sha256: fixtureHash(fixture),
    })),
    rows: [],
    failures: [],
    completedRuns: [],
  }
  writeFileSync(path.join(directory, 'fixtures.json'), JSON.stringify(fixtures) + '\n')
  const save = () =>
    writeFileSync(path.join(directory, 'height.json'), JSON.stringify(result, null, 2) + '\n')
  for (const { seed, fixture } of fixtures) {
    for (const engine of engines) {
      {
        const run = { workload: fixture.name, traceSeed: seed, engine }
        let lastCheckpoint = null
        try {
          const buffer =
            engine === 'singapore'
              ? adapters[engine].restore(api.createPieceTableSnapshot(fixture.initial))
              : adapters[engine].create(fixture.initial)
          runHeightTrace(buffer, fixture, every, (sample) => {
            lastCheckpoint = sample.operation
            for (const [tree, metrics] of Object.entries(sample.trees)) {
              result.rows.push({
                ...run,
                operation: sample.operation,
                tree,
                textSha256: sample.textSha256,
                ...metrics,
              })
            }
          })
          result.completedRuns.push(run)
          console.log(`${engine} / ${fixture.name} / trace ${seed}: passed`)
        } catch (error) {
          result.failures.push({ ...run, lastCheckpoint, message: String(error.stack ?? error) })
          console.error(`${engine} / ${fixture.name}: ${error.message}`)
        }
        save()
      }
    }
  }
  if (upstream) {
    // Catch accidental mutation of the control build while the diagnostic ran.
    assert.deepEqual(fileHashes(path.join(upstreamRoot, 'dist')), upstream.outputSha256)
    assert.deepEqual(
      JSON.parse(readFileSync(path.join(upstreamRoot, 'build.json'), 'utf8')),
      upstream,
    )
  }
  result.complete = true
  result.completedAt = new Date().toISOString()
  save()
  console.log(
    `${result.rows.length} tree samples; ${result.failures.length} failures; ${directory}`,
  )
  if (result.failures.length) process.exitCode = 1
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await main()
}
