import { existsSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import * as v from 'valibot'
import { RUNTIME_PACKAGES } from '../../apps/server/src/installation/release-files'
import { createScriptError } from '../structured-errors'
import { packageNotices } from './notices'

const server = path.resolve(import.meta.dirname, '../../apps/server')
const output = path.join(server, 'dist')
const files: string[] = []
for (const entry of readdirSync(output)) {
  if (!/\.(js|ts)$/.test(entry)) continue
  const source = readFileSync(path.join(output, entry), 'utf8')
  for (const match of source.matchAll(/^\/\/ (.*\/node_modules\/.*)$/gm))
    files.push(path.resolve(server, match[1]!))
}

const queue = RUNTIME_PACKAGES.map((name) => resolvePackage(server, name))
const visited = new Set<string>()
const dependenciesSchema = v.object({
  dependencies: v.optional(v.record(v.string(), v.string())),
  optionalDependencies: v.optional(v.record(v.string(), v.string())),
  peerDependencies: v.optional(v.record(v.string(), v.string())),
})
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
writeFileSync(
  path.join(output, 'THIRD_PARTY_NOTICES.txt'),
  'Server bundle and installed runtime dependencies\n\n' + packageNotices(files),
)

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
