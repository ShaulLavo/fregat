import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, test } from 'vitest'
import { verifyRuntimeGraph } from '../runtime-graph.mjs'

const roots = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function tree() {
  const root = await mkdtemp(join(tmpdir(), 'runtime-graph-'))
  roots.push(root)
  const dirs = ['instrument', 'frozen/core/dist', 'receipt/pkg', 'other/pkg', 'out/assets']
  for (const dir of dirs) await mkdir(join(root, dir), { recursive: true })
  await writeFile(
    join(root, 'frozen/package-set.json'),
    JSON.stringify({ packages: [{ folder: 'core' }] }),
  )
  await writeFile(join(root, 'instrument/page.ts'), 'page')
  await writeFile(join(root, 'frozen/core/dist/index.js'), 'core')
  await writeFile(join(root, 'receipt/pkg/index.js'), 'covered')
  await writeFile(join(root, 'other/pkg/index.js'), 'uncovered')
  await writeFile(join(root, 'receipt/pkg/package.json'), JSON.stringify({ name: 'covered' }))
  await writeFile(join(root, 'other/pkg/package.json'), JSON.stringify({ name: 'uncovered' }))
  return root
}

const verify = (root, ids) =>
  verifyRuntimeGraph({
    ids: new Set(ids),
    outDir: join(root, 'out'),
    instrumentRoot: join(root, 'instrument'),
    packageSetDirectory: join(root, 'frozen'),
    receiptRoots: [join(root, 'receipt/pkg')],
  })

test('accepts modules from the instrument, the frozen set and receipt roots', async () => {
  const root = await tree()
  const graph = await verify(root, [
    join(root, 'instrument/page.ts'),
    join(root, 'frozen/core/dist/index.js'),
    join(root, 'receipt/pkg/index.js'),
    '\0virtual:helper',
  ])
  expect(graph.escaped).toEqual([])
  expect(graph.receiptPackagesUsed).toEqual(['covered'])
})

test('reports a module from an uncovered package and an emitted copy nothing allowed contains', async () => {
  const root = await tree()
  await writeFile(join(root, 'out/assets/grammar.wasm'), 'unknown bytes')
  await writeFile(join(root, 'out/assets/copied.js'), 'covered')
  const graph = await verify(root, [join(root, 'other/pkg/index.js')])
  expect(graph.escaped).toEqual([join(root, 'other/pkg/index.js'), 'asset assets/grammar.wasm'])
  expect(graph.assets.find((asset) => asset.file === 'assets/copied.js').source).toBe(
    join(root, 'receipt/pkg/index.js'),
  )
})

test('rejects unreceipted nested modules and binary copies', async () => {
  const root = await tree()
  const nested = join(root, 'receipt/pkg/node_modules/peer')
  await mkdir(nested, { recursive: true })
  await writeFile(join(nested, 'index.js'), 'peer code')
  await writeFile(join(nested, 'grammar.wasm'), 'peer binary')
  await writeFile(join(root, 'out/assets/peer.wasm'), 'peer binary')
  const graph = await verify(root, [join(nested, 'index.js')])
  expect(graph.escaped).toEqual([join(nested, 'index.js'), 'asset assets/peer.wasm'])
})

test('a nested package with its own receipt is covered', async () => {
  const root = await tree()
  const nested = join(root, 'receipt/pkg/node_modules/peer')
  await mkdir(nested, { recursive: true })
  await writeFile(join(nested, 'package.json'), JSON.stringify({ name: 'peer' }))
  await writeFile(join(nested, 'index.js'), 'peer code')
  const graph = await verifyRuntimeGraph({
    ids: new Set([join(nested, 'index.js')]),
    outDir: join(root, 'out'),
    instrumentRoot: join(root, 'instrument'),
    packageSetDirectory: join(root, 'frozen'),
    receiptRoots: [join(root, 'receipt/pkg'), nested],
  })
  expect(graph.escaped).toEqual([])
  expect(graph.receiptPackagesUsed).toEqual(['peer'])
})

test('rejects extra frozen-package files and emitted copies outside src, dist and manifest', async () => {
  const root = await tree()
  const extra = join(root, 'frozen/core/extra.js')
  await writeFile(extra, 'extra untracked code')
  await writeFile(join(root, 'out/assets/extra.js'), 'extra untracked code')
  expect((await verify(root, [extra])).escaped).toEqual([extra, 'asset assets/extra.js'])
})
