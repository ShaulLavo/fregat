import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute } from 'node:path'
import { Glob } from 'bun'

const repository = 'ShaulLavo/fregat'
assert.equal(
  process.env.GITHUB_REPOSITORY ?? repository,
  repository,
  'Publishing repository must match package provenance',
)
const root = JSON.parse(await readFile('package.json', 'utf8'))
const patterns = Array.isArray(root.workspaces) ? root.workspaces : root.workspaces.packages
const files = new Set()
for (const pattern of patterns) {
  for await (const file of new Glob(`${pattern}/package.json`).scan('.')) files.add(file)
}
const packages = await Promise.all(
  Array.from(files, async (file) => ({
    file,
    manifest: JSON.parse(await readFile(file, 'utf8')),
  })),
)
const byName = new Map(packages.map(({ manifest }) => [manifest.name, manifest]))

function publishedRange(name, range, section) {
  if (range.startsWith('catalog:')) {
    const catalogName = range.slice('catalog:'.length)
    const catalog = catalogName ? root.workspaces.catalogs?.[catalogName] : root.workspaces.catalog
    assert.equal(typeof catalog?.[name], 'string', `Catalog dependency required: ${name}`)
    return catalog[name]
  }
  if (!range.startsWith('workspace:')) return range
  const dependency = byName.get(name)
  assert(
    dependency?.version && (!dependency.private || section === 'devDependencies'),
    `Publishable workspace dependency required: ${name}`,
  )
  const spec = range.slice('workspace:'.length)
  if (spec === '*') return dependency.version
  if (spec === '^' || spec === '~') return `${spec}${dependency.version}`
  assert(/^[~^<>=\d]/.test(spec), `Workspace version range required: ${name}`)
  return spec
}

function prepare({ file, manifest }) {
  if (manifest.private) return null
  const directory = dirname(file)
  assert(
    !isAbsolute(directory) && !directory.split('/').includes('..'),
    `Public package directory must be inside the publishing repository: ${manifest.name}`,
  )
  manifest.repository = {
    type: 'git',
    url: `git+https://github.com/${repository}.git`,
    directory,
  }
  for (const section of [
    'dependencies',
    'optionalDependencies',
    'peerDependencies',
    'devDependencies',
  ]) {
    for (const [name, range] of Object.entries(manifest[section] ?? {})) {
      manifest[section][name] = publishedRange(name, range, section)
    }
  }
  return { file, content: `${JSON.stringify(manifest, null, 2)}\n` }
}

// Validate every package before replacing any manifests in the disposable release checkout.
const prepared = packages.map(prepare).filter(Boolean)
await Promise.all(prepared.map(({ file, content }) => writeFile(file, content)))
console.log(`Prepared ${prepared.length} public package manifests for npm.`)
