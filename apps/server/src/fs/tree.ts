import { joinRelative } from './search-shared'
import { readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import {
  effectiveEntryType,
  isDirectoryEntry,
  matchesEntryType,
  type EntryTypeFilter,
  type FileTreeEntry,
  type FileTreeResult,
} from '@workspace/contracts'
import { FsError, mapNodeError } from './errors'
import { isIgnoredPath, resolveExistingPath, treeIgnoredNames, type WorkspacePaths } from './path'
import { assertDirectory, statPath } from './stat'

export type TreeReadOptions = {
  concurrency?: number
}

type TaskLimiter = <T>(task: () => Promise<T>) => Promise<T>

export async function readTree(
  paths: WorkspacePaths,
  input: string,
  depth = 1,
  entryType?: EntryTypeFilter,
  options: TreeReadOptions = {},
): Promise<FileTreeResult> {
  if (paths.isInternalPath(input)) throw new FsError('NOT_FOUND')
  const limit = createTaskLimiter(options.concurrency ?? 32)

  try {
    const target = await resolveExistingPath(paths, input)
    const stats = await stat(target.absolutePath)
    assertDirectory(stats)

    return {
      path: target.relativePath,
      entries: await readEntries(
        paths,
        target.absolutePath,
        target.relativePath,
        depth,
        entryType,
        limit,
      ),
    }
  } catch (error) {
    if (error instanceof FsError) throw error
    throw mapNodeError(error)
  }
}

async function readEntries(
  paths: WorkspacePaths,
  absoluteDirectory: string,
  relativeDirectory: string,
  depth: number,
  entryType: EntryTypeFilter | undefined,
  limit: TaskLimiter,
) {
  const dirents = await readdir(absoluteDirectory, { withFileTypes: true })
  const entries = await Promise.all(
    dirents.map((dirent) =>
      readEntry(paths, absoluteDirectory, relativeDirectory, dirent.name, depth, entryType, limit),
    ),
  )

  return entries.filter(isTreeEntry).sort(compareTreeEntries)
}

async function readEntry(
  paths: WorkspacePaths,
  absoluteDirectory: string,
  relativeDirectory: string,
  name: string,
  depth: number,
  entryType: EntryTypeFilter | undefined,
  limit: TaskLimiter,
) {
  const entry = await limit(() => readEntryMetadata(paths, relativeDirectory, name))
  if (!entry) return null

  if (!isDirectoryEntry(entry)) return matchingEntry(entry, entryType)
  if (depth <= 1) return matchingEntry(entry, entryType)

  entry.children = await readEntries(
    paths,
    path.join(absoluteDirectory, name),
    entry.path,
    depth - 1,
    entryType,
    limit,
  )
  return matchingEntry(entry, entryType)
}

async function readEntryMetadata(
  paths: WorkspacePaths,
  relativeDirectory: string,
  name: string,
): Promise<FileTreeEntry | null> {
  const relativePath = joinRelative(relativeDirectory, name)
  if (paths.isInternalPath(relativePath)) return null
  if (isIgnoredPath(relativePath, treeIgnoredNames)) return null

  const entryStats = await safeEntryStats(paths, relativePath)
  if (!entryStats) return null

  return {
    name,
    path: relativePath,
    type: entryStats.type,
    targetType: entryStats.targetType,
    size: entryStats.size,
    mtimeMs: entryStats.mtimeMs,
    birthtimeMs: entryStats.birthtimeMs,
    version: entryStats.version,
  } satisfies FileTreeEntry
}

async function safeEntryStats(paths: WorkspacePaths, relativePath: string) {
  try {
    return await statPath(paths, relativePath)
  } catch {
    return null
  }
}

function createTaskLimiter(concurrency: number): TaskLimiter {
  const max = Math.max(1, Math.floor(concurrency))
  const queue: Array<() => void> = []
  let active = 0

  return async (task) => {
    if (active >= max) await new Promise<void>((resolve) => queue.push(resolve))
    active += 1

    try {
      return await task()
    } finally {
      active -= 1
      queue.shift()?.()
    }
  }
}

function compareTreeEntries(a: FileTreeEntry, b: FileTreeEntry) {
  const aType = effectiveEntryType(a)
  const bType = effectiveEntryType(b)
  if (aType === 'directory' && bType !== 'directory') return -1
  if (aType !== 'directory' && bType === 'directory') return 1

  if (a.name < b.name) return -1
  if (a.name > b.name) return 1
  return 0
}

function matchingEntry(entry: FileTreeEntry, entryType?: EntryTypeFilter) {
  if (matchesEntryType(entry, entryType)) return entry

  return null
}

function isTreeEntry(entry: FileTreeEntry | null): entry is FileTreeEntry {
  return entry !== null
}
