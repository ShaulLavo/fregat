import { existsSync, readFileSync, realpathSync } from 'node:fs'
import path from 'node:path'
import * as v from 'valibot'
import { RUNTIME_PACKAGES } from '../../apps/server/src/installation/release-files'
import { createScriptError } from '../structured-errors'

export function runtimePackageFiles(repository: string) {
  const files: string[] = []
  const owners = ['apps/server', 'packages/push'].map((directory) => {
    const root = path.join(repository, directory)
    const metadata = v.parse(
      dependenciesSchema,
      JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')),
    )
    return { root, dependencies: metadata.dependencies ?? {} }
  })
  const queue = RUNTIME_PACKAGES.map((name) => {
    const owner = owners.find(({ dependencies }) => name in dependencies)
    if (!owner)
      throw createScriptError(`Cannot find the owning workspace of runtime package ${name}.`)
    return resolvePackage(owner.root, name)
  })
  const visited = new Set<string>()
  while (queue.length) {
    const root = queue.pop()!
    if (visited.has(root)) continue
    visited.add(root)
    files.push(path.join(root, 'package.json'))
    const metadata = v.parse(
      dependenciesSchema,
      JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')),
    )
    for (const name of Object.keys(metadata.dependencies ?? {}))
      queue.push(resolvePackage(root, name))
    for (const name of Object.keys({
      ...metadata.optionalDependencies,
      ...metadata.peerDependencies,
    })) {
      const resolved = findPackage(root, name)
      if (resolved) queue.push(resolved)
    }
  }
  return files
}

const dependenciesSchema = v.object({
  dependencies: v.optional(v.record(v.string(), v.string())),
  optionalDependencies: v.optional(v.record(v.string(), v.string())),
  peerDependencies: v.optional(v.record(v.string(), v.string())),
})
function resolvePackage(from: string, name: string) {
  const root = findPackage(from, name)
  if (root) return root
  throw createScriptError(`Cannot find runtime package ${name} while generating notices.`)
}

function findPackage(from: string, name: string): string | null {
  for (
    let directory = from;
    directory !== path.dirname(directory);
    directory = path.dirname(directory)
  ) {
    const candidate = path.join(directory, 'node_modules', name)
    if (existsSync(path.join(candidate, 'package.json'))) return realpathSync(candidate)
  }
  return null
}
