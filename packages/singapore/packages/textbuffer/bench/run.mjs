import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import { createRequire } from 'node:module'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import ts from 'typescript-api'
import { comparisonEngines, retentions } from './adapters.mjs'
import { makeFixtures, profiles } from './fixtures.mjs'
import { prepare } from './prepare.mjs'
import { benchRoot, consume, fileHashes, packageRoot, sha256, statistics } from './support.mjs'

export function optionsFrom(args) {
  const options = { profile: 'standard', seed: 20260916, retention: 'always' }
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index].replace(/^--/, '')
    if (!['profile', 'samples', 'warmups', 'seed', 'output', 'only', 'retention'].includes(key))
      throw new Error(`Unknown option ${args[index]}`)
    const value = args[index + 1]
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${args[index]}`)
    options[key] = ['samples', 'warmups', 'seed'].includes(key) ? Number(value) : value
  }
  const profile = profiles[options.profile]
  if (!profile) throw new Error(`Unknown profile ${options.profile}`)
  options.samples ??= profile.samples
  options.warmups ??= profile.warmups
  if (!retentions.includes(options.retention)) throw new Error('Invalid retention')
  for (const [key, low, high] of [
    ['samples', 1, 99],
    ['warmups', 0, 20],
    ['seed', 0, 0xffffffff],
  ]) {
    if (!Number.isSafeInteger(options[key]) || options[key] < low || options[key] > high)
      throw new Error(`Invalid ${key}`)
  }
  return options
}

function git(args) {
  try {
    return execFileSync('git', ['-C', packageRoot].concat(args), {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
  } catch {
    return null
  }
}

function sourceIdentity() {
  return {
    source: fileHashes(path.join(packageRoot, 'src'), (name) => !name.endsWith('.test.ts')),
    build: fileHashes(path.join(packageRoot, 'dist')),
    harness: fileHashes(benchRoot, (name) => /\.(mjs|json)$/.test(name)),
  }
}

export function engineOrder(sample, workloadIndex = 0) {
  const index = sample + workloadIndex
  const start = index % comparisonEngines.length
  const order = comparisonEngines.slice(start).concat(comparisonEngines.slice(0, start))
  return Math.floor(sample / comparisonEngines.length) % 2 ? order.reverse() : order
}

export function markdown(report) {
  const lines = [
    '# Textbuffer comparison',
    '',
    `Profile: ${report.options.profile}, retention ${report.options.retention}. Node ${report.environment.node}, V8 ${report.environment.v8}.`,
    `Source commit: ${report.source.commit ?? 'unavailable (see source hashes)'}.`,
    `Microsoft standalone revision: ${report.upstream.commit}.`,
    `CodeMirror @codemirror/state: ${report.codemirror.version}.`,
    `Measured: ${report.createdAt}. CPU: ${report.environment.cpu}. OS: ${report.environment.platform} ${report.environment.release} ${report.environment.arch}.`,
    `Samples: ${report.options.samples}; fresh-buffer warmups per sample: ${report.options.warmups}; seed: ${report.options.seed}.`,
    '',
    '**Ratios are Singapore / each control: below 1 is faster. No overall score.**',
    'Times are milliseconds for the entire workload, not individual-operation p95 latency.',
    '',
    '| Workload | Logical ops | Singapore median / p95 ms | VS Code median / p95 ms | CodeMirror median / p95 ms | S / VS Code | S / CodeMirror |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: |',
  ]
  const format = (value) =>
    value ? `${value.median.toFixed(3)} / ${value.p95.toFixed(3)}` : 'not equivalent'
  for (const row of report.workloads) {
    lines.push(
      `| ${row.name} | ${row.operations} | ${format(row.engines.singapore?.timeMs)} | ${format(row.engines.vscode?.timeMs)} | ${format(row.engines.codemirror?.timeMs)} | ${row.ratio === null ? 'separate lane' : row.ratio.toFixed(2) + 'x'} | ${row.codemirrorRatio === null ? 'separate lane' : row.codemirrorRatio.toFixed(2) + 'x'} |`,
    )
  }
  lines.push(
    '',
    '## Post-GC retained memory',
    '',
    'Median deltas in bytes relative to the warmed process before creating the measured buffer.',
    'Includes the active state, caches and retained versions. Not total allocations or peak memory.',
    '`arrayBuffers` is included in `external`; do not add them together. Negative deltas indicate measurement noise.',
    '',
    '| Workload | Engine | Heap | External | Array buffers |',
    '| --- | --- | ---: | ---: | ---: |',
  )
  for (const row of report.workloads)
    for (const [engine, data] of Object.entries(row.engines)) {
      lines.push(
        `| ${row.name} | ${engine} | ${Math.round(data.retainedBytes.heapUsed.median)} | ${Math.round(data.retainedBytes.external.median)} | ${Math.round(data.retainedBytes.arrayBuffers.median)} |`,
      )
    }
  lines.push(
    '',
    '## Interpretation',
    '',
    '- This is a Node text-buffer microbenchmark, not browser input-to-paint or a claim about current full VS Code, Monaco or CodeMirror editors.',
    '- LF-normalized input, UTF-16 offsets, code-point-safe edit boundaries, no editor diagnostics.',
    '- CodeMirror loads through Text.of, single edits through Text.replace, and batches through ChangeSet.of(...).apply(doc). Splitting inserted strings and constructing changes are timed. Reads use sliceString, line and lineAt.',
    '- Range reads include two offset-to-position conversions on the VS Code adapter; Singapore line reads include line-boundary lookup. These are API-level costs, not equal primitive counts.',
    '- Each sample is a fresh process. Warmups use fresh buffers. Engine order rotates and reverses across samples and workloads. Fixture generation, setup edits, validation, forced GC and process startup are outside the timer.',
    '- Normal GC during operations remains inside the measured time. Read-result sampling is included; exact read validation is outside it.',
    '- Persistent history and anchor resolution are Singapore-only capabilities, with no fabricated control equivalence. CodeMirror persistence is outside these Singapore-specific history and anchor lanes.',
    '- Raw samples, fixture hashes, source/build hashes, toolchain and machine metadata are in the adjacent JSON.',
    report.options.profile === 'smoke'
      ? '- Smoke results validate the harness only; do not use these tiny samples to rank engines.'
      : '- Synthetic workload results on one machine require repetition across seeds, machines and browser engines.',
    '',
  )
  return lines.join('\n')
}

async function main() {
  const options = optionsFrom(process.argv.slice(2))
  // Even direct invocation rebuilds; a stale dist must never masquerade as current source.
  execFileSync(process.execPath, [path.join(packageRoot, 'scripts/build.mjs')], {
    cwd: packageRoot,
    stdio: 'inherit',
  })
  const upstream = await prepare()
  const codemirrorRoot = path.dirname(
    path.dirname(createRequire(import.meta.url).resolve('@codemirror/state')),
  )
  const codemirror = {
    version: JSON.parse(readFileSync(path.join(codemirrorRoot, 'package.json'), 'utf8')).version,
    identity: fileHashes(
      codemirrorRoot,
      (name) => path.basename(name) === 'package.json' || name.endsWith('.js'),
    ),
  }
  const identity = sourceIdentity()
  let fixtures = makeFixtures(options.profile, options.seed)
  if (options.only) {
    const names = options.only.split(',')
    for (const name of names)
      assert(
        fixtures.some((fixture) => fixture.name === name),
        `Unknown workload ${name}`,
      )
    fixtures = fixtures.filter((fixture) => names.includes(fixture.name))
  }
  const cache = path.join(benchRoot, '.cache')
  mkdirSync(cache, { recursive: true })
  const temporary = mkdtempSync(path.join(cache, 'traces-'))
  const report = {
    schemaVersion: 2,
    createdAt: new Date().toISOString(),
    options,
    environment: {
      node: process.version,
      v8: process.versions.v8,
      typescript: ts.version,
      platform: process.platform,
      arch: process.arch,
      release: os.release(),
      cpu: os.cpus()[0]?.model ?? 'unknown',
      logicalCpus: os.cpus().length,
      totalMemory: os.totalmem(),
      workerFlags: ['--expose-gc'],
    },
    source: {
      commit: git(['rev-parse', 'HEAD']),
      dirty: git(['status', '--porcelain', '--', '.']),
      identity,
    },
    upstream,
    codemirror,
    workloads: [],
  }
  try {
    for (const [workloadIndex, fixture] of fixtures.entries()) {
      const encoded = JSON.stringify(fixture)
      const hash = sha256(encoded)
      const filename = path.join(temporary, fixture.name + '.json')
      writeFileSync(filename, encoded)
      const samples = Object.fromEntries(comparisonEngines.map((engine) => [engine, []]))
      for (let sample = 0; sample < options.samples; sample += 1) {
        let engines = engineOrder(sample, workloadIndex)
        if (fixture.category === 'singapore-only') engines = ['singapore']
        for (const engine of engines) {
          const output = execFileSync(
            process.execPath,
            [
              '--expose-gc',
              path.join(benchRoot, 'worker.mjs'),
              engine,
              filename,
              hash,
              String(options.warmups),
              options.retention,
            ],
            {
              cwd: packageRoot,
              encoding: 'utf8',
              timeout: 120000,
              maxBuffer: 8 * 1024 * 1024,
            },
          )
          const result = JSON.parse(output)
          assert.equal(result.correctness, 'passed')
          assert.equal(result.fixtureSha256, hash)
          assert(Number.isFinite(result.elapsedMs) && result.elapsedMs >= 0)
          samples[engine].push(Object.assign({ sample, order: engines.indexOf(engine) }, result))
        }
      }
      const engines = {}
      for (const [name, values] of Object.entries(samples))
        if (values.length) {
          engines[name] = {
            timeMs: statistics(values.map((value) => value.elapsedMs)),
            retainedBytes: Object.fromEntries(
              ['heapUsed', 'external', 'arrayBuffers', 'rss'].map((key) => [
                key,
                statistics(values.map((value) => value.retainedBytes[key])),
              ]),
            ),
            samples: values,
          }
        }
      for (const values of Object.values(samples))
        for (const value of values)
          assert.equal(samples.singapore[0].checksum, value.checksum, 'shared result checksum')
      const row = {
        name: fixture.name,
        category: fixture.category,
        fixtureSha256: hash,
        inputCodeUnits: fixture.initial.length,
        inputUtf8Bytes: Buffer.byteLength(fixture.initial),
        operations: fixture.operations.length || 1,
        setupOperations: fixture.setup.length,
        primitiveEdits: fixture.operations.reduce(
          (total, operation) =>
            total +
            (operation.kind === 'batch'
              ? operation.edits.length
              : operation.kind === 'edit'
                ? 1
                : 0),
          0,
        ),
        engines,
        ratio: engines.vscode
          ? engines.singapore.timeMs.median / engines.vscode.timeMs.median
          : null,
        codemirrorRatio: engines.codemirror
          ? engines.singapore.timeMs.median / engines.codemirror.timeMs.median
          : null,
      }
      report.workloads.push(row)
      console.log(
        `${row.name}: Singapore ${engines.singapore.timeMs.median.toFixed(3)} ms${engines.vscode ? `; VS Code ${engines.vscode.timeMs.median.toFixed(3)} ms; S / VS Code ${row.ratio.toFixed(2)}x; CodeMirror ${engines.codemirror.timeMs.median.toFixed(3)} ms; S / CodeMirror ${row.codemirrorRatio.toFixed(2)}x` : '; separate capability lane'}`,
      )
    }
    assert.deepEqual(sourceIdentity(), identity, 'Source or build changed during benchmark')
    // Keep the consumer visible even if all selected workloads are edits.
    report.checksum = report.workloads.reduce(
      (sum, row) => consume(row.engines.singapore.samples[0].checksum, sum),
      2166136261,
    )
    const output = path.resolve(
      options.output ?? path.join(benchRoot, 'results', options.profile + '.json'),
    )
    mkdirSync(path.dirname(output), { recursive: true })
    writeFileSync(output, JSON.stringify(report, null, 2) + '\n')
    writeFileSync(output.replace(/\.json$/, '') + '.md', markdown(report))
    console.log(`Results: ${output}`)
  } finally {
    rmSync(temporary, { recursive: true, force: true })
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href)
  await main()
