import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { $, Glob, semver } from 'bun'
import { workspaceRoot } from './workspace-root'

const root = resolve(import.meta.dir, '..')
const runtimeRevision = await remoteRevision('tree-sitter-x', 'refs/heads/web-tree-sitter')
const markdownRevision = await remoteRevision('tree-sitter-md', 'HEAD')
const runtime = `github:ShaulLavo/tree-sitter-x#${runtimeRevision}`
const markdown = `github:ShaulLavo/tree-sitter-md#${markdownRevision}`
const response = await fetch(
  `https://raw.githubusercontent.com/ShaulLavo/tree-sitter-md/${markdownRevision}/package.json`,
)
assert.ok(response.ok, 'The selected Markdown source manifest must be available')
const manifest = (await response.json()) as {
  version: string
  dependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
  peerDependenciesMeta?: Record<string, { optional?: boolean }>
}
const runtimeResponse = await fetch(
  `https://raw.githubusercontent.com/ShaulLavo/tree-sitter-x/${runtimeRevision}/package.json`,
)
assert.ok(runtimeResponse.ok, 'The selected runtime artifact manifest must be available')
const runtimeManifest = (await runtimeResponse.json()) as { version: string }
assert.equal(typeof runtimeManifest.version, 'string')
const peerRange = manifest.peerDependencies?.['web-tree-sitter']
assert.match(
  peerRange ?? '',
  /^\^\d+\.\d+\.\d+$/,
  'The Markdown peer must declare a compatible runtime line',
)
// Validate compatibility before writes; the host overrides select one exact runtime artifact.
assert.ok(
  peerRange && semver.satisfies(runtimeManifest.version, peerRange),
  'The selected runtime artifact must satisfy the Markdown peer range',
)
assert.notEqual(manifest.peerDependenciesMeta?.['web-tree-sitter']?.optional, true)
assert.equal(manifest.dependencies?.['web-tree-sitter'], undefined)
assert.equal(typeof manifest.version, 'string')

const paths: string[] = [resolve(root, 'package.json')]
const siteManifest = resolve(root, 'site/package.json')
if (existsSync(siteManifest)) paths.push(siteManifest)
for await (const file of new Glob('packages/*/package.json').scan(root)) {
  paths.push(resolve(root, file))
}
if (workspaceRoot !== root) {
  paths.push(resolve(workspaceRoot, 'package.json'))
  const fixture = resolve(workspaceRoot, 'scripts/release/editor-fixture.json')
  if (existsSync(fixture)) paths.push(fixture)
}
const updates: { path: string; before: string; text: string }[] = []
for (const path of paths) {
  const before = await readFile(path, 'utf8')
  const text = before
    .replace(/github:ShaulLavo\/tree-sitter-x#[0-9a-f]+/g, runtime)
    .replace(/github:ShaulLavo\/tree-sitter-md#[0-9a-f]+/g, markdown)
  if (text !== before) updates.push({ path, before, text })
}
const catalogPath = resolve(root, 'packages/tree-sitter-languages/languages.json')
const catalogText = await readFile(catalogPath, 'utf8')
const catalog = JSON.parse(catalogText)
const source = catalog.sources['tree-sitter-md']
if (source.revision !== markdownRevision || source.version !== manifest.version) {
  source.revision = markdownRevision
  source.version = manifest.version
  updates.push({
    path: catalogPath,
    before: catalogText,
    text: `${JSON.stringify(catalog, null, 2)}\n`,
  })
}

if (updates.length === 0) {
  console.log(`Tree-sitter runtime and Markdown are at ${runtimeRevision} / ${markdownRevision}`)
} else {
  try {
    for (const { path, text } of updates) await writeFile(path, text)
    await $`bun install`.cwd(workspaceRoot)
    await $`bun run --cwd packages/tree-sitter-languages languages:generate`.cwd(root)
  } catch (cause) {
    // Restore source pins so the next run retries installation and generation for this same pair.
    for (const { path, before } of updates) await writeFile(path, before)
    throw cause
  }
  console.log(
    `Tree-sitter runtime and Markdown updated to ${runtimeRevision} / ${markdownRevision}`,
  )
}

async function remoteRevision(repository: string, ref: string): Promise<string> {
  const url = `https://github.com/ShaulLavo/${repository}`
  const output = (await $`git ls-remote ${url} ${ref}`.text()).trim()
  const [revision, resolvedRef] = output.split(/\s+/)
  assert.match(revision ?? '', /^[0-9a-f]{40}$/, 'Remote revisions must be full Git SHAs')
  assert.equal(resolvedRef, ref, 'The selected remote ref must exist')
  return revision!
}
