import path from 'node:path'
import { realpathSync } from 'node:fs'
import { realpath } from 'node:fs/promises'
import { FsError } from './errors'

export const defaultIgnoredNames = [
  'node_modules',
  '.git',
  '.evlog',
  '.playwright-mcp',
  'logs',
  'dist',
  'build',
  '.next',
  '.cache',
  'coverage',
] as const

export const treeIgnoredNames = defaultIgnoredNames.filter((name) => name !== 'node_modules')

// Narrower than the tree's list: language servers and open files need rebuilt declarations in
// `dist` and `build` and a package arriving in `node_modules`, not its contents (VS Code's default).
export const watcherIgnoredNames = defaultIgnoredNames.filter(
  (name) => name !== 'node_modules' && name !== 'dist' && name !== 'build',
)

const ignoredNameSetCache = new WeakMap<readonly string[], ReadonlySet<string>>()

export type WorkspacePath = {
  absolutePath: string
  relativePath: string
}

export type WorkspacePaths = ReturnType<typeof createWorkspacePaths>

export type WorkspacePathsOptions = {
  excludedAbsolutePaths?: readonly string[]
  /** Directory names hidden wherever they appear, such as each drive's undo journal. */
  excludedNames?: readonly string[]
}

export async function resolveExistingPath(paths: WorkspacePaths, input: string) {
  const target = paths.resolve(input)
  const absolutePath = await realpath(target.absolutePath)
  paths.assertRealInside(absolutePath)

  return { absolutePath, relativePath: target.relativePath }
}

export function createWorkspacePaths(
  workspaceRootInput = process.cwd(),
  options: WorkspacePathsOptions = {},
) {
  const workspaceRoot = path.resolve(workspaceRootInput)
  const workspaceRootReal = realpathSync(workspaceRoot)
  const excludedAbsolutePaths = (options.excludedAbsolutePaths ?? []).map((input) =>
    path.resolve(input),
  )
  const internalNames = options.excludedNames ?? []

  return {
    internalAbsolutePaths: excludedAbsolutePaths,
    internalNames,
    workspaceRoot,
    workspaceRootReal,
    resolve(input = ''): WorkspacePath {
      const relativePath = normalizeClientPath(input)
      const absolutePath = path.resolve(workspaceRoot, relativePath)
      assertInside(workspaceRoot, absolutePath)

      return { absolutePath, relativePath }
    },
    toRelative(absolutePath: string) {
      assertInside(workspaceRoot, absolutePath)
      return toPosix(path.relative(workspaceRoot, absolutePath))
    },
    toRealRelative(absolutePath: string) {
      assertInside(workspaceRootReal, absolutePath)
      return toPosix(path.relative(workspaceRootReal, absolutePath))
    },
    assertInside(absolutePath: string) {
      assertInside(workspaceRoot, absolutePath)
    },
    assertRealInside(absolutePath: string) {
      assertInside(workspaceRootReal, absolutePath)
    },
    isInternalPath(input: string) {
      const relativePath = normalizeClientPath(input)
      if (relativePath.split('/').some((segment) => internalNames.includes(segment))) return true
      const absolutePath = path.resolve(workspaceRoot, relativePath)
      return excludedAbsolutePaths.some((excluded) => isSameOrDescendant(excluded, absolutePath))
    },
  }
}

export function isIgnoredPath(
  relativePath: string,
  ignoredNames: readonly string[] = defaultIgnoredNames,
) {
  const ignored = ignoredNameSet(ignoredNames)
  const parts = toPosix(relativePath).split('/')

  for (const part of parts) {
    if (!part) continue
    if (ignored.has(part)) return true
  }

  return false
}

export function toPosix(input: string) {
  return input.split(path.sep).join('/')
}

function normalizeClientPath(input: string) {
  assertClientPathShape(input)

  const normalized = path.posix.normalize(input || '.')
  if (normalized === '.') return ''
  if (normalized === '..') throw new FsError('PATH_OUTSIDE_WORKSPACE')
  if (normalized.startsWith('../')) throw new FsError('PATH_OUTSIDE_WORKSPACE')

  return normalized
}

function assertClientPathShape(input: string) {
  if (input.includes('\0')) throw new FsError('INVALID_PATH')
  if (input.includes('\\')) throw new FsError('INVALID_PATH')
  if (path.posix.isAbsolute(input)) throw new FsError('PATH_OUTSIDE_WORKSPACE')
  if (/^[a-zA-Z]:/.test(input)) throw new FsError('PATH_OUTSIDE_WORKSPACE')
}

/**
 * `path.relative` output, not a client path: it carries platform separators, so
 * the escape prefix is `..${path.sep}` rather than `'../'`. A bare `..` escapes;
 * `..foo` is an ordinary filename and must not be mistaken for one.
 */
export function isOutsideRoot(relative: string) {
  if (relative === '..') return true
  if (relative.startsWith(`..${path.sep}`)) return true

  return path.isAbsolute(relative)
}

function assertInside(root: string, candidate: string) {
  const relative = path.relative(root, candidate)
  if (relative === '') return
  if (isOutsideRoot(relative)) throw new FsError('PATH_OUTSIDE_WORKSPACE')
}

function isSameOrDescendant(root: string, candidate: string) {
  const relative = path.relative(root, candidate)
  if (relative === '') return true
  if (isOutsideRoot(relative)) return false

  return true
}

function ignoredNameSet(ignoredNames: readonly string[]) {
  const cached = ignoredNameSetCache.get(ignoredNames)
  if (cached) return cached

  const ignored = new Set(ignoredNames)
  ignoredNameSetCache.set(ignoredNames, ignored)
  return ignored
}
