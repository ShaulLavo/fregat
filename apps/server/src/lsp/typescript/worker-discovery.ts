import type ts from 'typescript-language-service'
import path from 'node:path'
import * as v from 'valibot'
import { runBoundedProcess } from '../../git/utils/process'
import { lspErrors } from '../errors'
import { discoveryProcessError } from './worker-discovery-errors'

const resultSchema = v.object({
  config: v.string(),
  roots: v.array(v.string()),
  files: v.array(v.string()),
  options: v.custom<ts.CompilerOptions>(
    (value) => value !== null && typeof value === 'object' && !Array.isArray(value),
  ),
  runtime: v.object({
    kind: v.union([v.literal('native'), v.literal('legacy')]),
    version: v.string(),
  }),
})

const projectSchema = v.object({
  optionsVersion: v.string(),
  config: v.string(),
  roots: v.array(v.string()),
  watch: v.object({
    include: v.array(v.string()),
    exclude: v.array(v.string()),
    configFiles: v.array(v.string()),
    allowJs: v.boolean(),
  }),
})

export async function resolveWorkerProject(
  root: string,
  filesystemRoot: string,
  document: string,
  tsconfig?: string,
) {
  const result = await runDiscovery(root, filesystemRoot, document, 'resolve', tsconfig)
  return v.parse(projectSchema, JSON.parse(result))
}

export async function discoverWorkerProject(
  root: string,
  filesystemRoot: string,
  document: string,
  tsconfig?: string,
) {
  const result = await runDiscovery(root, filesystemRoot, document, 'list', tsconfig)
  return v.parse(resultSchema, JSON.parse(result))
}

async function runDiscovery(
  root: string,
  filesystemRoot: string,
  document: string,
  mode: 'resolve' | 'list',
  tsconfig?: string,
) {
  const result = await runBoundedProcess({
    argv: [process.execPath, path.join(import.meta.dirname, 'worker-discovery-process.ts')],
    cwd: root,
    input: JSON.stringify({ root, filesystemRoot, document, mode, tsconfig }),
    timeoutMs: 60_000,
    maxOutputBytes: 16 * 1024 * 1024,
  })
  if (result.limit)
    throw lspErrors.PROGRAM_LIST_LIMIT({ internal: { limit: result.limit, root, document } })
  if (result.exitCode !== 0) throw discoveryProcessError(result.stderr, { root, document })
  return result.stdout
}
