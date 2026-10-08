import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
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
const families = ['editor', 'ghostty-webgpu', 'hotkeys']
const sharedPatches = Object.entries(root.patchedDependencies ?? {}).filter(([key]) =>
  tools.includes(key.slice(0, key.lastIndexOf('@'))),
)
const files = new Set(['package.json'])
for (const pattern of [...patterns, ...families]) {
  for await (const file of new Glob(`${pattern}/package.json`).scan('.')) files.add(file)
}
const write = process.argv.includes('--write')
const problems = []

function expectedVersion(file, name) {
  // Astro and TypeDoc use the JavaScript compiler API; TypeScript 7 supplies the CLI.
  if (
    name === 'typescript' &&
    [
      'apps/site/package.json',
      'editor/site/package.json',
      'ghostty-webgpu/site/package.json',
    ].includes(file)
  )
    return catalog['typescript-api']
  return catalog[name]
}

async function checkStandalonePatches(file, manifest) {
  if (!families.includes(dirname(file))) return false
  let changed = false
  for (const [key, patch] of sharedPatches) {
    if (manifest.patchedDependencies?.[key] !== patch) {
      if (!write) problems.push(`${file}: patch ${key} must be ${patch}`)
      manifest.patchedDependencies ??= {}
      manifest.patchedDependencies[key] = patch
      changed = true
    }
    await checkPatchFile(`${dirname(file)}/${patch}`, patch)
  }
  return changed
}

async function checkPatchFile(file, patch) {
  const expected = await readFile(patch)
  const actual = await readFile(file).catch((error) => {
    if (error.code === 'ENOENT') return undefined
    throw error
  })
  if (actual?.equals(expected)) return
  if (!write) {
    problems.push(`${file} must match the root patch`)
    return
  }
  await mkdir(dirname(file), { recursive: true })
  await writeFile(file, expected)
}

async function checkManifest(file) {
  const manifest = JSON.parse(await readFile(file, 'utf8'))
  let changed = await checkStandalonePatches(file, manifest)
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
const format = JSON.parse(await readFile('.oxfmtrc.json', 'utf8'))
for (const family of families) {
  const config = JSON.parse(await readFile(`${family}/.oxfmtrc.json`, 'utf8'))
  for (const [name, value] of Object.entries(format)) {
    if (name === '$schema' || name === 'ignorePatterns') continue
    if (JSON.stringify(config[name]) === JSON.stringify(value)) continue
    problems.push(`${family}/.oxfmtrc.json: ${name} must match the root formatter`)
  }
}
assert.equal(problems.length, 0, problems.join('\n'))
console.log(`Shared tooling agrees across ${files.size} package manifests.`)
