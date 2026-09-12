import { searchMatchEntry } from '@/lib/search-match-entry'
import { filesystemPath } from '@/lib/documents/utils/identity'
import type { WorkspaceSearchEvent, WorkspaceSearchQuery } from '@workspace/contracts'
import type { FindMatch, FsEntry, SearchScope } from '@/lib/file-system-types'

import { ROOT_PATH, compareSearchEntries, type FilePickerMode } from '@/features/file-picker/model'
import { readSettingsMirror } from '@/features/settings/utils/boot-mirror'

const SEARCH_SCOPE_TIMEOUT_MS = 6000
export const PICKER_HIDDEN_SEARCH_EXCLUDE_GLOBS = ['**/.*', '**/.*/**'] as const

/** The caller supplies the transport captured for this search. */
export type WorkspaceSearchStream = (
  query: WorkspaceSearchQuery,
  signal: AbortSignal,
) => AsyncIterable<WorkspaceSearchEvent>

export type StreamPickerSearchOptions = {
  search: WorkspaceSearchStream
  showHidden?: boolean
  scopeTimeoutMs?: number | null
}

const searchSignalCleanup = new WeakMap<AbortSignal, () => void>()

export async function streamPickerSearchEntries(
  path: string,
  query: string,
  mode: FilePickerMode,
  signal: AbortSignal,
  onEntries: (entries: FsEntry[]) => void,
  options: StreamPickerSearchOptions,
): Promise<FsEntry[]> {
  const search = options.search
  const showHidden = options.showHidden ?? false
  const scopeTimeoutMs = options.scopeTimeoutMs ?? SEARCH_SCOPE_TIMEOUT_MS
  const matches: FindMatch[] = []
  const seenPaths = new Set<string>()
  const scope: SearchScope = path === ROOT_PATH ? 'system' : 'current'

  await streamSearchScope(
    search,
    path,
    query,
    mode,
    showHidden,
    scope,
    matches,
    seenPaths,
    signal,
    scopeTimeoutMs,
    () => {
      onEntries(fallbackEntries(matches, query))
    },
  )

  if (signal.aborted) throw new DOMException('Aborted', 'AbortError')

  return fallbackEntries(matches, query)
}

async function streamSearchScope(
  search: WorkspaceSearchStream,
  path: string,
  query: string,
  mode: FilePickerMode,
  showHidden: boolean,
  scope: SearchScope,
  matches: FindMatch[],
  seenPaths: Set<string>,
  signal: AbortSignal,
  timeoutMs: number | null,
  onMatch: () => void,
) {
  const scopedSignal = scopedSearchSignal(signal, timeoutMs)

  try {
    for await (const event of search(
      {
        caseSensitive: false,
        entryType: searchEntryType(mode),
        excludeGlobs: showHidden ? undefined : PICKER_HIDDEN_SEARCH_EXCLUDE_GLOBS,
        includeContent: false,
        includeNames: true,
        limit: readSettingsMirror()['search.quickOpenLimit'],
        matchMode: 'literal',
        path,
        query,
        useWorkspaceIndex: workspaceIndexEnabledForScope(scope),
        wholeWord: false,
      },
      scopedSignal,
    )) {
      if (appendSearchMatch(event, matches, seenPaths, scope)) {
        onMatch()
        continue
      }

      if (event.type === 'done') return
    }
  } catch (error) {
    if (scopedSignal.aborted) return
    throw error
  } finally {
    cleanupSearchSignal(scopedSignal)
  }
}

export function appendSearchMatch(
  event: WorkspaceSearchEvent,
  matches: FindMatch[],
  seenPaths: Set<string>,
  scope: SearchScope,
) {
  if (event.type !== 'match') return false

  const match = event.match
  if (match.kind !== 'name') return false
  if (seenPaths.has(match.path)) return false

  seenPaths.add(match.path)
  matches.push({ ...match, path: filesystemPath(match.path), searchScope: scope })
  return true
}

function fallbackEntry(match: FindMatch): FsEntry {
  return { ...searchMatchEntry(match), searchScope: match.searchScope }
}

export function fallbackEntries(matches: FindMatch[], query: string) {
  return matches.map(fallbackEntry).sort(compareSearchEntries(query))
}

export function searchEntryType(mode: FilePickerMode) {
  if (mode === 'folder') return 'directory'

  return undefined
}

function workspaceIndexEnabledForScope(scope: SearchScope) {
  return scope !== 'system'
}

function scopedSearchSignal(signal: AbortSignal, timeoutMs: number | null) {
  if (timeoutMs === null) return signal

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  const abort = () => controller.abort()
  signal.addEventListener('abort', abort, { once: true })
  searchSignalCleanup.set(controller.signal, () => {
    clearTimeout(timeout)
    signal.removeEventListener('abort', abort)
  })

  return controller.signal
}

function cleanupSearchSignal(signal: AbortSignal) {
  const cleanup = searchSignalCleanup.get(signal)
  if (!cleanup) return

  cleanup()
  searchSignalCleanup.delete(signal)
}
