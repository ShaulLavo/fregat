import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { copyFile, cp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { dirname, join } from 'node:path'

const repository = process.argv[2]
const output = process.argv[3]
const ref = process.argv[4]
const wave = process.argv[5]
assert(repository && output && ref && wave)
const unicodeLane = join(wave, 'lanes/r3-unicode')
const { entryOverlay, runtimeOverlay } = await import('./overlays.ts')
const baseline = join(wave, 'lanes/r2-frame/shared-bundle-r07')
const root = join(repository, 'ghostty-webgpu')
const sourcePin = '1e066d38b6455b45d406fce175f902152a58295b'
const sha = (bytes: string | Uint8Array) => createHash('sha256').update(bytes).digest('hex')
const { runtimeSource } = await import(join(root, 'bench/comparison-build.ts'))
const runtime = await runtimeSource(root, ref)
await mkdir(output, { recursive: true })
await cp(join(baseline, 'packet'), join(output, 'packet'), { recursive: true })
const oracle = await readFile(join(unicodeLane, 'cell-oracle.ts'), 'utf8')
const entry = entryOverlay(await readFile(join(baseline, 'entry-source.ts'), 'utf8'), oracle)
let fixtures = await readFile(join(baseline, 'fixtures-source.ts'), 'utf8')
fixtures = fixtures.replace(
  'scrollback: 200_000,',
  "scrollback: new URLSearchParams(location.search).get('retention') === 'bounded' ? 10_000 : 200_000,",
)
await writeFile(join(output, 'entry-source.ts'), entry)
await writeFile(join(output, 'fixtures-source.ts'), fixtures)
try {
  const build = await Bun.build({
    entrypoints: [join(root, 'bench/comparison-entry.ts')],
    target: 'browser',
    format: 'esm',
    minify: { whitespace: true, syntax: false, identifiers: false },
    outdir: join(output, 'packet'),
    naming: 'browser.js',
    external: ['@xterm/xterm', '@xterm/addon-webgl', '@xterm/addon-unicode11', 'ghostty-web'],
    plugins: [
      ...runtime.plugins,
      {
        name: 'diagnostic-runtime-overlays',
        setup(builder) {
          builder.onLoad(
            {
              filter:
                /\/src\/(render\/frame-observer|dom\/execution-local|render\/webgl\/text-pass)\.ts$/,
            },
            async ({ path }) => ({
              contents: runtimeOverlay(path, await readFile(path, 'utf8')),
              loader: 'ts',
              resolveDir: dirname(path),
            }),
          )
        },
      },
      {
        name: 'frozen-r07-harness',
        setup(builder) {
          builder.onLoad({ filter: /\/bench\/comparison-.*\.ts$/ }, ({ path }) => {
            let contents
            if (path.endsWith('comparison-entry.ts')) contents = entry
            else if (path.endsWith('comparison-fixtures.ts')) contents = fixtures
            else
              contents = execFileSync(
                'git',
                ['show', `${sourcePin}:ghostty-webgpu/bench/${path.split('/').at(-1)}`],
                { cwd: repository, encoding: 'utf8' },
              )
            return { contents, loader: 'ts', resolveDir: dirname(path) }
          })
        },
      },
    ],
  })
  assert(build.success, JSON.stringify(build.logs))
  const browser = join(output, 'packet/browser.js')
  await writeFile(
    browser,
    (await readFile(browser, 'utf8')).replace(
      'new URL("../../../canvas-compose.wasm",import.meta.url)',
      'new URL("/canvas-compose.wasm",import.meta.url)',
    ),
  )
  for (const [asset, path] of Object.entries({
    'native.wasm': 'ghostty-vt.wasm',
    'bridge.wasm': 'bridge.wasm',
    'canvas-compose.wasm': 'canvas-compose.wasm',
  })) {
    await writeFile(
      join(output, 'packet', asset),
      execFileSync('git', ['show', `${runtime.commit}:ghostty-webgpu/${path}`], {
        cwd: repository,
      }),
    )
  }
  await copyFile(
    join(unicodeLane, 'unicode11/package/lib/addon-unicode11.mjs'),
    join(output, 'packet/addon-unicode11.mjs'),
  )
  const indexPath = join(output, 'packet/index.html')
  await writeFile(
    indexPath,
    (await readFile(indexPath, 'utf8')).replace(
      '"@xterm/addon-webgl":',
      '"@xterm/addon-unicode11":"/addon-unicode11.mjs","@xterm/addon-webgl":',
    ),
  )
  const baselineManifest = JSON.parse(await readFile(join(baseline, 'bundle.json'), 'utf8'))
  const { officialManifest, ...baselineMetadata } = baselineManifest
  const manifestPath = join(output, 'packet/manifest.json')
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  manifest.runtime = {
    mode: runtime.mode,
    ref,
    commit: runtime.commit,
    version: runtime.version,
    dirty: '',
    source: runtime.inventory,
  }
  manifest.researchSibling = {
    harnessPin: sourcePin,
    unicodeVersion: '11',
    baselineBundle: baselineManifest.bundleSha256,
  }
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n')
  const assets: Record<string, string> = {}
  for (const name of [
    'native.wasm',
    'bridge.wasm',
    'canvas-compose.wasm',
    'addon-unicode11.mjs',
    'xterm.mjs',
    'addon-webgl.mjs',
  ])
    assets[name] = sha(await readFile(join(output, 'packet', name)))
  const record = {
    ...baselineMetadata,
    assets,
    baselineOfficialManifestSha256: sha(JSON.stringify(officialManifest)),
    id: 'tw-budget-ablation-r01',
    diagnosticOnly: true,
    publicationPR1009Included: true,
    parserApiUnicodeVersion: '11',
    runtimeCommit: runtime.commit,
    runtimeSourceSha256: runtime.inventory.sha256,
    bundleSha256: sha(await readFile(browser)),
    entryOverlaySha256: sha(entry),
    fixturesOverlaySha256: sha(fixtures),
    baseline: {
      id: baselineManifest.id,
      bundleSha256: baselineManifest.bundleSha256,
      runtimeCommit: sourcePin,
    },
    unicode: JSON.parse(await readFile(join(unicodeLane, 'unicode11/pin.json'), 'utf8')),
    cellOracle: {
      sourceSha256: sha(await readFile(join(unicodeLane, 'cell-oracle.ts'))),
      api: 'GhosttyRuntime.createRenderState, GhosttyTerminal.scrollToRow, GhosttyRenderState.readRows; xterm Terminal.buffer.active.getLine/getCell/getWidth/getChars',
      scope:
        'All retained rows on every target, widths, owner boundaries and owner text. Common mode 2027 off; generated outside counter windows.',
    },
    retentionConditions: {
      default: 'R07 full-stream 200000 rows and native 64 MiB',
      bounded:
        'Query retention=bounded sets nominal native 10000; xtermRows=9572 gives matched final Unicode retention.',
    },
    fixtureChanges: [],
    outputBoundary:
      'R07 logical/full-retained text plus every retained row cell widths, owner boundaries and owner text. Readback outside native interval.',
  }
  await writeFile(join(output, 'bundle.json'), JSON.stringify(record, null, 2) + '\n')
  console.log(
    JSON.stringify({ output, runtimeCommit: runtime.commit, bundleSha256: record.bundleSha256 }),
  )
} finally {
  await runtime.dispose()
}
