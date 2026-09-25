import { lstat, realpath, stat, readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as v from 'valibot'

import { createStructuredError } from '../../observability/structured-errors'
import { spawnCommand } from '../installers'
import type { LspServerHandle } from '../registry'

export type TypeScriptRuntime = {
  readonly kind: 'native' | 'legacy'
  readonly entrypoint: string
  readonly version: string
}

const packageSchema = v.object({
  version: v.pipe(v.string(), v.regex(/^\d+\.\d+\.\d+(?:[-+].*)?$/u)),
  bin: v.optional(v.union([v.string(), v.record(v.string(), v.string())])),
})

const fallbackPackage = fileURLToPath(import.meta.resolve('typescript/package.json'))
const legacyAdapter = fileURLToPath(import.meta.resolve('typescript-language-server/lib/cli.mjs'))

export async function spawnTypeScript(root: string): Promise<LspServerHandle | null> {
  const runtime = await resolveTypeScriptRuntime(root)
  if (runtime.kind === 'native') {
    return spawnCommand([process.execPath, runtime.entrypoint, '--lsp', '--stdio'], { cwd: root })
  }

  const handle = await spawnCommand([process.execPath, legacyAdapter, '--stdio'], { cwd: root })
  if (!handle) return null
  return { ...handle, initializationOptions: { tsserver: { path: runtime.entrypoint } } }
}

export async function resolveTypeScriptRuntime(root: string): Promise<TypeScriptRuntime> {
  const packagePath =
    (await workspacePackage(root, 'typescript')) ??
    (await workspacePackage(root, '@typescript/native-preview')) ??
    fallbackPackage
  return runtimeForPackage(packagePath)
}

/** The command-line compiler of the same package the language server comes from. */
export async function resolveTypeScriptCompiler(root: string) {
  const runtime = await resolveTypeScriptRuntime(root)
  if (runtime.kind === 'native') return { ...runtime, compiler: runtime.entrypoint }

  const compiler = path.join(path.dirname(runtime.entrypoint), 'tsc.js')
  if (!(await fileExists(compiler))) {
    throw invalidRuntime(compiler, 'The TypeScript package has no command-line compiler.')
  }
  return { ...runtime, compiler }
}

async function workspacePackage(root: string, packageName: string): Promise<string | null> {
  const require = createRequire(path.join(path.resolve(root), 'package.json'))
  for (const directory of require.resolve.paths(packageName) ?? []) {
    const installed = path.join(directory, packageName)
    if (!(await pathExists(installed))) continue
    return packageManifest(installed)
  }
  return null
}

async function packageManifest(directory: string): Promise<string> {
  try {
    return await realpath(path.join(directory, 'package.json'))
  } catch (cause) {
    throw invalidRuntime(
      directory,
      'The installed TypeScript package has no readable package.json.',
      cause,
    )
  }
}

async function runtimeForPackage(packagePath: string): Promise<TypeScriptRuntime> {
  const metadata = await readPackage(packagePath)
  const directory = path.dirname(packagePath)
  const tsserver = path.join(directory, 'lib', 'tsserver.js')
  if (await fileExists(tsserver)) {
    return { kind: 'legacy', entrypoint: tsserver, version: metadata.version }
  }

  const bin = metadata.bin
  const command = typeof bin === 'string' ? bin : (bin?.tsc ?? bin?.tsgo)
  if (Number.parseInt(metadata.version, 10) < 7 || !command) {
    throw invalidRuntime(packagePath, 'This TypeScript package has no language server entrypoint.')
  }
  const entrypoint = path.resolve(directory, command)
  if (!(await fileExists(entrypoint))) {
    throw invalidRuntime(packagePath, 'The native TypeScript launcher is missing from the package.')
  }
  return { kind: 'native', entrypoint, version: metadata.version }
}

async function readPackage(packagePath: string) {
  try {
    return v.parse(packageSchema, JSON.parse(await readFile(packagePath, 'utf8')))
  } catch (cause) {
    throw invalidRuntime(
      packagePath,
      'The TypeScript package metadata is missing or malformed.',
      cause,
    )
  }
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    return (await stat(filePath)).isFile()
  } catch (cause) {
    if (hasCode(cause, 'ENOENT') || hasCode(cause, 'ENOTDIR')) return false
    throw invalidRuntime(filePath, 'The TypeScript entrypoint could not be inspected.', cause)
  }
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await lstat(filePath)
    return true
  } catch (cause) {
    if (hasCode(cause, 'ENOENT') || hasCode(cause, 'ENOTDIR')) return false
    throw invalidRuntime(filePath, 'The TypeScript package could not be inspected.', cause)
  }
}

function hasCode(value: unknown, code: string) {
  return value instanceof Error && 'code' in value && value.code === code
}

function invalidRuntime(packagePath: string, why: string, cause?: unknown) {
  return createStructuredError({
    code: 'LSP_TYPESCRIPT_RUNTIME_INVALID',
    status: 500,
    message: `Cannot start the installed TypeScript language server: ${packagePath}`,
    why,
    fix: "Reinstall this workspace's TypeScript package, including its optional dependencies.",
    internal: { packagePath },
    cause,
  })
}
