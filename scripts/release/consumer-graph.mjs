import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const consumers = [
  'apps/web',
  'apps/server',
  'apps/tui',
  'packages/client-core',
  'packages/contracts',
  'packages/markdown',
]
const producers = ['packages/singapore', 'packages/ghostty-webgpu', 'packages/hotkeys']
const isStandalone = (name) =>
  name.startsWith('@singapore-editor/') ||
  name.startsWith('@fregat/') ||
  name.startsWith('ghostty-webgpu')
const readManifest = (root) => JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))

function resolvePackage(from, name) {
  const entry = fs.realpathSync(createRequire(path.join(from, 'package.json')).resolve(name))
  let root = path.dirname(entry)
  while (!fs.existsSync(path.join(root, 'package.json'))) {
    const parent = path.dirname(root)
    assert.notEqual(parent, root, `No package manifest for ${name}: ${entry}`)
    root = parent
  }
  assert.equal(readManifest(root).name, name, `Unexpected package for ${name}: ${root}`)
  assert(entry.startsWith(`${root}${path.sep}dist${path.sep}`), `Unbuilt entrypoint: ${entry}`)
  return root
}

function inspectPackage(root, state) {
  if (state.visited.has(root)) return
  state.visited.add(root)
  for (const producer of state.producers) {
    assert(
      root !== producer && !root.startsWith(`${producer}${path.sep}`),
      `Producer fallback: ${root}`,
    )
  }
  const manifest = readManifest(root)
  if (manifest.name === '@fregat/hotkeys') state.hotkeys.add(root)
  const dependencies = { ...manifest.dependencies, ...manifest.peerDependencies }
  for (const name of Object.keys(dependencies).filter(isStandalone)) {
    if (manifest.peerDependenciesMeta?.[name]?.optional) continue
    inspectPackage(resolvePackage(root, name), state)
  }
}

export function verifyConsumerGraph(repository, { producerFree = false } = {}) {
  const root = fs.realpathSync(repository)
  const producerRoots = producers.map((producer) => path.join(root, producer))
  if (producerFree) {
    for (const producer of producerRoots)
      assert(!fs.existsSync(producer), `Producer still present: ${producer}`)
  }
  const state = { producers: producerRoots, visited: new Set(), hotkeys: new Set() }
  const results = []
  for (const consumer of consumers) {
    const directory = path.join(root, consumer)
    const names = Object.keys(readManifest(directory).dependencies ?? {}).filter(isStandalone)
    for (const name of names) inspectPackage(resolvePackage(directory, name), state)
    results.push({ consumer, releaseRoots: names.length })
  }
  assert.equal(state.hotkeys.size, 1, 'Consumers must share one installed hotkeys runtime')
  return { consumers: results, packages: state.visited.size, hotkeysRuntimes: state.hotkeys.size }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(
    JSON.stringify(
      verifyConsumerGraph(process.cwd(), {
        producerFree: process.argv.includes('--producer-free'),
      }),
      null,
      2,
    ),
  )
}
