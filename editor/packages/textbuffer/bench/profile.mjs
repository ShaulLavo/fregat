import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'
import { retentions } from './adapters.mjs'
import { makeFixtures, profiles } from './fixtures.mjs'
import { prepare } from './prepare.mjs'
import { prepareProbes } from './probes.mjs'
import { isStructuralCounter } from './profile-support.mjs'
import { benchRoot, packageRoot, fileHashes, sha256 } from './support.mjs'

export function profileOptions(args) {
  const options = {
    profile: 'standard',
    seed: 20260916,
    repeats: 12,
    modes: 'counters,cpu,heap,gc',
    retention: 'always',
  }
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index].replace(/^--/, '')
    assert(
      ['profile', 'seed', 'repeats', 'only', 'output', 'modes', 'retention'].includes(name),
      `Unknown option ${name}`,
    )
    const value = args[index + 1]
    assert(value && !value.startsWith('--'), `Missing ${name}`)
    options[name] = ['seed', 'repeats'].includes(name) ? Number(value) : value
  }
  assert(profiles[options.profile], 'Unknown profile')
  assert(
    Number.isSafeInteger(options.seed) && options.seed >= 0 && options.seed <= 0xffffffff,
    'Invalid seed',
  )
  assert(
    Number.isSafeInteger(options.repeats) && options.repeats > 0 && options.repeats <= 100,
    'Invalid repeats',
  )
  assert(retentions.includes(options.retention), 'Invalid retention')
  options.modes = options.modes.split(',')
  assert(
    options.modes.length && new Set(options.modes).size === options.modes.length,
    'Duplicate modes',
  )
  for (const mode of options.modes)
    assert(['cpu', 'heap', 'gc', 'counters'].includes(mode), `Unknown mode ${mode}`)
  return options
}

function identity() {
  return {
    source: fileHashes(path.join(packageRoot, 'src'), (file) => !file.endsWith('.test.ts')),
    build: fileHashes(path.join(packageRoot, 'dist')),
    harness: fileHashes(benchRoot, (file) => /\.(mjs|json)$/.test(file)),
  }
}

export function profileMarkdown(report) {
  const lines = [
    '# Textbuffer diagnostic attribution',
    '',
    `Node ${report.environment.node}; V8 ${report.environment.v8}; ${report.environment.cpu}.`,
    `Fixture profile ${report.options.profile}, seed ${report.options.seed}, retention ${report.options.retention}; upstream ${report.upstream.commit}.`,
    '',
    '**Diagnostic runs are not benchmark scores. CPU, sampled allocations, GC, and counters run in separate processes.**',
    'Setup, warmup, correctness checks and forced collections are outside each diagnostic window.',
    'CPU percentages below use only samples with runOperations on the stack. GC and profiler frames without that stack are excluded; GC has its own clean-build pass.',
    'Heap bytes estimate JS-heap allocations (including collected objects), not exact or retained bytes; typed-array backing stores and native memory are excluded. Inclusive rows overlap; exclusive categories do not.',
    '',
  ]
  for (const row of report.workloads) {
    lines.push(`## ${row.name}`, '', `${row.operations} logical operations per replay.`, '')
    for (const [engine, modes] of Object.entries(row.engines)) {
      lines.push(`### ${engine}`, '')
      if (modes.cpu) {
        const cpu = modes.cpu.cpu
        lines.push(
          `CPU: ${cpu.samples} in-workload samples; ${cpu.ignoredSamples} excluded. ${cpu.warning ?? ''}`,
          '',
        )
        lines.push('| Exclusive CPU category | Samples | Share |', '| --- | ---: | ---: |')
        for (const item of cpu.categories)
          lines.push(
            `| ${item.name} | ${item.value} | ${((100 * item.value) / (cpu.samples || 1)).toFixed(1)}% |`,
          )
        lines.push('', 'Inclusive hot stacks (not additive):', '')
        for (const item of cpu.inclusive
          .filter((item) => !item.name.includes('/bench/'))
          .slice(0, 6))
          lines.push(
            `- \`${item.name}\`: ${((100 * item.value) / (cpu.samples || 1)).toFixed(1)}% of in-workload samples.`,
          )
        lines.push('')
      }
      if (modes.heap) {
        const heap = modes.heap.heap
        lines.push(
          `Sampled JS-heap allocation estimate: ${Math.round(heap.sampledBytes / modes.heap.repeats).toLocaleString('en-US')} bytes/replay.`,
          '',
        )
        for (const item of heap.self.slice(0, 5))
          lines.push(
            `- \`${item.name}\`: ${Math.round(item.value / modes.heap.repeats).toLocaleString('en-US')} estimated bytes/replay.`,
          )
        lines.push('')
      }
      if (modes.gc)
        lines.push(
          `GC-only pass: ${modes.gc.gc.events} events across ${modes.gc.repeats} replays; median observed GC duration ${modes.gc.gc.durationMs.median.toFixed(3)} ms/replay.`,
          '',
        )
      if (modes.counters) {
        const epoch = modes.counters.epochs[0]
        lines.push(
          `Structure after workload: ${JSON.stringify(epoch.structure)}.`,
          '',
          '| Work counter (first replay) | Count | Per logical operation |',
          '| --- | ---: | ---: |',
        )
        for (const [name, value] of Object.entries(epoch.counters).filter(([name]) =>
          isStructuralCounter(name),
        ))
          lines.push(`| ${name} | ${value} | ${(value / row.operations).toFixed(2)} |`)
        if (epoch.warmQueryCounters)
          lines.push(
            '',
            'A second same-buffer query pass is recorded separately in JSON to expose cache warming.',
          )
        lines.push('')
      }
    }
  }
  lines.push(
    '## Limits',
    '',
    'Function/loop counters are exact executed events in the instrumented copy, not time attribution. Recursion and nested loop counts are explicitly not unique-node counts.',
    'Copied array slots count logical page/tail elements, not physical bytes allocated by V8. Native string searches are not instrumented per character.',
    'Compare these signals with separate clean timing runs. A busy function is an optimization lead, not proof that disabling persistence or tombstones is valid.',
    'Raw .cpuprofile and .heapprofile files can be loaded in Chromium DevTools. Per-replay GC events, all counters, cold/warm query counts and hashes are in JSON.',
    '',
  )
  return lines.join('\n')
}

export async function main(args = process.argv.slice(2)) {
  const options = profileOptions(args)
  execFileSync(process.execPath, [path.join(packageRoot, 'scripts/build.mjs')], {
    cwd: packageRoot,
    stdio: 'inherit',
  })
  const upstream = await prepare()
  const before = identity()
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
  const resultsRoot = path.join(benchRoot, 'results')
  mkdirSync(resultsRoot, { recursive: true })
  const output = options.output
    ? path.resolve(packageRoot, options.output)
    : mkdtempSync(path.join(resultsRoot, `profile-${options.profile}-${options.seed}-`))
  assert(output.startsWith(resultsRoot + path.sep), 'Profile output must be inside bench/results/')
  if (options.output)
    assert(
      !existsSync(output),
      'Use a new output directory; stale traces must not mix with a new run',
    )
  mkdirSync(output, { recursive: true })
  const temporary = mkdtempSync(path.join(benchRoot, '.cache', 'probes-'))
  const probes = prepareProbes(temporary)
  writeFileSync(
    path.join(output, 'probe-manifest.json'),
    JSON.stringify(probes.manifests, null, 2) + '\n',
  )
  const rootsFile = path.join(temporary, 'roots.json')
  writeFileSync(rootsFile, JSON.stringify(probes.roots))
  let commit = null
  try {
    commit = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: packageRoot,
      encoding: 'utf8',
    }).trim()
  } catch {
    /* Source hashes remain authoritative in exported copies. */
  }
  const report = {
    schemaVersion: 1,
    status: 'running',
    options,
    diagnosticOnly: true,
    commit,
    identity: before,
    upstream,
    environment: {
      node: process.version,
      v8: process.versions.v8,
      compiler: ts.version,
      platform: process.platform,
      arch: process.arch,
      cpu: os.cpus()[0]?.model,
    },
    workloads: [],
  }
  try {
    for (let index = 0; index < fixtures.length; index += 1) {
      const fixture = fixtures[index]
      const serialized = JSON.stringify(fixture)
      const hash = sha256(serialized)
      const filename = path.join(temporary, fixture.name + '.json')
      writeFileSync(filename, serialized)
      const row = {
        name: fixture.name,
        operations: Math.max(1, fixture.operations.length),
        fixtureSha256: hash,
        engines: {},
      }
      const engines =
        fixture.category === 'singapore-only'
          ? ['singapore']
          : index % 2
            ? ['vscode', 'singapore']
            : ['singapore', 'vscode']
      for (const engine of engines) {
        row.engines[engine] = {}
        for (const mode of options.modes) {
          const repeats = mode === 'counters' ? 1 : options.repeats
          const destination = path.join(output, fixture.name, engine, mode)
          const json = execFileSync(
            process.execPath,
            [
              '--expose-gc',
              path.join(benchRoot, 'profile-worker.mjs'),
              engine,
              filename,
              hash,
              mode,
              String(repeats),
              destination,
              rootsFile,
              String(profiles[options.profile].warmups),
              options.retention,
            ],
            { cwd: packageRoot, encoding: 'utf8', timeout: 120000, maxBuffer: 32 * 1024 * 1024 },
          )
          const result = JSON.parse(json)
          assert.equal(result.fixtureSha256, hash)
          assert(result.epochs.every((epoch) => epoch.correctness === 'passed'))
          row.engines[engine][mode] = result
          console.log(`${fixture.name} / ${engine} / ${mode}: validated ${repeats} replay(s)`)
        }
      }
      report.workloads.push(row)
      writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n')
    }
    assert.deepEqual(identity(), before, 'Profiling changed production source/build or harness')
    report.status = 'complete'
    writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n')
    writeFileSync(path.join(output, 'report.md'), profileMarkdown(report))
  } finally {
    rmSync(temporary, { recursive: true, force: true })
  }
  console.log(`Diagnostic report: ${path.join(output, 'report.md')}`)
  return report
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href)
  await main()
