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

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'package-set-'))
  roots.push(root)
  const core = join(root, 'source', 'core')
  await write(
    join(core, 'package.json'),
    JSON.stringify({
      name: '@singapore-editor/core',
      version: '0.0.0',
      exports: { '.': './dist/index.js' },
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
