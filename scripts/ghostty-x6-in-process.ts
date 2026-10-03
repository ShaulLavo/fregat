import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { instrumentSource, type SourceSite } from './ghostty-x6-source-ledger.ts'

interface CountRow {
  readonly operation: string
  readonly inert: number
  readonly counts: Record<string, number>
  readonly setupCalls: number
  readonly contributionFactories: number
  readonly freshIdentities?: number
  readonly inputCalls?: number
  readonly frameCalls?: number
  readonly payloadCalls?: number
  readonly cleanupCalls?: number
  readonly otherInstalledInert?: number
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const packageRoot = join(root, 'ghostty-webgpu')
const output = resolve(process.argv[2]!)
const command = process.argv[3] ?? 'counters'
if (command === 'freeze' || command === 'run') {
  assert(process.argv[4] && process.argv[5])
  const window = fileURLToPath(new URL('./ghostty-x6-window.ts', import.meta.url))
  const result = spawnSync(
    'bun',
    [window, command, process.argv[2]!, process.argv[4], process.argv[5]],
    { stdio: 'inherit' },
  )
  process.exit(result.status ?? 1)
}
assert(command === 'counters' || command === 'build')
await mkdir(output)
const sites: SourceSite[] = []
const sourceHashes: Record<string, string> = {}
const hash = (source: string | Buffer) => createHash('sha256').update(source).digest('hex')
const entry = fileURLToPath(
  new URL('../ghostty-webgpu/bench/extension-process-entry.ts', import.meta.url),
)
for (const mode of ['instrumented', 'uninstrumented']) {
  const directory = join(output, mode)
  await mkdir(directory)
  const build = await Bun.build({
    entrypoints: [entry],
    target: 'node',
    format: 'esm',
    minify: false,
    sourcemap: 'external',
    outdir: directory,
    naming: 'entry.mjs',
    plugins:
      mode === 'instrumented'
        ? [
            {
              name: 'exact-source-ledger',
              setup(builder) {
                builder.onLoad(
                  { filter: /\/ghostty-webgpu\/src\/(?:core|dom|term|extensions)\/.*\.ts$/ },
                  async ({ path }) => {
                    const source = await readFile(path, 'utf8')
                    const file = relative(packageRoot, path)
                    sourceHashes[file] = hash(source)
                    const instrumented = instrumentSource(file, source)
                    sites.push(...instrumented.sites)
                    const preserved = join(directory, 'source-inputs', file)
                    await mkdir(dirname(preserved), { recursive: true })
                    await writeFile(preserved, source)
                    return { contents: instrumented.source, loader: 'ts' }
                  },
                )
              },
            },
          ]
        : [],
  })
  await writeFile(
    join(directory, 'build.json'),
    JSON.stringify({ success: build.success, logs: build.logs.map(String) }, null, 2),
  )
  assert(build.success, build.logs.map(String).join('\n'))
  for (const name of ['ghostty-vt.wasm', 'bridge.wasm'])
    await copyFile(join(packageRoot, name), join(directory, name))
}
assert.equal(new Set(sites.map((site) => site.id)).size, sites.length)
await writeFile(join(output, 'sites.json'), JSON.stringify(sites, null, 2))
const artifacts: Record<string, string> = {}
for (const mode of ['instrumented', 'uninstrumented']) {
  for (const name of ['entry.mjs', 'entry.mjs.map', 'ghostty-vt.wasm', 'bridge.wasm'])
    artifacts[`${mode}/${name}`] = hash(await readFile(join(output, mode, name)))
}
const git = (...args: string[]) => {
  const result = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8' })
  assert.equal(result.status, 0)
  return result.stdout.trim()
}
await writeFile(
  join(output, 'manifest.json'),
  JSON.stringify(
    {
      label: 'X6 in-process timing',
      sourceHead: git('rev-parse', 'HEAD'),
      sourceStatus: git('status', '--porcelain'),
      actualBase: 'c0dc2aca7c3e69287c25930c07e00069e4f7822d',
      sourceHashes,
      artifacts,
      sourceSites: sites.length,
      environment: { browser: 'N/A', headless: 'N/A', argv: process.argv, bun: Bun.version },
      scope:
        'Direct internal manager/native work. Source expression and call/whole-optional-chain evaluation counts; no realized VM/native allocations or implicit iterator counts. Driver factories are separate from framework sites. Timing bundle is original uninstrumented source.',
      pending: [
        'public use/dispose',
        'public creation N',
        'public original-input interception',
        'public write/frame extension route',
        'custom OSC native/public',
      ],
      timingWindow: 'Not registered or run by this build/counter command.',
    },
    null,
    2,
  ),
)

if (command === 'counters') {
  runNode(join(output, 'instrumented'), 'counters')
  runNode(join(output, 'uninstrumented'), 'smoke')
  const result = JSON.parse(await readFile(join(output, 'instrumented/counters.json'), 'utf8')) as {
    rows: CountRow[]
  }
  await writeFile(
    join(output, 'counter-verification.json'),
    JSON.stringify(verifyCounters(result.rows), null, 2),
  )
}

function runNode(directory: string, mode: string): void {
  const result = spawnSync('node', [join(directory, 'entry.mjs'), directory, mode], {
    stdio: 'inherit',
  })
  assert.equal(result.status, 0)
}

function verifyCounters(rows: readonly CountRow[]) {
  const creation = rows.filter((row) => row.operation === 'internal-host-manager-create')
  assert.equal(creation.length, 4)
  for (const row of creation) {
    assert.equal(row.setupCalls, row.inert)
    assert.equal(row.contributionFactories, row.inert)
    assert.equal(row.freshIdentities, row.inert)
  }
  const byCount = new Map(creation.map((row) => [row.inert, row.counts]))
  const creationKeys = new Set(creation.flatMap((row) => Object.keys(row.counts)))
  const affine: Record<string, { core: number; fixedActivation: number; perAttachment: number }> =
    {}
  for (const site of creationKeys) {
    const core = byCount.get(0)?.[site] ?? 0
    const one = byCount.get(1)?.[site] ?? 0
    const hundred = byCount.get(100)?.[site] ?? 0
    const thousand = byCount.get(1_000)?.[site] ?? 0
    const perAttachment = (hundred - one) / 99
    assert(Number.isInteger(perAttachment), site)
    assert.equal(thousand - one, 999 * perAttachment, site)
    affine[site] = { core, fixedActivation: one - core - perAttachment, perAttachment }
  }
  const operations = [...new Set(rows.map((row) => row.operation))].filter(
    (operation) =>
      operation !== 'internal-host-manager-create' &&
      operation !== 'cold-internal-first-use' &&
      operation !== 'positive-dispatch',
  )
  for (const operation of operations) {
    const selected = rows.filter((row) => row.operation === operation)
    assert.equal(selected.length, 3, operation)
    for (const row of selected) assert.deepEqual(row.counts, selected[0]!.counts, operation)
  }
  for (const row of rows.filter((row) => row.operation === 'manager-dispose')) {
    assert.equal(row.otherInstalledInert, row.inert)
    assert.equal(row.setupCalls, 0)
  }
  for (const row of rows.filter((row) => row.operation === 'positive-dispose'))
    assert.equal(row.cleanupCalls, 1)
  for (const row of rows.filter((row) => row.operation === 'positive-dispatch')) {
    assert.equal(row.inputCalls, 4)
    assert.equal(row.frameCalls, 1)
    assert.equal(row.payloadCalls, 1)
    assert(Object.keys(row.counts).length > 0)
  }
  return {
    passed: true,
    operations,
    affine,
    coldFirstUse: rows.filter((row) => row.operation === 'cold-internal-first-use'),
  }
}
