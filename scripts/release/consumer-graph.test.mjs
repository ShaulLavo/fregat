import { expect, test } from 'vitest'
import { mkdir, readFile, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { withWorkspace } from './fixture.mjs'
import { verifyConsumerGraph } from './consumer-graph.mjs'

async function addPackage(put, root, directory, name, extra = {}) {
  await put(directory, { name, exports: './dist/index.js', ...extra })
  await mkdir(join(root, directory, 'dist'), { recursive: true })
  await writeFile(join(root, directory, 'dist/index.js'), 'export const value = 1\n')
}

async function graphFixture(workspace, mode = 'release', optional = false) {
  const { root, put } = workspace
  for (const consumer of [
    'apps/web',
    'apps/server',
    'apps/tui',
    'packages/client-core',
    'packages/contracts',
    'packages/markdown',
    'scripts',
  ]) {
    await put(consumer, {
      dependencies: { '@singapore-editor/highlighting': '1.0.0', '@fregat/hotkeys': '1.0.0' },
    })
  }
  await addPackage(put, root, 'node_modules/@fregat/hotkeys', '@fregat/hotkeys')
  await addPackage(
    put,
    root,
    'node_modules/@singapore-editor/highlighting',
    '@singapore-editor/highlighting',
    {
      peerDependencies: { '@singapore-editor/core': '1.0.0' },
      peerDependenciesMeta: { '@singapore-editor/core': { optional } },
    },
  )
  if (mode === 'missing') return
  const core =
    mode === 'fallback'
      ? 'packages/singapore/packages/editor'
      : 'node_modules/@singapore-editor/core'
  await addPackage(put, root, core, '@singapore-editor/core', {
    dependencies: { '@fregat/hotkeys': '1.0.0' },
  })
  if (mode === 'fallback')
    await symlink(join(root, core), join(root, 'node_modules/@singapore-editor/core'))
  if (mode === 'split')
    await addPackage(put, root, `${core}/node_modules/@fregat/hotkeys`, '@fregat/hotkeys')
}

test('generated checks enforce the producer-free installed consumer graph', async () => {
  const manifest = JSON.parse(
    await readFile(join(import.meta.dirname, '../../package.json'), 'utf8'),
  )
  expect(manifest.scripts['standalone:consumer:check']).toBe(
    'bun scripts/release/consumer-graph.mjs --producer-free',
  )
  expect(manifest.scripts['generated:check'].split(' && ')).toContain(
    'bun run standalone:consumer:check',
  )
})

test('verifies installed entries, peer dependencies and one shared hotkeys runtime', async () => {
  await withWorkspace(async (workspace) => {
    await graphFixture(workspace)
    expect(verifyConsumerGraph(workspace.root, { producerFree: true })).toMatchObject({
      packages: 3,
      hotkeysRuntimes: 1,
    })
  })
})

test('rejects a peer dependency that falls back into a producer workspace', async () => {
  await withWorkspace(async (workspace) => {
    await graphFixture(workspace, 'fallback')
    expect(() => verifyConsumerGraph(workspace.root)).toThrow(/Producer fallback/)
  })
})

test('rejects two physical hotkeys runtime packages', async () => {
  await withWorkspace(async (workspace) => {
    await graphFixture(workspace, 'split')
    expect(() => verifyConsumerGraph(workspace.root)).toThrow(/one installed hotkeys runtime/)
  })
})

test('producer-free qualification rejects retained producer folders', async () => {
  await withWorkspace(async (workspace) => {
    await graphFixture(workspace)
    await mkdir(join(workspace.root, 'packages/hotkeys'), { recursive: true })
    expect(() => verifyConsumerGraph(workspace.root, { producerFree: true })).toThrow(
      /Producer still present/,
    )
  })
})

test.each(['fallback', 'split'])('checks installed optional peers: %s', async (mode) => {
  await withWorkspace(async (workspace) => {
    await graphFixture(workspace, mode, true)
    const failure = mode === 'fallback' ? /Producer fallback/ : /one installed hotkeys runtime/
    expect(() => verifyConsumerGraph(workspace.root)).toThrow(failure)
  })
})

test('allows absent optional standalone peers', async () => {
  await withWorkspace(async (workspace) => {
    await graphFixture(workspace, 'missing', true)
    expect(verifyConsumerGraph(workspace.root)).toMatchObject({ packages: 2, hotkeysRuntimes: 1 })
  })
})

test('rejects absent required standalone peers', async () => {
  await withWorkspace(async (workspace) => {
    await graphFixture(workspace, 'missing')
    expect(() => verifyConsumerGraph(workspace.root)).toThrow()
  })
})

test('rejects an installed optional peer with a missing entrypoint', async () => {
  await withWorkspace(async (workspace) => {
    await graphFixture(workspace, 'release', true)
    await workspace.put('node_modules/@singapore-editor/core', {
      name: '@singapore-editor/core',
      exports: './dist/missing.js',
    })
    expect(() => verifyConsumerGraph(workspace.root)).toThrow()
  })
})

test('rejects a scripts-only second hotkeys runtime', async () => {
  await withWorkspace(async (workspace) => {
    await graphFixture(workspace)
    await addPackage(
      workspace.put,
      workspace.root,
      'scripts/node_modules/@fregat/hotkeys',
      '@fregat/hotkeys',
    )
    expect(() => verifyConsumerGraph(workspace.root)).toThrow(/one installed hotkeys runtime/)
  })
})
