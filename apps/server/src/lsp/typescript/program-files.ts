import { discoverWorkerProject } from './worker-discovery'
import { stat } from 'node:fs/promises'
import path from 'node:path'
import * as v from 'valibot'

import { pathSchema } from '../../fs/contracts'
import { FsError, mapNodeError } from '../../fs/errors'
import type { FsMetadataStore } from '../../fs/metadata'
import { isOutsideRoot, resolveExistingPath, type WorkspacePaths } from '../../fs/path'
import { readTextFile } from '../../fs/read'
import { runBoundedProcess } from '../../git/utils/process'
import { observeRequestOperation } from '../../observability'
import { lspErrors } from '../errors'
import { resolveTypeScriptCompiler, type TypeScriptRuntime } from './runtime'

const LIST_TIMEOUT_MS = 60_000
const LIST_MAX_OUTPUT_BYTES = 64 * 1024 * 1024
const READ_CONCURRENCY = 32
const LIBRARY_FILE = /^lib(\.[\w.-]+)?\.d\.ts$/

export const programFilesQuerySchema = v.object({
  root: pathSchema,
  tsconfig: v.optional(pathSchema),
  file: v.optional(pathSchema),
  worker: v.optional(v.literal('true')),
})

export const programFilesReadBodySchema = v.object({
  paths: v.pipe(v.array(pathSchema), v.maxLength(50_000)),
})

export type ProgramFileSystem = {
  readonly paths: WorkspacePaths
  readonly metadata: Pick<FsMetadataStore, 'workspaceAddressForDirectory'>
  readonly maxTextFileBytes: number
}

type ProgramFile = { readonly path: string; readonly size: number; readonly canonicalPath?: string }

type ProgramFileList = {
  readonly root: string
  readonly tsconfig: string
  readonly runtime: Pick<TypeScriptRuntime, 'kind' | 'version'>
  readonly files: readonly ProgramFile[]
  readonly totals: { readonly files: number; readonly bytes: number }
  /** The worker ships its own standard library; `outside` is what `/fs/read` refuses. */
  readonly skipped: { readonly library: number; readonly outside: number; readonly missing: number }
}

type ProgramFileText = {
  readonly path: string
  readonly content: string
  readonly size: number
  readonly version: string
}

type ProgramFileFailure = { readonly path: string; readonly code: string }

type ProgramFileTexts = {
  readonly files: readonly ProgramFileText[]
  readonly failed: readonly ProgramFileFailure[]
  readonly totals: { readonly files: number; readonly bytes: number }
}

type ListedEntry = ProgramFile | 'library' | 'outside' | 'missing'

type ProgramFilesQuery = v.InferOutput<typeof programFilesQuerySchema>

export function listProgramFiles(fs: ProgramFileSystem, query: ProgramFilesQuery) {
  return observeRequestOperation(
    {
      area: 'lsp',
      operation: 'typescript_program_files',
      rootPath: query.root,
      tsconfigPath: query.tsconfig,
    },
    () => listObserved(fs, query),
    (result) => ({
      fileCount: result.totals.files,
      totalBytes: result.totals.bytes,
      skippedLibrary: result.skipped.library,
      skippedOutside: result.skipped.outside,
      skippedMissing: result.skipped.missing,
      runtimeKind: result.runtime.kind,
      runtimeVersion: result.runtime.version,
    }),
  )
}

/** Each file goes through the same checks as `GET /fs/read`; a refusal fails that file only. */
export function readProgramFiles(fs: ProgramFileSystem, paths: readonly string[]) {
  return observeRequestOperation(
    { area: 'lsp', operation: 'typescript_program_read', requestedCount: paths.length },
    () => readObserved(fs, paths),
    (result) => ({
      fileCount: result.totals.files,
      totalBytes: result.totals.bytes,
      failedCount: result.failed.length,
      failedCodes: [...new Set(result.failed.map((failure) => failure.code))],
    }),
  )
}

async function listObserved(fs: ProgramFileSystem, query: ProgramFilesQuery) {
  const root = await openWorkspaceRoot(fs, query.root)
  const project =
    query.worker === 'true' && query.file
      ? await discoverWorkerProject(root.absolutePath, fs.paths.workspaceRootReal, query.file)
      : null
  const configPath = project ? fs.paths.toRealRelative(project.config) : query.tsconfig
  if (!configPath)
    throw lspErrors.PROGRAM_LIST_FAILED({
      internal: { root: query.root, reason: 'Missing project configuration' },
    })
  const tsconfig = await projectFile(fs.paths, root.absolutePath, configPath)
  const compiler = project?.runtime ?? (await resolveTypeScriptCompiler(root.absolutePath))
  const sourceFiles =
    project?.files ??
    (await listFilesOnly(
      await resolveTypeScriptCompiler(root.absolutePath),
      root.absolutePath,
      tsconfig.absolutePath,
    ))
  const libraryDirectories = new Map<string, Promise<boolean>>()
  const entries = await Promise.all(
    sourceFiles.map((file) => listedEntry(fs.paths, file, libraryDirectories)),
  )
  const files = entries.filter((entry) => typeof entry !== 'string')

  return {
    ...(project ? { worker: { compilerOptions: project.options, roots: project.roots } } : {}),
    root: root.relativePath,
    tsconfig: tsconfig.relativePath,
    runtime: { kind: compiler.kind, version: compiler.version },
    files,
    totals: { files: files.length, bytes: files.reduce((sum, file) => sum + file.size, 0) },
    skipped: {
      library: entries.filter((entry) => entry === 'library').length,
      outside: entries.filter((entry) => entry === 'outside').length,
      missing: entries.filter((entry) => entry === 'missing').length,
    },
  } satisfies ProgramFileList
}

async function openWorkspaceRoot(fs: ProgramFileSystem, input: string) {
  const root = await existingPath(fs.paths, input)
  const stats = await stat(root.absolutePath)
  if (!stats.isDirectory()) throw new FsError('NOT_A_DIRECTORY')

  const address = fs.metadata.workspaceAddressForDirectory(
    fs.paths.workspaceRootReal,
    root.absolutePath,
  )
  if (!address) throw lspErrors.PROGRAM_ROOT_NOT_OPEN({ internal: { rootPath: input } })
  return root
}

async function projectFile(paths: WorkspacePaths, root: string, input: string) {
  const tsconfig = await existingPath(paths, input)
  if (isOutsideRoot(path.relative(root, tsconfig.absolutePath))) {
    throw lspErrors.PROGRAM_TSCONFIG_OUTSIDE_ROOT({
      internal: { rootPath: paths.toRealRelative(root), tsconfigPath: input },
    })
  }
  if (!(await stat(tsconfig.absolutePath)).isFile()) throw new FsError('NOT_A_FILE')
  return tsconfig
}

async function existingPath(paths: WorkspacePaths, input: string) {
  try {
    return await resolveExistingPath(paths, input)
  } catch (error) {
    if (error instanceof FsError) throw error
    throw mapNodeError(error)
  }
}

async function listFilesOnly(
  compiler: TypeScriptRuntime & { readonly compiler: string },
  root: string,
  tsconfig: string,
) {
  const result = await runBoundedProcess({
    argv: [process.execPath, compiler.compiler, '-p', tsconfig, '--listFilesOnly'],
    cwd: root,
    maxOutputBytes: LIST_MAX_OUTPUT_BYTES,
    timeoutMs: LIST_TIMEOUT_MS,
  })
  if (result.limit) {
    throw lspErrors.PROGRAM_LIST_LIMIT({
      internal: { limit: result.limit, runtimeVersion: compiler.version },
    })
  }

  // A config error still lists the files it could; only an empty list is a failure.
  const lines = result.stdout.split('\n')
  const files = lines.filter((line) => path.isAbsolute(line))
  if (files.length > 0) return files

  throw lspErrors.PROGRAM_LIST_FAILED({
    internal: {
      exitCode: result.exitCode,
      diagnosticCodes: lines.flatMap((line) => line.match(/\bTS\d+\b/) ?? []),
      runtimeKind: compiler.kind,
      runtimeVersion: compiler.version,
    },
  })
}

async function listedEntry(
  paths: WorkspacePaths,
  absolutePath: string,
  libraryDirectories: Map<string, Promise<boolean>>,
): Promise<ListedEntry> {
  if (await isLibraryFile(absolutePath, libraryDirectories)) return 'library'

  const relativePath = workspaceRelative(paths, absolutePath)
  if (relativePath === null) return 'outside'
  try {
    const target = await resolveExistingPath(paths, relativePath)
    const stats = await stat(target.absolutePath)
    if (!stats.isFile()) return 'missing'
    const canonicalPath = paths.toRealRelative(target.absolutePath)
    return {
      path: relativePath,
      size: stats.size,
      ...(canonicalPath === relativePath ? {} : { canonicalPath }),
    }
  } catch (error) {
    if (error instanceof FsError) return 'outside'
    return 'missing'
  }
}

/** A standard library file sits beside `lib.es5.d.ts` in the compiler's own directory. */
function isLibraryFile(absolutePath: string, libraryDirectories: Map<string, Promise<boolean>>) {
  if (!LIBRARY_FILE.test(path.basename(absolutePath))) return false

  const directory = path.dirname(absolutePath)
  const cached = libraryDirectories.get(directory)
  if (cached) return cached

  const answer = stat(path.join(directory, 'lib.es5.d.ts')).then(
    (stats) => stats.isFile(),
    () => false,
  )
  libraryDirectories.set(directory, answer)
  return answer
}

/** The compiler prints real paths; the workspace root itself may be reached through a link. */
function workspaceRelative(paths: WorkspacePaths, absolutePath: string) {
  for (const toRelative of [paths.toRelative, paths.toRealRelative]) {
    try {
      return toRelative(absolutePath)
    } catch {
      continue
    }
  }
  return null
}

async function readObserved(fs: ProgramFileSystem, paths: readonly string[]) {
  const files: ProgramFileText[] = []
  const failed: ProgramFileFailure[] = []
  let next = 0
  const worker = async () => {
    for (let index = next++; index < paths.length; index = next++) {
      const outcome = await readOne(fs, paths[index] ?? '')
      if ('content' in outcome) files.push(outcome)
      else failed.push(outcome)
    }
  }
  await Promise.all(Array.from({ length: READ_CONCURRENCY }, worker))

  const bytes = files.reduce((sum, file) => sum + file.size, 0)
  return { files, failed, totals: { files: files.length, bytes } } satisfies ProgramFileTexts
}

async function readOne(
  fs: ProgramFileSystem,
  filePath: string,
): Promise<ProgramFileText | ProgramFileFailure> {
  try {
    // The compiler already read these as source; a NUL inside a string literal is not a binary file.
    const read = await readTextFile(fs.paths, filePath, fs.maxTextFileBytes)
    return { path: filePath, content: read.content, size: read.size, version: read.version }
  } catch (error) {
    if (error instanceof FsError) return { path: filePath, code: error.code }
    throw error
  }
}
