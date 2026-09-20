import { sortedDirents } from './dirents'
import { createReadStream } from 'node:fs'
import { readdir } from 'node:fs/promises'
import path from 'node:path'

import {
  isDirectoryEntry,
  isFileEntry,
  matchesEntryType,
  type WorkspaceSearchMatcher,
} from '@workspace/contracts'

import { SEARCH_LINE_BUFFER_BYTES, streamLines } from './search-line-decoder'
import {
  contentMatch,
  globMatchPath,
  isIgnoredSearchPath,
  joinRelative,
  nameSearchMatches,
  safeEntryStats,
  searchMatchMetadata,
  shouldSearchContent,
  shouldSearchNames,
  type FindContext,
  type FindMatch,
} from './search-shared'
import type { FsEntryStats } from './stat'
import { recordRequestWarning } from '../observability'

// The walker yields as it goes rather than collecting into an array: the caller
// enforces `options.limit` and stops pulling, and an abandoned query aborts
// mid-walk. A generator parked in an `await` can do neither — `.return()` on it
// only lands at the next `yield`.
export async function* searchWithFallback(
  context: FindContext,
  signal?: AbortSignal,
): AsyncGenerator<FindMatch> {
  yield* searchDirectory(context.root.absolutePath, context.root.relativePath, context, signal, 1)
}

async function* searchDirectory(
  absoluteDirectory: string,
  relativeDirectory: string,
  context: FindContext,
  signal: AbortSignal | undefined,
  depth: number,
): AsyncGenerator<FindMatch> {
  if (signal?.aborted) return

  const dirents = await readdir(absoluteDirectory, { withFileTypes: true })
  for (const dirent of sortedDirents(dirents)) {
    if (signal?.aborted) return

    yield* searchEntry(absoluteDirectory, relativeDirectory, dirent.name, context, signal, depth)
  }
}

async function* searchEntry(
  absoluteDirectory: string,
  relativeDirectory: string,
  name: string,
  context: FindContext,
  signal: AbortSignal | undefined,
  depth: number,
): AsyncGenerator<FindMatch> {
  const relativePath = joinRelative(relativeDirectory, name)
  if (isIgnoredSearchPath(context, relativePath)) return

  const absolutePath = path.join(absoluteDirectory, name)
  const entryStats = await safeEntryStats(
    absolutePath,
    context.measurement,
    relativePath,
    context.statCache,
  )
  if (!entryStats) return

  if (shouldSearchNames(context.options)) {
    const match = nameMatch(relativePath, name, entryStats, context)
    if (match) yield match
  }

  if (isDirectoryEntry(entryStats)) {
    if (!canSearchChildren(depth, context.options.maxDepth)) return

    yield* searchDirectory(absolutePath, relativePath, context, signal, depth + 1)
    return
  }

  if (!canSearchFileContent(relativePath, entryStats, context)) return

  yield* fileContentMatches(absolutePath, relativePath, entryStats, context, signal)
}

function canSearchChildren(depth: number, maxDepth?: number) {
  if (maxDepth === undefined) return true

  return depth < maxDepth
}

function canSearchFileContent(
  relativePath: string,
  entryStats: FsEntryStats,
  context: FindContext,
) {
  const options = context.options
  if (!matchesEntryType(entryStats, options.entryType)) return false
  if (!context.matcher.pathMatches(globMatchPath(context, relativePath))) return false
  if (!shouldSearchContent(options)) return false
  if (!isFileEntry(entryStats)) return false
  if (entryStats.targetStats.size > options.maxContentBytes) return false

  return true
}

function nameMatch(
  relativePath: string,
  name: string,
  entry: FsEntryStats,
  context: FindContext,
): FindMatch | null {
  if (!matchesEntryType(entry, context.options.entryType)) return null
  if (!context.matcher.pathMatches(globMatchPath(context, relativePath))) return null
  if (!nameSearchMatches(context, relativePath, name)) return null

  return {
    ...searchMatchMetadata(entry),
    kind: 'name',
    path: relativePath,
    source: 'disk',
    targetType: entry.targetType,
    type: entry.type,
  }
}

async function* fileContentMatches(
  absolutePath: string,
  relativePath: string,
  entry: FsEntryStats,
  context: FindContext,
  signal: AbortSignal | undefined,
): AsyncGenerator<FindMatch> {
  const stream = createReadStream(absolutePath, {
    highWaterMark: SEARCH_LINE_BUFFER_BYTES,
  })
  let bytesRead = 0
  let lineIndex = 0

  try {
    for await (const line of streamLines(stream, SEARCH_LINE_BUFFER_BYTES)) {
      bytesRead += line.byteLength + line.terminatorLength
      if (bytesRead > context.options.maxContentBytes) break
      if (signal?.aborted) break

      yield* contentLineMatches(relativePath, entry, line.text, lineIndex, context.matcher)
      lineIndex += 1
    }
  } catch (error) {
    reportSearchContentError(relativePath, error)
  } finally {
    stream.destroy()
  }
}

function reportSearchContentError(relativePath: string, error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  recordRequestWarning('search fallback skipped file', {
    area: 'search',
    message,
    operation: 'fallback_content',
    path: relativePath,
  })
}

function* contentLineMatches(
  relativePath: string,
  entry: FsEntryStats,
  line: string,
  index: number,
  matcher: WorkspaceSearchMatcher,
): Generator<FindMatch> {
  for (const match of matcher.lineMatches(line)) {
    yield contentMatch({
      columnIndex: match.start,
      endColumnIndex: match.end,
      entry,
      line,
      lineNumber: index + 1,
      relativePath,
    })
  }
}
