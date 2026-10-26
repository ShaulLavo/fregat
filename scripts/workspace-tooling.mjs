import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { Glob } from 'bun'

const tools = [
  'typescript',
  'typescript-api',
  'vite',
  'vitest',
  '@vitest/browser-playwright',
  '@vitest/mocker',
  'oxlint',
  'oxfmt',
  'turbo',
  'knip',
  'playwright',
  '@types/bun',
]
const root = JSON.parse(await readFile('package.json', 'utf8'))
const catalog = root.workspaces.catalog
const patterns = root.workspaces.packages
const files = new Set(['package.json'])
for (const pattern of patterns) {
  for await (const file of new Glob(`${pattern}/package.json`).scan('.')) files.add(file)
}
const write = process.argv.includes('--write')
const problems = []

function expectedVersion(file, name) {
  // Astro uses the JavaScript compiler API; TypeScript 7 supplies the CLI.
  if (name === 'typescript' && file === 'apps/site/package.json') return catalog['typescript-api']
  return catalog[name]
}

async function checkManifest(file) {
  const manifest = JSON.parse(await readFile(file, 'utf8'))
  let changed = false
  for (const section of ['dependencies', 'devDependencies']) {
    for (const name of tools) {
      const actual = manifest[section]?.[name]
      if (actual === undefined) continue
      const expected = expectedVersion(file, name)
      assert.equal(typeof expected, 'string', `Root catalog must define ${name}`)
      const resolved = actual === 'catalog:' ? catalog[name] : actual
      if (resolved === expected) continue
      if (!write) problems.push(`${file}: ${name} must be ${expected}, received ${actual}`)
      manifest[section][name] = expected
      changed = true
    }
  }
  if (manifest.packageManager && manifest.packageManager !== root.packageManager) {
    if (!write) problems.push(`${file}: packageManager must be ${root.packageManager}`)
    manifest.packageManager = root.packageManager
    changed = true
  }
  for (const [name, version] of Object.entries(manifest.workspaces?.catalog ?? {})) {
    if (!tools.includes(name) || version === catalog[name]) continue
    if (!write) problems.push(`${file}: catalog ${name} must be ${catalog[name]}`)
    manifest.workspaces.catalog[name] = catalog[name]
    changed = true
  }
  if (write && changed) await writeFile(file, `${JSON.stringify(manifest, null, 2)}\n`)
}

for (const file of files) await checkManifest(file)
assert.equal(problems.length, 0, problems.join('\n'))
console.log(`Shared tooling agrees across ${files.size} package manifests.`)
