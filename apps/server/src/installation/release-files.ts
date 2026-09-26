import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import * as v from 'valibot'
import { installationErrors } from './structured-errors'

/**
 * What the server bundle loads beside itself at runtime: the `build` script's `--external`s and
 * the `import.meta.resolve` targets. A release installs exactly these on each platform.
 */
export const RUNTIME_PACKAGES = [
  'sharp',
  '@anthropic-ai/claude-agent-sdk',
  'typescript',
  'typescript-language-server',
] as const

export const RUNTIME_MANIFEST = 'runtime/package.json'
export const RUNTIME_LOCK = 'runtime/bun.lock'
/** Built by the `build` script from `remote-support.ts`. */
export const REMOTE_SUPPORT = 'remote-support.js'
/** Built by the `build` script from `terminal-host/main.ts`; the server launches it for shells. */
export const PTY_HOST = 'pty-host.js'
/** Built by the `build` script; the bundle starts it as its native watch worker. */
export const WATCH_WORKER = 'watch-worker.ts'

// bun.lock keys a workspace's own resolution `<workspace>/<package>`; it wins over the hoisted one.
const SERVER_WORKSPACE = 'server'

const lockSchema = v.object({ packages: v.record(v.string(), v.unknown()) })
const lockEntrySchema = v.looseTuple([v.string()])

export function runtimeManifest(lockfile: string) {
  const { packages } = v.parse(lockSchema, Bun.JSONC.parse(lockfile))
  const dependencies: Record<string, string> = {}
  const missing: string[] = []
  for (const name of RUNTIME_PACKAGES) {
    const version = resolvedVersion(packages, name)
    if (version) dependencies[name] = version
    else missing.push(name)
  }
  if (missing.length > 0)
    throw installationErrors.RUNTIME_PACKAGE_MISSING({ packages: missing.join(', ') })
  return `${JSON.stringify({ name: 'platform-server-runtime', private: true, dependencies }, null, 2)}\n`
}

/** Writes `<server>/runtime/package.json`, and its lockfile for frozen runtime installation. */
export async function writeRuntimeManifest(serverDirectory: string, lockfilePath: string) {
  const lockfile = await readFile(lockfilePath, 'utf8')
  const manifest = runtimeManifest(lockfile)
  const file = path.join(serverDirectory, RUNTIME_MANIFEST)
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, manifest)
  await writeFile(path.join(serverDirectory, RUNTIME_LOCK), runtimeLock(lockfile, manifest))
  return file
}

/** The release files a built server directory lacks, relative to it. */
export async function missingReleaseFiles(serverDirectory: string) {
  const files = [RUNTIME_MANIFEST, RUNTIME_LOCK, REMOTE_SUPPORT, PTY_HOST, WATCH_WORKER]
  const present = await Promise.all(
    files.map((file) =>
      access(path.join(serverDirectory, file)).then(
        () => true,
        () => false,
      ),
    ),
  )
  return files.filter((_file, index) => !present[index])
}

function resolvedVersion(packages: Record<string, unknown>, name: string) {
  const entry = v.safeParse(
    lockEntrySchema,
    packages[`${SERVER_WORKSPACE}/${name}`] ?? packages[name],
  )
  if (!entry.success) return null
  const [spec] = entry.output
  const at = spec.lastIndexOf('@')
  return at > 0 ? spec.slice(at + 1) : null
}

function runtimeLock(lockfile: string, manifest: string) {
  const parsed = v.parse(
    v.object({
      lockfileVersion: v.number(),
      configVersion: v.optional(v.number()),
      packages: v.record(v.string(), v.unknown()),
    }),
    Bun.JSONC.parse(lockfile),
  )
  const packages: Record<string, unknown> = {}
  for (const [name, entry] of Object.entries(parsed.packages)) {
    const resolved = v.safeParse(lockEntrySchema, entry)
    if (!resolved.success || /@(workspace:|link:|file:)/.test(resolved.output[0])) continue
    packages[name] = entry
  }
  for (const [name, entry] of Object.entries(packages)) {
    if (!name.startsWith(`${SERVER_WORKSPACE}/`)) continue
    packages[name.slice(SERVER_WORKSPACE.length + 1)] = entry
    delete packages[name]
  }
  const root = v.parse(
    v.object({ name: v.string(), dependencies: v.record(v.string(), v.string()) }),
    JSON.parse(manifest),
  )
  return (
    JSON.stringify(
      {
        lockfileVersion: parsed.lockfileVersion,
        configVersion: parsed.configVersion,
        workspaces: { '': root },
        packages: reachablePackages(packages, Object.keys(root.dependencies)),
      },
      null,
      2,
    ) + '\n'
  )
}

const lockMetaSchema = v.looseTuple([
  v.string(),
  v.string(),
  v.optional(
    v.looseObject({
      dependencies: v.optional(v.record(v.string(), v.string())),
      optionalDependencies: v.optional(v.record(v.string(), v.string())),
      peerDependencies: v.optional(v.record(v.string(), v.string())),
    }),
  ),
])

// `bun install --frozen-lockfile` refuses a lock holding packages the manifest cannot reach.
export function reachablePackages(packages: Record<string, unknown>, roots: readonly string[]) {
  const kept = new Set<string>()
  const queue = roots.map((name) => ({ parent: [] as string[], name }))
  while (queue.length > 0) {
    const { parent, name } = queue.pop()!
    const key = lockKeyFor(packages, parent, name)
    if (!key || kept.has(key)) continue
    kept.add(key)
    const meta = v.safeParse(lockMetaSchema, packages[key])
    if (!meta.success) continue
    const { dependencies, optionalDependencies, peerDependencies } = meta.output[2] ?? {}
    const path = lockKeyPath(key)
    for (const dependency of Object.keys({
      ...dependencies,
      ...optionalDependencies,
      ...peerDependencies,
    }))
      queue.push({ parent: path, name: dependency })
  }
  return Object.fromEntries(Object.entries(packages).filter(([key]) => kept.has(key)))
}

// A nested resolution `a/b/dep` wins over `a/dep`, which wins over the hoisted `dep`.
function lockKeyFor(packages: Record<string, unknown>, parent: readonly string[], name: string) {
  for (let depth = parent.length; depth > 0; depth--) {
    const key = [...parent.slice(0, depth), name].join('/')
    if (key in packages) return key
  }
  return name in packages ? name : null
}

function lockKeyPath(key: string) {
  const path: string[] = []
  for (const segment of key.split('/')) {
    const scope = path.at(-1)
    if (scope?.startsWith('@') && !scope.includes('/'))
      path[path.length - 1] = `${scope}/${segment}`
    else path.push(segment)
  }
  return path
}
