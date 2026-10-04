import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { hash as digest } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { instrumentSource, type SourceSite } from './ghostty-x6-source-ledger.ts'
import { verifyPublicCounters, type CountRow } from './ghostty-x6-public-counters.ts'

const publicProductBase = 'f1c4a69a2f61356cfcf25252aa40ae8e732139c6'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const packageRoot = join(root, 'ghostty-webgpu')
const [outputArgument, fontArgument, command = 'counters'] = process.argv.slice(2)
assert(outputArgument && fontArgument)
assert(command === 'build' || command === 'counters' || command === 'diagnostic')
const output = resolve(outputArgument)
const git = (...args: string[]) => {
  const result = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
  return result.stdout.trim()
}
assert.equal(git('merge-base', publicProductBase, 'HEAD'), publicProductBase)
await mkdir(output)
await copyFile(resolve(fontArgument), join(output, 'fixture-font.ttf'))
const sites: SourceSite[] = []
const sourceHashes: Record<string, string> = {}
const measuredModules: string[] = []
const entry = fileURLToPath(
  new URL('../ghostty-webgpu/bench/extension-public-process-entry.ts', import.meta.url),
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
    plugins: [
      {
        name: 'owned-source-custody',
        setup(builder) {
          builder.onLoad({ filter: /\/ghostty-webgpu\/src\/.*\.ts$/ }, async ({ path }) => {
            const source = await readFile(path, 'utf8')
            const file = relative(packageRoot, path)
            const original = spawnSync('git', [
              '-C',
              root,
              'show',
              `${publicProductBase}:ghostty-webgpu/${file}`,
            ])
            assert.equal(original.status, 0)
            assert.equal(
              digest('sha256', source, 'hex'),
              digest('sha256', original.stdout, 'hex'),
              `Exact released source ${file}`,
            )
            sourceHashes[file] = digest('sha256', source, 'hex')
            const preserved = join(directory, 'source-inputs', file)
            await mkdir(dirname(preserved), { recursive: true })
            await writeFile(preserved, source)
            if (mode !== 'instrumented' || !/^src\/(?:core|dom|term|extensions)\//.test(file))
              return { contents: source, loader: 'ts' }
            measuredModules.push(file)
            const transformed = instrumentSource(file, source)
            sites.push(...transformed.sites)
            return { contents: transformed.source, loader: 'ts' }
          })
        },
      },
    ],
  })
  await writeFile(
    join(directory, 'build.json'),
    JSON.stringify({ success: build.success, logs: build.logs.map(String) }, null, 2),
  )
  assert(build.success, build.logs.map(String).join('\n'))
  for (const file of ['ghostty-vt.wasm', 'bridge.wasm'])
    await copyFile(join(packageRoot, file), join(directory, file))
}
const provenance = JSON.parse(
  await readFile(join(packageRoot, 'ghostty-vt.provenance.json'), 'utf8'),
) as {
  source: { patched: boolean; revision: string }
  recipe: { inputs: Record<string, string> }
  artifacts: Record<string, { sha256: string }>
}
assert.equal(provenance.source.patched, false)
for (const [file, expected] of Object.entries(provenance.recipe.inputs))
  assert.equal(
    digest('sha256', await readFile(join(packageRoot, file)), 'hex'),
    expected,
    `Official recipe ${file}`,
  )
for (const [file, expected] of Object.entries(provenance.artifacts))
  assert.equal(
    digest('sha256', await readFile(join(packageRoot, file)), 'hex'),
    expected.sha256,
    `Official artifact ${file}`,
  )
assert.equal(new Set(sites.map((site) => site.id)).size, sites.length)
await writeFile(join(output, 'sites.json'), JSON.stringify(sites, null, 2))
const artifacts: Record<string, string> = {}
for (const mode of ['instrumented', 'uninstrumented']) {
  for (const file of ['entry.mjs', 'entry.mjs.map', 'ghostty-vt.wasm', 'bridge.wasm'])
    artifacts[`${mode}/${file}`] = digest('sha256', await readFile(join(output, mode, file)), 'hex')
}
artifacts['fixture-font.ttf'] = digest(
  'sha256',
  await readFile(join(output, 'fixture-font.ttf')),
  'hex',
)
await writeFile(join(output, 'native-provenance.json'), JSON.stringify(provenance, null, 2))
await writeFile(
  join(output, 'manifest.json'),
  JSON.stringify(
    {
      label: 'X6 real-public in-process Node source counters',
      sourceHead: git('rev-parse', 'HEAD'),
      sourceStatus: git('status', '--porcelain'),
      actualBase: publicProductBase,
      sourceApproval: 'https://github.com/ShaulLavo/fregat/pull/567#issuecomment-5975440996',
      qualifiedCi: {
        run: '37167533768',
        attempt: 1,
        authoredSourceTree: 'de7d679652ef3285b73ca48bd34ad26b49123349',
        physicalCheckout: 'f18710850d439adef970572ff5e077c26c87f27d',
        physicalTree: '8d01ca8b4c8908a353acd958e5474e8a47387daa',
        physicalParents: ['9746396259cf58e55ea7de33922d9bd2a559e655', publicProductBase],
        qualification:
          '15 SUCCESS / 2 SKIP; all 11 owned leaves equal released source; remaining 9,285 equal immutable CI base',
        actualTerminalDisposeSha256:
          '1052effca46d86afa799797056ca7935a36f47a7523e7da8331e35f9a215ebc1',
      },
      sourceHashes,
      measuredModules,
      artifacts,
      sourceSites: sites.length,
      scope:
        'Exact owned core/dom/term/extensions evaluated source expressions and call/whole-optional-chain sites; actual opened public Terminal/DOM producers and native routes. Render/scheduler sources pinned but excluded from source counts. External DOM/native fonts modeled explicitly. No realized VM/native allocation or browser/paint/presentation claim.',
      pending: [
        'Custom OSC positive/counters — PENDING, nonblocking',
        'Public command dispatch — no public API; exclusive registration/rollback only',
      ],
      environment: {
        browser: 'N/A',
        headless: 'N/A',
        presentedFrames: 'UNKNOWN',
        argv: process.argv,
        bun: Bun.version,
      },
      timingWindow: 'Not registered or run by this build/counter command',
    },
    null,
    2,
  ),
)
if (command === 'diagnostic') runNode('instrumented', 'diagnostic')
if (command === 'counters') {
  runNode('instrumented', 'counters')
  runNode('uninstrumented', 'smoke')
  const result = JSON.parse(await readFile(join(output, 'instrumented/counters.json'), 'utf8')) as {
    rows: CountRow[]
  }
  await writeFile(
    join(output, 'counter-verification.json'),
    JSON.stringify(verifyPublicCounters(result.rows), null, 2),
  )
}

function runNode(bundle: string, mode: string): void {
  const directory = join(output, bundle)
  const argv = [
    join(directory, 'entry.mjs'),
    directory,
    mode,
    root,
    join(output, 'fixture-font.ttf'),
    publicProductBase,
  ]
  const child = spawnSync('node', argv, { encoding: 'utf8', timeout: 120_000 })
  awaitReceipt(directory, mode, child)
  assert.equal(child.status, 0, child.stderr)
}

function awaitReceipt(directory: string, mode: string, child: ReturnType<typeof spawnSync>): void {
  // Synchronous writes preserve failed child stdout/status before the parent assertion.
  writeFileSync(join(directory, `${mode}-stdout.log`), child.stdout ?? '')
  writeFileSync(join(directory, `${mode}-stderr.log`), child.stderr ?? '')
  writeFileSync(
    join(directory, `${mode}-child.json`),
    JSON.stringify(
      { status: child.status, signal: child.signal, error: child.error?.message },
      null,
      2,
    ),
  )
}
