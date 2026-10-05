import assert from 'node:assert/strict'
import { cpSync, existsSync, mkdirSync, readFileSync, realpathSync, symlinkSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import * as v from 'valibot'

const manifestSchema = v.object({
  name: v.string(),
  version: v.string(),
  dependencies: v.optional(v.record(v.string(), v.string())),
  optionalDependencies: v.optional(v.record(v.string(), v.string())),
  peerDependencies: v.optional(v.record(v.string(), v.string())),
  peerDependenciesMeta: v.optional(
    v.record(v.string(), v.object({ optional: v.optional(v.boolean()) })),
  ),
})

interface Copies {
  readonly root: string
  readonly requested: ReadonlySet<string>
  readonly packages: Map<string, string>
}

function readManifest(file: string) {
  return v.parse(manifestSchema, JSON.parse(readFileSync(file, 'utf8')))
}

function findPackage(name: string, entry: string): string {
  let directory = path.dirname(realpathSync(entry))
  while (true) {
    const file = path.join(directory, 'package.json')
    if (existsSync(file) && readManifest(file).name === name) return directory
    const parent = path.dirname(directory)
    assert.notEqual(parent, directory, `The resolved entry must belong to ${name}`)
    directory = parent
  }
}

function packageDirectory(name: string, require: ReturnType<typeof createRequire>): string {
  try {
    return path.dirname(realpathSync(require.resolve(`${name}/package.json`)))
  } catch {
    return findPackage(name, require.resolve(name))
  }
}

function dependencies(
  metadata: v.InferOutput<typeof manifestSchema>,
  requested: ReadonlySet<string>,
) {
  const result = new Map(Object.keys(metadata.dependencies ?? {}).map((name) => [name, false]))
  for (const name of Object.keys(metadata.optionalDependencies ?? {})) result.set(name, true)
  for (const name of Object.keys(metadata.peerDependencies ?? {})) {
    const optional = metadata.peerDependenciesMeta?.[name]?.optional ?? false
    if (optional && !requested.has(name)) continue
    result.set(name, optional)
  }
  return result
}

function copyPackage(
  name: string,
  require: ReturnType<typeof createRequire>,
  copies: Copies,
): string {
  const source = packageDirectory(name, require)
  const existing = copies.packages.get(source)
  if (existing) return existing
  const target = path.join(copies.root, '.packages', String(copies.packages.size))
  copies.packages.set(source, target)
  cpSync(source, target, {
    recursive: true,
    filter: (file) => path.basename(file) !== 'node_modules',
  })
  const metadata = readManifest(path.join(source, 'package.json'))
  const sourceRequire = createRequire(path.join(source, 'package.json'))
  for (const [dependency, optional] of dependencies(metadata, copies.requested))
    copyDependency(dependency, optional, sourceRequire, target, copies)
  return target
}

function copyDependency(
  name: string,
  optional: boolean,
  require: ReturnType<typeof createRequire>,
  parent: string,
  copies: Copies,
) {
  let target: string
  try {
    target = copyPackage(name, require, copies)
  } catch (error) {
    if (optional && error instanceof Error && 'code' in error && error.code === 'MODULE_NOT_FOUND')
      return
    throw error
  }
  const entry = path.join(parent, 'node_modules', name)
  mkdirSync(path.dirname(entry), { recursive: true })
  symlinkSync(target, entry, process.platform === 'win32' ? 'junction' : 'dir')
}

export function copyDependencies(
  manifest: string,
  root: string,
  names: readonly string[],
): ReadonlyMap<string, string> {
  const require = createRequire(manifest)
  const copies: Copies = { root, requested: new Set(names), packages: new Map() }
  const versions = new Map<string, string>()
  for (const name of names) {
    copyDependency(name, false, require, root, copies)
    versions.set(name, readManifest(path.join(root, 'node_modules', name, 'package.json')).version)
  }
  return versions
}
