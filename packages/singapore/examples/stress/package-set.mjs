import { createHash } from 'node:crypto'
import { cp, mkdir, readdir, readFile, realpath, stat, symlink, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, resolve, relative, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { fail } from './errors.mjs'

const manifestName = 'package-set.json'
const digest = (value) => createHash('sha256').update(value).digest('hex')
// Vite's production browser build also enables import and default during export resolution.
const browserConditions = new Set(['browser', 'module', 'production', 'import', 'default'])

function exportEntries(exports) {
  if (typeof exports === 'string' || Array.isArray(exports)) return [['.', exports]]
  if (!exports || typeof exports !== 'object') fail('Invalid frozen package exports')
  const keys = Object.keys(exports)
  if (keys.every((key) => !key.startsWith('.'))) return [['.', exports]]
  if (keys.some((key) => !key.startsWith('.'))) fail('Mixed frozen export conditions and subpaths')
  return Object.entries(exports)
}

function browserExport(target) {
  if (typeof target === 'string' || target === null) return target
  if (Array.isArray(target)) {
    for (const candidate of target) {
      const entry = browserExport(candidate)
      if (typeof entry === 'string') return entry
    }
    return undefined
  }
  if (typeof target !== 'object') fail('Invalid frozen export target')
  for (const [condition, candidate] of Object.entries(target)) {
    if (!browserConditions.has(condition)) continue
    const entry = browserExport(candidate)
    if (entry !== undefined) return entry
  }
  return undefined
}

function frozenAlias(specifier, replacement, reason) {
  const escaped = specifier
    .split('*')
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('([^?#]*)')
  const alias = {
    // Leave Vite's asset queries on the replacement while matching the complete export name.
    find: new RegExp(`^${escaped}(?=$|[?#])`),
    replacement: replacement.replaceAll('*', '$1'),
  }
  if (reason) alias.reason = reason
  return alias
}

function exportOrder(left, right) {
  const leftPattern = left.specifier.indexOf('*')
  const rightPattern = right.specifier.indexOf('*')
  if (leftPattern < 0) return rightPattern < 0 ? 0 : -1
  if (rightPattern < 0) return 1
  return rightPattern - leftPattern || right.specifier.length - left.specifier.length
}

async function hashDirectory(directory) {
  const hash = createHash('sha256')
  const entries = await readdir(directory, { recursive: true, withFileTypes: true })
  const files = []
  for (const entry of entries) {
    if (entry.isSymbolicLink())
      fail(`Frozen package content contains a symbolic link: ${directory}`)
    if (entry.isFile()) files.push(resolve(entry.parentPath, entry.name))
  }
  for (const path of files.sort())
    hash.update(relative(directory, path).split(sep).join('/')).update(await readFile(path))
  return hash.digest('hex')
}

async function inspectPackage(directory, folder) {
  const manifest = JSON.parse(await readFile(resolve(directory, 'package.json'), 'utf8'))
  if (
    !manifest.name?.startsWith('@singapore-editor/') ||
    !exportEntries(manifest.exports).some(([subpath]) => subpath === '.')
  )
    fail(`Editor package requires its public exports: ${folder}`)
  const require = createRequire(resolve(directory, 'package.json'))
  const links = Object.fromEntries(
    Object.keys(manifest.dependencies ?? {})
      .sort()
      .map((name) => {
        try {
          return [name, require.resolve(name)]
        } catch {
          return [name, 'no root entry; subpath exports only']
        }
      }),
  )
  return {
    folder,
    name: manifest.name,
    version: manifest.version,
    exports: manifest.exports,
    manifestHash: digest(await readFile(resolve(directory, 'package.json'))),
    sourceHash: await hashDirectory(resolve(directory, 'src')),
    buildHash: await hashDirectory(resolve(directory, 'dist')),
    links,
  }
}

async function hashPackageFiles(root) {
  const hash = createHash('sha256')
  const entries = await readdir(root, { recursive: true, withFileTypes: true })
  const files = entries
    .filter((entry) => entry.isFile() || entry.isSymbolicLink())
    .map((entry) => resolve(entry.parentPath, entry.name))
    .filter((path) => !relative(root, path).split(sep).includes('node_modules'))
    .sort()
  for (const path of files)
    hash.update(relative(root, path).split(sep).join('/')).update(await readFile(path))
  return { files: files.length, sha256: hash.digest('hex') }
}

// The package directory a bare specifier finds from `from`: the nearest node_modules/<name>, as
// bundlers locate packages. This does not depend on a package's exports map.
async function externalRoot(from, name) {
  for (let directory = from; ; directory = dirname(directory)) {
    const candidate = resolve(directory, 'node_modules', name)
    const manifest = await readFile(resolve(candidate, 'package.json'), 'utf8').catch(() => null)
    // Node does not check the found package's own name, so aliases (npm:typescript@…) resolve too.
    if (manifest) return realpath(candidate)
    if (directory === dirname(directory)) return null
  }
}

/**
 * Bytes of every external package the frozen Editor packages resolve, transitively. Editor
 * packages are skipped: their own identity is the frozen src/dist/package.json.
 */
export async function externalReceipt(
  directory,
  folders,
  seeds = [],
  { includePeers = false } = {},
) {
  const pending = [...seeds]
  for (const folder of folders) {
    const manifest = JSON.parse(await readFile(resolve(directory, folder, 'package.json'), 'utf8'))
    for (const name of Object.keys({
      ...manifest.dependencies,
      ...manifest.optionalDependencies,
      ...(includePeers ? manifest.peerDependencies : {}),
    }))
      pending.push({ from: resolve(directory, folder), name })
  }
  const packages = new Map()
  const unresolved = new Set()
  while (pending.length) {
    const { from, name } = pending.pop()
    if (name.startsWith('@singapore-editor/')) continue
    const root = await externalRoot(from, name)
    if (!root) {
      unresolved.add(name)
      continue
    }
    if (packages.has(root)) continue
    const manifest = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'))
    packages.set(root, {
      name: manifest.name,
      ...(manifest.name === name ? {} : { alias: name }),
      version: manifest.version,
      root,
      ...(await hashPackageFiles(root)),
    })
    for (const dependency of Object.keys({
      ...manifest.dependencies,
      ...manifest.optionalDependencies,
      ...(includePeers ? manifest.peerDependencies : {}),
    }))
      pending.push({ from: root, name: dependency })
  }
  const list = [...packages.values()].sort(
    (a, b) => a.name.localeCompare(b.name) || a.root.localeCompare(b.root),
  )
  const identity = list.map(({ name, version, files, sha256 }) => ({
    name,
    version,
    files,
    sha256,
  }))
  return {
    policy: includePeers
      ? 'transitive dependencies, optionalDependencies and peerDependencies of every seeded execution package; every file of each resolved package root except nested node_modules'
      : 'transitive dependencies and optionalDependencies of every frozen package, resolved from the frozen package directory; every file of each resolved package root except nested node_modules',
    packages: list,
    unresolved: [...unresolved].sort(),
    sha256: digest(JSON.stringify({ identity, unresolved: [...unresolved].sort() })),
  }
}

export async function freezePackageSet(source, destination, origin) {
  const directory = resolve(destination)
  await mkdir(directory)
  const folders = (await readdir(source, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
  const packages = []
  for (const folder of folders) {
    const input = resolve(source, folder)
    const output = resolve(directory, folder)
    const identity = await inspectPackage(input, folder)
    await mkdir(output)
    for (const path of ['src', 'dist', 'package.json'])
      await cp(resolve(input, path), resolve(output, path), { recursive: true })
    if ((await stat(resolve(input, 'node_modules')).catch(() => null))?.isDirectory())
      await symlink(resolve(input, 'node_modules'), resolve(output, 'node_modules'), 'dir')
    packages.push(identity)
  }
  if (!packages.some((entry) => entry.name === '@singapore-editor/core'))
    fail('Frozen package set has no core')
  const external = await externalReceipt(
    directory,
    packages.map((entry) => entry.folder),
  )
  const manifest = { schemaVersion: 2, origin, packages, external }
  await writeFile(resolve(directory, manifestName), JSON.stringify(manifest, null, 2) + '\n')
  return loadPackageSet(directory)
}

export async function loadPackageSet(path) {
  const directory = resolve(path)
  const manifest = JSON.parse(await readFile(resolve(directory, manifestName), 'utf8'))
  if (
    manifest.schemaVersion !== 2 ||
    !Array.isArray(manifest.packages) ||
    !manifest.packages.length
  )
    fail('Invalid frozen Editor package set')
  const actualFolders = (await readdir(directory, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
  if (
    JSON.stringify(actualFolders) !==
    JSON.stringify(manifest.packages.map((entry) => entry.folder).sort())
  )
    fail('Frozen package set membership changed')
  const aliasEntries = []
  const skippedExports = []
  for (const expected of manifest.packages) {
    const packageDirectory = resolve(directory, expected.folder)
    const actual = await inspectPackage(packageDirectory, expected.folder)
    for (const key of ['name', 'version', 'manifestHash', 'sourceHash', 'buildHash'])
      if (actual[key] !== expected[key]) fail(`Frozen package ${expected.name} changed ${key}`)
    if (JSON.stringify(actual.links) !== JSON.stringify(expected.links))
      fail(`Frozen package ${expected.name} resolves its dependencies elsewhere`)
    for (const [subpath, target] of exportEntries(actual.exports)) {
      const entry = browserExport(target)
      const specifier = expected.name + (subpath === '.' ? '' : subpath.slice(1))
      if (entry == null) {
        const reason = `No target for ${[...browserConditions].join(', ')} conditions`
        skippedExports.push({ specifier, reason })
        aliasEntries.push({ specifier, alias: frozenAlias(specifier, specifier, reason) })
        continue
      }
      if (!entry.startsWith('./dist/'))
        fail(`Unsupported frozen export: ${expected.name}${subpath}`)
      const replacement = resolve(packageDirectory, entry)
      if (!replacement.startsWith(resolve(packageDirectory, 'dist') + sep))
        fail('Frozen export escapes dist')
      if (!subpath.includes('*') && !(await stat(replacement)).isFile())
        fail(`Missing frozen export: ${specifier}`)
      aliasEntries.push({ specifier, alias: frozenAlias(specifier, replacement) })
    }
  }
  const aliases = aliasEntries.sort(exportOrder).map(({ alias }) => alias)
  const external = await externalReceipt(
    directory,
    manifest.packages.map((entry) => entry.folder),
  )
  if (external.sha256 !== manifest.external?.sha256) {
    const changed = external.packages
      .filter(
        (entry) =>
          !manifest.external?.packages.some(
            (recorded) => recorded.root === entry.root && recorded.sha256 === entry.sha256,
          ),
      )
      .map((entry) => `${entry.name}@${entry.version}`)
    fail(
      `Frozen external dependencies changed: ${changed.join(', ') || 'membership or resolution'}`,
    )
  }
  return {
    directory,
    aliases,
    skippedExports,
    manifest,
    externalHash: external.sha256,
    sourceHash: digest(
      JSON.stringify(
        manifest.packages.map(({ name, sourceHash, manifestHash }) => ({
          name,
          sourceHash,
          manifestHash,
        })),
      ),
    ),
    buildHash: digest(
      JSON.stringify(manifest.packages.map(({ name, buildHash }) => ({ name, buildHash }))),
    ),
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [source, destination, commit, dirtyDiffHash, lockHash] = process.argv.slice(2)
  if (!source || !destination || !commit || !dirtyDiffHash || !lockHash)
    fail(
      'Usage: package-set.mjs source-packages frozen-directory commit dirty-diff-sha256 lock-sha256',
    )
  const set = await freezePackageSet(source, destination, { commit, dirtyDiffHash, lockHash })
  console.log(
    JSON.stringify({
      directory: set.directory,
      sourceHash: set.sourceHash,
      buildHash: set.buildHash,
      packages: set.manifest.packages.length,
      skippedExports: set.skippedExports,
    }),
  )
}
