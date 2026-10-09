import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { BunPlugin } from 'bun'
import { runtimeWasmAssets } from '../src/core/assets.js'

export const sha256 = (bytes: string | Uint8Array) =>
  createHash('sha256').update(bytes).digest('hex')

export function framedInputHash(chunks: readonly Uint8Array[]): string {
  const digest = createHash('sha256')
  for (const chunk of chunks) digest.update(`${chunk.length}\0`).update(chunk)
  return digest.digest('hex')
}

export async function sourceInventory(root: string, paths: readonly string[]) {
  const files: Record<string, string> = {}
  const digest = createHash('sha256')
  for (const path of [...new Set(paths)].sort()) {
    const bytes = await readFile(join(root, path))
    files[path] = sha256(bytes)
    digest.update(path).update('\0').update(bytes).update('\0')
  }
  return { sha256: digest.digest('hex'), files }
}

export function checkoutFiles(root: string, patterns: readonly string[]): string[] {
  const list = (options: readonly string[]) =>
    execFileSync('git', ['ls-files', '-z', ...options, '--', ...patterns], {
      cwd: root,
      encoding: 'utf8',
    })
      .split('\0')
      .filter(Boolean)
  const deleted = new Set(list(['--deleted']))
  return list(['--cached', '--others', '--exclude-standard']).filter((path) => !deleted.has(path))
}

function runtimePlugin(root: string, extractedRoot: string): BunPlugin {
  const runtimeRoot = join(root, 'src') + sep
  return {
    name: 'comparison-runtime-ref',
    setup(build) {
      build.onResolve({ filter: /.*/ }, ({ path, importer }) => {
        if (!path.startsWith('.') && !isAbsolute(path)) return
        const absolute = resolve(importer ? resolve(importer, '..') : root, path)
        if (!absolute.startsWith(runtimeRoot)) return
        const relative = absolute.slice(root.length + 1).replace(/\.js$/, '.ts')
        return { path: join(extractedRoot, relative) }
      })
    },
  }
}

const packageRoot = fileURLToPath(new URL('../', import.meta.url))
const runtimeAssets = Object.entries(runtimeWasmAssets).map(([kind, url]) => {
  const path = relative(packageRoot, fileURLToPath(url)).split(sep).join('/')
  assert(
    path !== '..' && !path.startsWith('../') && !isAbsolute(path),
    'Runtime WASM must be inside its package',
  )
  return [kind === 'native' ? 'native.wasm' : path, path] as const
})
const runtimePaths = new Set(runtimeAssets.map(([, path]) => path))
const runtimePatterns = ['src', ...runtimePaths, 'package.json']

function isRuntimeInput(path: string): boolean {
  if (runtimePaths.has(path) || path === 'package.json') return true
  return path.startsWith('src/') && !path.endsWith('.wasm')
}

export function runtimeCheckoutFiles(root: string): string[] {
  return checkoutFiles(root, runtimePatterns).filter(isRuntimeInput)
}

export function assetMap(entries: readonly (readonly [string, string])[]): Record<string, string> {
  const assets: Record<string, string> = {}
  for (const [name, path] of entries) {
    assert(!Object.hasOwn(assets, name), `Comparison asset destination collision: ${name}`)
    assets[name] = path
  }
  return assets
}

async function runtimeInputs(root: string, paths: readonly string[]) {
  const metadata: { version?: unknown } = JSON.parse(
    await readFile(join(root, 'package.json'), 'utf8'),
  )
  assert(
    typeof metadata.version === 'string' && metadata.version.length > 0,
    'Runtime package metadata must contain a version',
  )
  assert(
    runtimeAssets.every(([, path]) => paths.includes(path)),
    'Runtime inputs must contain the declared WASM assets',
  )
  return {
    version: metadata.version,
    assets: assetMap(runtimeAssets.map(([name, path]) => [name, join(root, path)])),
    inventory: await sourceInventory(root, paths),
  }
}

export async function runtimeSource(root: string, ref?: string) {
  root = resolve(root)
  const git = (args: readonly string[], cwd: string = root) =>
    execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
  if (!ref) {
    return {
      mode: 'checkout' as const,
      commit: git(['rev-parse', 'HEAD']),
      dirty: git(['status', '--porcelain', '--', ...runtimePatterns]),
      ...(await runtimeInputs(root, runtimeCheckoutFiles(root))),
      plugins: [] as BunPlugin[],
      dispose: async () => {},
    }
  }
  assert(!ref.startsWith('-'), 'Runtime ref must name a Git revision')
  const commit = git(['rev-parse', '--verify', `${ref}^{commit}`])
  const prefix = git(['rev-parse', '--show-prefix'])
  const repository = git(['rev-parse', '--show-toplevel'])
  const inputPaths = execFileSync(
    'git',
    ['ls-tree', '-r', '-z', '--name-only', commit, '--', ...(prefix ? [prefix] : [])],
    { cwd: repository, encoding: 'utf8' },
  )
    .split('\0')
    .filter(Boolean)
    .filter((path) => isRuntimeInput(path.slice(prefix.length)))
  const paths = inputPaths.map((path) => path.slice(prefix.length))
  assert(
    paths.some((path) => path.startsWith('src/')),
    'Runtime ref must contain runtime src',
  )
  const scratchRoot = join(root, '.artifacts')
  await mkdir(scratchRoot, { recursive: true })
  const scratch = await mkdtemp(join(scratchRoot, 'comparison-runtime-'))
  const dispose = () => rm(scratch, { recursive: true, force: true })
  try {
    const archive = execFileSync('git', ['archive', commit, ...inputPaths], {
      cwd: repository,
      maxBuffer: 32 * 1024 * 1024,
    })
    execFileSync('tar', ['-x', '-f', '-', '-C', scratch], { input: archive })
    const extractedRoot = join(scratch, prefix)
    return {
      mode: 'git-ref' as const,
      ref,
      commit,
      dirty: '',
      ...(await runtimeInputs(extractedRoot, paths)),
      plugins: [runtimePlugin(root, extractedRoot)],
      dispose,
    }
  } catch (error) {
    await dispose()
    throw error
  }
}

export function comparisonBuildArguments(args: readonly string[], defaultOutput: string) {
  const refIndex = args.indexOf('--runtime-ref')
  const ref = refIndex < 0 ? undefined : args[refIndex + 1]
  assert(refIndex < 0 || (ref && !ref.startsWith('-')), '--runtime-ref needs a Git revision')
  const outputs = args.filter(
    (_, index) => refIndex < 0 || (index !== refIndex && index !== refIndex + 1),
  )
  assert(
    outputs.length <= 1 && outputs.every((arg) => !arg.startsWith('-')),
    'Expected output directory and optional --runtime-ref',
  )
  return { output: resolve(outputs[0] ?? defaultOutput), ref }
}
