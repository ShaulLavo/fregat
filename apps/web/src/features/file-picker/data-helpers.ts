import { filesystemPath } from '@/lib/documents/utils/identity'
import type { FsEntry, PickedFsEntry } from '@/lib/file-system-types'
import { isDirectoryEntry } from '@/lib/file-system-types'
import {
  createFolderPath,
  fetchRecentEntries as fetchSharedRecentEntries,
  fetchServerInfo as fetchSharedServerInfo,
  fetchTree,
  recordRecentEntry,
  statPath,
} from '@/lib/file-server'
import { createClientError } from '@workspace/client-core/errors'
import { clientErrors } from '@/lib/structured-errors'
import type { Client } from '@/lib/client'
import { streamWorkspaceSearch } from '@workspace/client-core/files/search-client'

import {
  basename,
  joinPaths,
  type DirectoryFsEntry,
  type FilePickerMode,
} from '@/features/file-picker/model'
import { streamPickerSearchEntries } from '@/features/file-picker/picker-search'

export type DirectoryLoadData = {
  currentEntry: DirectoryFsEntry | null
  entries: FsEntry[]
}

export type DirectoryLoadOptions = {
  showHidden?: boolean
}

export type CreatePickerFolderRequest = {
  name: string
  parentPath: string
}

const RECENT_LIMIT = 30
const MAX_FOLDER_NAME_BYTES = 255
const utf8Encoder = new TextEncoder()

export async function loadDirectoryData(
  path: string,
  query: string,
  mode: FilePickerMode,
  signal: AbortSignal,
  onEntries: (entries: FsEntry[]) => void,
  options: DirectoryLoadOptions = {},
  client: Client,
): Promise<DirectoryLoadData> {
  const showHidden = options.showHidden ?? false
  const [currentEntry, entries] = await Promise.all([
    fetchCurrentEntry(path, signal, client),
    loadEntries(path, query, mode, showHidden, signal, onEntries, client),
  ])

  return { currentEntry, entries }
}

export function fetchServerInfo(signal: AbortSignal, client: Client) {
  return fetchSharedServerInfo(signal, client)
}

export function fetchRecentEntries(
  mode: FilePickerMode,
  showHidden: boolean,
  signal: AbortSignal,
  client: Client,
) {
  return fetchSharedRecentEntries({ limit: RECENT_LIMIT, mode, showHidden }, signal, client)
}

export async function recordRecent(entry: PickedFsEntry, client: Client) {
  await recordRecentEntry(entry.path, client)
}

export async function createPickerFolder(request: CreatePickerFolderRequest, client: Client) {
  const path = pickerFolderPath(request.parentPath, request.name)
  return createFolderPath(path, client)
}

export function pickerFolderPath(parentPath: string, inputName: string) {
  const error = folderNameError(inputName)
  if (error) throw invalidFolderNameError(error)

  return filesystemPath(joinPaths(parentPath, inputName.trim()))
}

export function folderNameError(inputName: string) {
  const name = inputName.trim()
  if (!name) return 'Enter a folder name.'
  if (name === '.' || name === '..') return 'Choose a folder name other than “.” or “..”.'
  if (name.includes('/') || name.includes('\\')) {
    return 'Folder names cannot contain path separators.'
  }
  if (name.includes('\0')) return 'Folder names cannot contain null characters.'
  if (utf8Encoder.encode(name).byteLength > MAX_FOLDER_NAME_BYTES) {
    return `Folder names cannot exceed ${MAX_FOLDER_NAME_BYTES} bytes.`
  }

  return null
}

export function visiblePickerEntries<TEntries extends readonly FsEntry[]>(
  entries: TEntries,
  currentPath: string,
  showHidden: boolean,
): TEntries | FsEntry[] {
  if (showHidden) return entries

  return entries.filter((entry) => !hasHiddenPathSegment(entry.path, currentPath))
}

function hasHiddenPathSegment(path: string, currentPath: string) {
  const relativePath = pathBelowCurrent(path, currentPath)
  return relativePath.split('/').some((segment) => segment.startsWith('.'))
}

async function loadEntries(
  path: string,
  query: string,
  mode: FilePickerMode,
  showHidden: boolean,
  signal: AbortSignal,
  onEntries: (entries: FsEntry[]) => void,
  client: Client,
) {
  const trimmedQuery = query.trim()
  if (!trimmedQuery) return fetchTreeEntries(path, showHidden, signal, client)

  const entries = await streamPickerSearchEntries(
    path,
    trimmedQuery,
    mode,
    signal,
    (next) => {
      onEntries(visiblePickerEntries(next, path, showHidden))
    },
    { showHidden, search: (query, signal) => streamWorkspaceSearch(query, signal, client) },
  )

  return visiblePickerEntries(entries, path, showHidden)
}

async function fetchCurrentEntry(path: string, signal: AbortSignal, client: Client) {
  const entry = await statPath(filesystemPath(path), signal, client)
  if (!isDirectoryEntry(entry)) {
    throw clientErrors.CURRENT_PATH_NOT_FOLDER()
  }

  return {
    ...entry,
    name: basename(entry.path),
    type: entry.type,
  } as DirectoryFsEntry
}

async function fetchTreeEntries(
  path: string,
  showHidden: boolean,
  signal: AbortSignal,
  client: Client,
) {
  const result = await fetchTree(filesystemPath(path), signal, client)
  return visiblePickerEntries(result.entries, path, showHidden)
}

function pathBelowCurrent(path: string, currentPath: string) {
  if (!currentPath) return path
  if (path === currentPath) return ''

  const prefix = `${currentPath.replace(/\/+$/, '')}/`
  if (!path.startsWith(prefix)) return path

  return path.slice(prefix.length)
}

function invalidFolderNameError(message: string) {
  return createClientError({
    code: 'CLIENT_INVALID_FOLDER_NAME',
    fix: 'Enter one folder name without path separators or traversal segments.',
    message,
    status: 400,
    why: 'The folder name cannot be safely appended to the current picker path.',
  })
}
