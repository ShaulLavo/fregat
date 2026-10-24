import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, test } from 'vitest'
import { freezePackageSet, loadPackageSet } from '../package-set.mjs'

const roots = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function write(path, text) {
  await mkdir(join(path, '..'), { recursive: true })
  await writeFile(path, text)
}

async function fixture(exports = { '.': './dist/index.js' }) {
  const root = await mkdtemp(join(tmpdir(), 'package-set-'))
  roots.push(root)
  const core = join(root, 'source', 'core')
  await write(
    join(core, 'package.json'),
    JSON.stringify({
      name: '@singapore-editor/core',
      version: '0.0.0',
      exports,
      dependencies: { 'tiny-dep': '1.0.0' },
    }),
  )
  await write(join(core, 'src', 'index.ts'), 'export const value = 1\n')
  await write(join(core, 'dist', 'index.js'), 'export const value = 1\n')
  const modules = join(core, 'node_modules')
  await write(
    join(modules, 'tiny-dep', 'package.json'),
    JSON.stringify({
      name: 'tiny-dep',
      version: '1.0.0',
      main: 'index.js',
      dependencies: { 'tiny-sub': '1.0.0' },
    }),
  )
  await write(join(modules, 'tiny-dep', 'index.js'), 'module.exports = 1\n')
  await write(
    join(modules, 'tiny-sub', 'package.json'),
    JSON.stringify({ name: 'tiny-sub', version: '1.0.0', main: 'index.js' }),
  )
  await write(join(modules, 'tiny-sub', 'index.js'), 'module.exports = 2\n')
  const set = await freezePackageSet(join(root, 'source'), join(root, 'frozen'), {
    commit: 'fixture',
  })
  return { root, modules, set }
}

test('a frozen set records the bytes of its transitive external dependencies', async () => {
  const { set } = await fixture()
  expect(set.manifest.schemaVersion).toBe(2)
  expect(set.manifest.external.packages.map((entry) => entry.name)).toEqual([
    'tiny-dep',
    'tiny-sub',
  ])
  expect(set.externalHash).toBe(set.manifest.external.sha256)
})

test('a browser snapshot keeps the package and explains its unavailable Bun server export', async () => {
  const exports = {
    '.': { types: './dist/index.d.ts', import: './dist/index.js' },
    './server': { types: './server/signaling.ts', bun: './server/signaling.ts' },
  }
  const { set } = await fixture(exports)
  expect(set.manifest.packages[0].exports).toEqual(exports)
  expect(set.aliases).toEqual([
    {
      find: /^@singapore-editor\/core(?=$|[?#])/,
      replacement: join(set.directory, 'core/dist/index.js'),
    },
    {
      find: /^@singapore-editor\/core\/server(?=$|[?#])/,
      replacement: '@singapore-editor/core/server',
      reason: 'No target for browser, module, production, import, default conditions',
    },
  ])
  expect(set.skippedExports).toEqual([
    {
      specifier: '@singapore-editor/core/server',
      reason: 'No target for browser, module, production, import, default conditions',
    },
  ])
  expect((await loadPackageSet(set.directory)).skippedExports).toEqual(set.skippedExports)
})

test.each([
  { browser: { import: './dist/index.js' }, import: './server/signaling.ts' },
  { production: './dist/index.js', default: './server/signaling.ts' },
  { module: './dist/index.js', default: './server/signaling.ts' },
  { default: './dist/index.js', import: './server/signaling.ts' },
  {
    node: './server/signaling.ts',
    development: './server/signaling.ts',
    default: './dist/index.js',
  },
  { import: { browser: './dist/index.js', default: './server/signaling.ts' } },
  [{ bun: './server/signaling.ts' }, './dist/index.js'],
])('resolves nested browser conditions and fallback arrays: %j', async (target) => {
  const { set } = await fixture({ '.': target })
  expect(set.aliases[0].replacement).toBe(join(set.directory, 'core/dist/index.js'))
  expect(set.skippedExports).toEqual([])
})

test.each(['./dist/index.js', { import: './dist/index.js' }, ['./dist/index.js']])(
  'resolves root export shorthand: %j',
  async (exports) => {
    const { set } = await fixture(exports)
    expect(set.aliases[0].find).toEqual(/^@singapore-editor\/core(?=$|[?#])/)
  },
)

test('a matching null condition blocks later defaults', async () => {
  const { set } = await fixture({
    '.': './dist/index.js',
    './blocked': { browser: null, default: './dist/index.js' },
  })
  expect(set.aliases).toHaveLength(2)
  expect(set.skippedExports[0].specifier).toBe('@singapore-editor/core/blocked')
  expect(set.aliases[1].reason).toBe(set.skippedExports[0].reason)
})

test('conditional resolution still rejects browser exports outside the frozen build', async () => {
  await expect(fixture({ '.': { browser: './server/signaling.ts' } })).rejects.toThrow(
    'Unsupported frozen export: @singapore-editor/core.',
  )
})

test('reload rejects a one-byte change in a direct or transitive external dependency', async () => {
  const { root, modules } = await fixture()
  await writeFile(join(modules, 'tiny-sub', 'index.js'), 'module.exports = 3\n')
  await expect(loadPackageSet(join(root, 'frozen'))).rejects.toThrow(
    /external dependencies changed: tiny-sub@1.0.0/,
  )
  await writeFile(join(modules, 'tiny-sub', 'index.js'), 'module.exports = 2\n')
  await loadPackageSet(join(root, 'frozen'))
  await writeFile(join(modules, 'tiny-dep', 'index.js'), 'module.exports = 9\n')
  await expect(loadPackageSet(join(root, 'frozen'))).rejects.toThrow(/tiny-dep@1.0.0/)
})
