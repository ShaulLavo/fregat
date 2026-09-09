import type { Stats } from 'node:fs'
import { lstat, realpath, stat } from 'node:fs/promises'
import path from 'node:path'
import type {
  EntryTypeCarrier,
  EntryTypeFilter,
  FileSystemEntryMetadata,
} from '@workspace/contracts'
import { FsError, mapNodeError } from './errors'
import { resolveExistingPath, type WorkspacePaths } from './path'
import { fileVersion } from './version'

export type FsEntryStats = EntryTypeCarrier & {
  displayStats: Stats
  targetStats: Stats
}

export async function statPath(
  paths: WorkspacePaths,
  input: string,
): Promise<FileSystemEntryMetadata> {
  const target = paths.resolve(input)

  try {
    const entryStats = await containedEntryStats(paths, target.relativePath)
    const canonicalPath = await canonicalEntryPath(paths, target, entryStats)

    return {
      canonicalPath,
      path: target.relativePath,
      type: entryStats.type,
      targetType: entryStats.targetType,
      size: Number(entryStats.targetStats.size),
      mtimeMs: Number(entryStats.targetStats.mtimeMs),
      birthtimeMs: Number(entryStats.targetStats.birthtimeMs),
      version: fileVersion(entryStats.targetStats),
    }
  } catch (error) {
    if (error instanceof FsError) throw error
    throw mapNodeError(error)
  }
}

async function containedEntryStats(paths: WorkspacePaths, relativePath: string) {
  if (!relativePath) return readEntryStats(paths.workspaceRootReal)

  const parent = await resolveExistingPath(paths, path.posix.dirname(relativePath))
  const absolutePath = path.join(parent.absolutePath, path.posix.basename(relativePath))
  const entryStats = await readEntryStats(absolutePath)
  if (!entryStats.targetType) return entryStats

  try {
    paths.assertRealInside(await realpath(absolutePath))
    return entryStats
  } catch (error) {
    if (!(error instanceof FsError)) throw error
    if (error.code !== 'PATH_OUTSIDE_WORKSPACE') throw error

    return {
      displayStats: entryStats.displayStats,
      targetStats: entryStats.displayStats,
      type: entryStats.type,
    } satisfies FsEntryStats
  }
}

async function canonicalEntryPath(
  paths: WorkspacePaths,
  target: ReturnType<WorkspacePaths['resolve']>,
  stats: FsEntryStats,
) {
  if (stats.type === 'symlink') return target.relativePath

  return paths.toRealRelative(await realpath(target.absolutePath))
}

export async function readEntryStats(absolutePath: string) {
  const displayStats = await lstat(absolutePath)
  const type = typeFromStats(displayStats)
  if (!displayStats.isSymbolicLink()) {
    return {
      displayStats,
      targetStats: displayStats,
      type,
    } satisfies FsEntryStats
  }

  const targetStats = await statTargetOptional(absolutePath)
  if (!targetStats) {
    return {
      displayStats,
      targetStats: displayStats,
      type,
    } satisfies FsEntryStats
  }

  return {
    displayStats,
    targetStats,
    type,
    targetType: typeFromStats(targetStats),
  } satisfies FsEntryStats
}

function typeFromStats(stats: Stats): EntryTypeFilter {
  if (stats.isFile()) return 'file'
  if (stats.isDirectory()) return 'directory'
  if (stats.isSymbolicLink()) return 'symlink'

  return 'other'
}

export function assertFile(stats: Stats) {
  if (stats.isFile()) return
  throw new FsError('NOT_A_FILE')
}

export function assertDirectory(stats: Stats) {
  if (stats.isDirectory()) return
  throw new FsError('NOT_A_DIRECTORY')
}

async function statTargetOptional(absolutePath: string) {
  try {
    return await stat(absolutePath)
  } catch {
    return null
  }
}
