import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, test } from 'vitest'
import * as runtime from '../input-runtime.mjs'
import { inputSourceIdentity } from '../input-identity.mjs'

const roots = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function write(path, text) {
  await mkdir(join(path, '..'), { recursive: true })
  await writeFile(path, text)
}

async function executionFixture() {
  const root = await mkdtemp(join(tmpdir(), 'input-execution-'))
  roots.push(root)
  const stress = join(root, 'stress')
  await write(
    join(stress, 'package.json'),
    JSON.stringify({ devDependencies: { '@playwright/test': '1', vite: '1' } }),
  )
  for (const [name, manifest] of Object.entries({
    '@playwright/test': { dependencies: { playwright: '1' } },
    playwright: { dependencies: { 'playwright-core': '1' } },
    'playwright-core': {},
    vite: { dependencies: { rolldown: '1' }, peerDependencies: { postcss: '1' } },
    rolldown: { optionalDependencies: { 'native-binding': '1' } },
    postcss: {},
    'native-binding': {},
  })) {
    await write(
      join(stress, 'node_modules', name, 'package.json'),
      JSON.stringify({ name, version: '1', ...manifest }),
    )
    await write(join(stress, 'node_modules', name, 'index.js'), 'export const value = 1')
  }
  return { root, stress }
}

test('actual instrument covers the browser launcher and bundler execution trees', async () => {
  const instrument = await runtime.inputInstrument()
  expect(instrument.files).toEqual(
    expect.arrayContaining(['examples/stress/tsconfig.json', 'examples/app/tsconfig.json']),
  )
  const names = instrument.receipt.packages.map((entry) => entry.name)
  expect(names).toEqual(
    expect.arrayContaining([
      '@playwright/test',
      'playwright',
      'playwright-core',
      'vite',
      'rolldown',
    ]),
  )
}, 30_000)

test('launcher, compiler, optional native and peer bytes all invalidate controls', async () => {
  const { stress } = await executionFixture()
  const receipt = await runtime.inputExecutionReceipt(stress)
  expect(receipt.packages.map((entry) => entry.name)).toEqual(
    expect.arrayContaining(['playwright-core', 'rolldown', 'native-binding', 'postcss']),
  )
  for (const name of ['playwright-core', 'rolldown', 'native-binding', 'postcss']) {
    const file = join(stress, 'node_modules', name, 'index.js')
    await writeFile(file, 'export const value = 2')
    const changed = await runtime.inputExecutionReceipt(stress)
    expect(inputSourceIdentity([], changed.sha256).measurementHash).not.toBe(
      inputSourceIdentity([], receipt.sha256).measurementHash,
    )
    await writeFile(file, 'export const value = 1')
  }
})

test('both real builds use captured harness bytes after the live source changes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'input-runtime-snapshot-'))
  roots.push(root)
  const live = join(root, 'live.js')
  const original = "document.body.dataset.instrument = 'captured-instrument'"
  await writeFile(live, original)
  const sources = [
    {
      path: 'examples/stress/index.html',
      bytes: Buffer.from('<script type="module" src="/src/browser.js"></script>'),
    },
    { path: 'examples/stress/src/browser.js', bytes: await readFile(live) },
  ]
  const instrument = {
    ...inputSourceIdentity(sources, 'external'),
    sources,
    receipt: { packages: [] },
  }
  const directory = join(root, 'packages')
  await write(join(directory, 'package-set.json'), JSON.stringify({ packages: [] }))
  const packageSet = { directory, aliases: {}, manifest: { external: { packages: [] } } }
  for (const side of ['baseline', 'candidate']) {
    await writeFile(live, `document.body.dataset.instrument = '${side}-changed-instrument'`)
    const output = join(root, side)
    const result = await runtime.buildInputRuntime(
      packageSet,
      output,
      root,
      { fixtures: [] },
      instrument,
    )
    const assets = await readdir(join(output, 'assets'))
    const code = (
      await Promise.all(
        assets
          .filter((name) => name.endsWith('.js'))
          .map((name) => readFile(join(output, 'assets', name), 'utf8')),
      )
    ).join('\n')
    expect(code).toContain('captured-instrument')
    expect(code).not.toContain(`${side}-changed-instrument`)
    expect(result.runtimeGraph.escaped).toEqual([])
  }
}, 30_000)
