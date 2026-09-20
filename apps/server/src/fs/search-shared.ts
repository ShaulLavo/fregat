import type { WorkspaceIndex } from './workspace-index'
import path from 'node:path'

import type {
  WorkspaceSearchMatcher,
  WorkspaceSearchMatch,
  WorkspaceSearchQuery,
  WorkspaceSearchWarningEvent,
} from '@workspace/contracts'
import { fuzzyRank, workspaceSearchPreview } from '@workspace/contracts'

import { isIgnoredPath, toPosix } from './path'
import type { SearchMeasurementRecorder } from './search-measurement'
import { readEntryStats, type FsEntryStats } from './stat'
import type { GitIgnoreMatcher } from './search-gitignore'
import type { WorkspacePaths } from './path'

export type FindOptions = WorkspaceSearchQuery & {
  maxContentBytes: number
}

export type FindMatch = WorkspaceSearchMatch

export type FindContext = {
  root: {
    absolutePath: string
    relativePath: string
  }
  query: string
  matcher: WorkspaceSearchMatcher
  measurement: SearchMeasurementRecorder
  options: FindOptions
  paths: WorkspacePaths
  gitIgnore: GitIgnoreMatcher
  statCache: SearchStatCache
  warnings: WorkspaceSearchWarningEvent[]
}

export type SearchStatCache = Map<string, Promise<FsEntryStats | null>>

export function searchMatchMode(options: FindOptions) {
  return options.matchMode ?? 'literal'
}

export function shouldSearchContent(options: FindOptions) {
  if (searchMatchMode(options) === 'fuzzy') return false
  if (!options.includeContent) return false
  if (queryHasLineBreak(options.query)) return false
  if (options.entryType && options.entryType !== 'file') return false

  return true
}

// `rg` is invoked line-oriented and every fallback matcher works one line at a
// time, so a query spanning lines cannot match anything anywhere. Callers turn
// this into a warning rather than an empty result set.
export function queryHasLineBreak(query: string) {
  return query.includes('\n') || query.includes('\r')
}

export function shouldSearchNames(options: FindOptions) {
  return options.includeNames !== false
}

export function isIgnoredSearchPath(
  context: FindContext,
  relativePath: string,
  isDirectory?: boolean,
) {
  if (!relativePath) return false
  if (context.paths.isInternalPath(relativePath)) return true
  if (isIgnoredPath(relativePath)) return true

  return context.gitIgnore.ignores(relativePath, isDirectory)
}

export function nameSearchMatches(
  context: FindContext,
  relativePath: string,
  name = path.basename(relativePath),
) {
  if (searchMatchMode(context.options) === 'fuzzy')
    return fuzzyRank(nameSearchRankTarget(context, relativePath, name), context.query) !== null

  if (context.matcher.lineMatches(name).length > 0) return true

  return context.matcher.lineMatches(globMatchPath(context, relativePath)).length > 0
}

export function nameSearchRankTarget(
  context: FindContext,
  relativePath: string,
  name = path.basename(relativePath),
) {
  const matchPath = globMatchPath(context, relativePath)

  return {
    label: name,
    path: matchPath || relativePath,
  }
}

export function contentMatch({
  columnIndex,
  endColumnIndex,
  entry,
  line,
  lineNumber,
  relativePath,
}: {
  columnIndex: number
  endColumnIndex: number
  entry: FsEntryStats
  line: string
  lineNumber: number
  relativePath: string
}): FindMatch {
  const preview = workspaceSearchPreview(searchContentLineText(line), columnIndex, endColumnIndex)

  return {
    ...searchMatchMetadata(entry),
    column: columnIndex + 1,
    endColumn: endColumnIndex + 1,
    kind: 'content',
    line: lineNumber,
    path: relativePath,
    preview: preview.text,
    previewStartColumn: preview.startColumn,
    source: 'disk',
    targetType: entry.targetType,
    type: entry.type,
  }
}

export function searchMatchMetadata(entry: FsEntryStats) {
  return {
    birthtimeMs: Number(entry.targetStats.birthtimeMs),
    mtimeMs: Number(entry.targetStats.mtimeMs),
    size: Number(entry.targetStats.size),
  }
}

export async function safeEntryStats(
  absolutePath: string,
  measurement?: SearchMeasurementRecorder,
  pathKey = absolutePath,
  cache?: SearchStatCache,
) {
  if (cache) return cachedEntryStats(absolutePath, measurement, pathKey, cache)

  return readSafeEntryStats(absolutePath, measurement, pathKey)
}

function cachedEntryStats(
  absolutePath: string,
  measurement: SearchMeasurementRecorder | undefined,
  pathKey: string,
  cache: SearchStatCache,
) {
  const cached = cache.get(pathKey)
  if (cached) return cached

  const pending = readSafeEntryStats(absolutePath, measurement, pathKey)
  cache.set(pathKey, pending)
  return pending
}

async function readSafeEntryStats(
  absolutePath: string,
  measurement: SearchMeasurementRecorder | undefined,
  pathKey: string,
) {
  try {
    if (measurement)
      return await measurement.measureStat(pathKey, () => readEntryStats(absolutePath))

    return await readEntryStats(absolutePath)
  } catch {
    return null
  }
}

export function joinRelative(parent: string, child: string) {
  if (!parent) return child
  return toPosix(path.join(parent, child))
}

export function resultPath(rootRelativePath: string, output: string) {
  const cleanOutput = output.replace(/^\.\//, '').replace(/\/$/, '')
  if (!rootRelativePath) return toPosix(cleanOutput)

  return toPosix(path.join(rootRelativePath, cleanOutput))
}

export function globMatchPath(context: FindContext, relativePath: string) {
  if (!context.root.relativePath) return relativePath
  if (relativePath === context.root.relativePath) return ''

  const prefix = `${context.root.relativePath}/`
  if (!relativePath.startsWith(prefix)) return relativePath

  return relativePath.slice(prefix.length)
}

function searchContentLineText(line: string) {
  return line.replace(/(?:\r\n|\r|\n)$/u, '')
}

export function workspaceIndexForSearch(
  options: Pick<FindOptions, 'useWorkspaceIndex'>,
  index: WorkspaceIndex | undefined,
) {
  if (options.useWorkspaceIndex === false) return undefined

  return index
}
