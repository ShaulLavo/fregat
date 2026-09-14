import type { TreeEntry } from '@workspace/contracts'

export type WorkspaceFilesystemEvent =
  | { type: 'created'; path: string; entry?: TreeEntry; version?: string }
  | { type: 'changed'; path: string; entry?: TreeEntry; version?: string }
  | { type: 'deleted'; path: string }
  | { type: 'renamed'; path: string; oldPath: string; entry?: TreeEntry; version?: string }

export type WorkspaceOpenFileSnapshot = {
  // Open tabs without live documents should not trigger content reads.
  hasLiveDocument: boolean
  isDirty: boolean
  path: string
}

export type WorkspaceTreeOperation =
  | { type: 'patch-changed-tree-entries'; entries: TreeEntry[] }
  | { type: 'refresh-ready-root-tree'; path: string }
  | { type: 'refresh-tree-directory'; path: string }

export type WorkspaceOpenFileOperation =
  | { type: 'deleted-conflict'; path: string }
  | { type: 'discard-open-file'; path: string }
  | WorkspaceOpenFileRefresh
  | { type: 'rename-open-file'; from: string; to: string }
  | { type: 'renamed-conflict'; localPath: string; remotePath: string }

export type WorkspaceOpenFileRefresh = {
  type: 'refresh-open-file'
  path: string
  reason: 'changed' | 'ready'
  version?: string
}

export type WorkspaceFetchedOpenFileOperation =
  | { type: 'changed-conflict'; path: string }
  | { type: 'replace-open-file'; notifyDirtyOverwrite: boolean; path: string }

export type WorkspaceEventPlan = {
  openFileOperations: WorkspaceOpenFileOperation[]
  shouldInvalidateGitState: boolean
  treeOperations: WorkspaceTreeOperation[]
}

export function planWorkspaceFilesystemEvents({
  events,
  openFiles,
  rootPath,
}: {
  events: readonly WorkspaceFilesystemEvent[]
  openFiles: readonly WorkspaceOpenFileSnapshot[]
  rootPath: string
}): WorkspaceEventPlan {
  const recreatedPaths = recreatedOpenFilePaths(events)

  return {
    openFileOperations: planOpenFileOperations(events, openFiles, recreatedPaths, rootPath),
    shouldInvalidateGitState: events.length > 0,
    treeOperations: planTreeOperations(events, rootPath),
  }
}

export function planWorkspaceReady({
  openFiles,
  rootPath,
}: {
  openFiles: readonly WorkspaceOpenFileSnapshot[]
  rootPath: string
}): WorkspaceEventPlan {
  return {
    openFileOperations: openFiles.flatMap((file) =>
      shouldRefreshReadyOpenFile(file) ? [readyOpenFileRefresh(file.path)] : [],
    ),
    shouldInvalidateGitState: true,
    treeOperations: [{ type: 'refresh-ready-root-tree', path: rootPath }],
  }
}

function shouldRefreshReadyOpenFile(file: WorkspaceOpenFileSnapshot) {
  if (file.isDirty) return false

  return file.hasLiveDocument
}

export function planFetchedOpenFileRefresh({
  liveText,
  isDirty,
  remoteText,
  path,
}: {
  liveText: string | null
  isDirty: boolean
  remoteText: string
  path: string
}): WorkspaceFetchedOpenFileOperation {
  if (liveText === remoteText)
    return { notifyDirtyOverwrite: false, path, type: 'replace-open-file' }
  if (isDirty) return { type: 'changed-conflict', path }

  return { notifyDirtyOverwrite: true, path, type: 'replace-open-file' }
}

function planTreeOperations(
  events: readonly WorkspaceFilesystemEvent[],
  rootPath: string,
): WorkspaceTreeOperation[] {
  const entries = changedTreeEntries(events)
  const operations: WorkspaceTreeOperation[] = entries.length
    ? [{ type: 'patch-changed-tree-entries', entries }]
    : []

  for (const path of affectedDirectoryPaths(events, rootPath)) {
    operations.push({ type: 'refresh-tree-directory', path })
  }

  return operations
}

function changedTreeEntries(events: readonly WorkspaceFilesystemEvent[]) {
  return events.flatMap((event) => (event.type === 'changed' && event.entry ? [event.entry] : []))
}

function planOpenFileOperations(
  events: readonly WorkspaceFilesystemEvent[],
  openFiles: readonly WorkspaceOpenFileSnapshot[],
  recreatedPaths: ReadonlySet<string>,
  rootPath: string,
): WorkspaceOpenFileOperation[] {
  const operations: WorkspaceOpenFileOperation[] = []
  const liveOpenFilePaths = openFiles
    .filter((file) => file.hasLiveDocument)
    .map((file) => file.path)

  for (const event of events) {
    if (event.type === 'deleted') {
      if (recreatedPaths.has(event.path)) continue

      operations.push(...planDeletedOpenFileOperations(event.path, openFiles))
      continue
    }
    if (event.type !== 'renamed') continue

    operations.push(...planRenamedOpenFileOperations(event, openFiles))
  }

  const refreshPaths = affectedOpenFileRefreshPaths(
    events,
    liveOpenFilePaths,
    recreatedPaths,
    rootPath,
  )
  const versions = reportedVersionsByPath(events)
  for (const path of refreshPaths) {
    operations.push(changedOpenFileRefresh(path, versions.get(path)))
  }

  return operations
}

function readyOpenFileRefresh(path: string): WorkspaceOpenFileRefresh {
  return { path, reason: 'ready', type: 'refresh-open-file' }
}

function changedOpenFileRefresh(
  path: string,
  version: string | undefined,
): WorkspaceOpenFileRefresh {
  if (version === undefined) return { path, reason: 'changed', type: 'refresh-open-file' }
  return { path, reason: 'changed', type: 'refresh-open-file', version }
}

function reportedVersionsByPath(events: readonly WorkspaceFilesystemEvent[]) {
  const versions = new Map<string, string>()
  for (const event of events) {
    if (event.type === 'deleted' || event.version === undefined) {
      versions.delete(event.path)
      continue
    }
    versions.set(event.path, event.version)
  }
  return versions
}

// A fresh snapshot can still predate the change; trusting it compares the
// buffer against the previous save and reports a phantom conflict.
export function mayTrustCachedSnapshot(
  refresh: WorkspaceOpenFileRefresh,
  cachedVersion: string | undefined,
): boolean {
  if (refresh.reason === 'ready') return true
  if (refresh.version === undefined) return false
  return cachedVersion === refresh.version
}

function planDeletedOpenFileOperations(
  deletedPath: string,
  openFiles: readonly WorkspaceOpenFileSnapshot[],
): WorkspaceOpenFileOperation[] {
  const operations: WorkspaceOpenFileOperation[] = []

  for (const openFile of openFiles) {
    if (!isSameOrChildPath(openFile.path, deletedPath)) continue
    if (openFile.isDirty) {
      operations.push({ type: 'deleted-conflict', path: openFile.path })
      continue
    }

    operations.push({ type: 'discard-open-file', path: openFile.path })
  }

  return operations
}

function planRenamedOpenFileOperations(
  event: Extract<WorkspaceFilesystemEvent, { type: 'renamed' }>,
  openFiles: readonly WorkspaceOpenFileSnapshot[],
): WorkspaceOpenFileOperation[] {
  const operations: WorkspaceOpenFileOperation[] = []

  for (const openFile of openFiles) {
    const nextPath = renamedPath(openFile.path, event.oldPath, event.path)
    if (!nextPath) continue
    if (openFile.isDirty) {
      operations.push({
        localPath: openFile.path,
        remotePath: nextPath,
        type: 'renamed-conflict',
      })
      continue
    }

    operations.push({
      from: openFile.path,
      to: nextPath,
      type: 'rename-open-file',
    })
  }

  return operations
}

export function affectedOpenFileRefreshPaths(
  events: readonly WorkspaceFilesystemEvent[],
  openFilePaths: readonly string[],
  recreatedPaths: ReadonlySet<string>,
  rootPath: string,
) {
  const affectedDirectories = new Set<string>()
  const deletedPaths = new Set<string>()
  const exactPaths = new Set<string>()
  const exactDirectories = new Set<string>()
  const openPathSet = new Set(openFilePaths)

  for (const event of events) {
    if (event.type === 'deleted') {
      deletedPaths.add(event.path)
      continue
    }
    if (event.type === 'renamed') continue
    if (openPathSet.has(event.path)) {
      exactPaths.add(event.path)
      exactDirectories.add(parentPath(event.path, rootPath))
      continue
    }
    if (!isLikelyTemporarySavePath(event.path)) continue

    affectedDirectories.add(parentPath(event.path, rootPath))
  }

  const fallbackPaths = openFilePaths.filter((path) =>
    shouldRefreshFallbackPath(
      path,
      rootPath,
      affectedDirectories,
      exactDirectories,
      deletedPaths,
      recreatedPaths,
      exactPaths,
    ),
  )

  return Array.from(exactPaths).concat(fallbackPaths)
}

export function affectedDirectoryPaths(
  events: readonly WorkspaceFilesystemEvent[],
  rootPath: string,
) {
  const directories = new Set<string>()

  for (const event of events) {
    if (event.type === 'changed') continue
    if (isLikelyTemporarySavePath(event.path)) continue

    directories.add(parentPath(event.path, rootPath))
    if (event.type === 'renamed') directories.add(parentPath(event.oldPath, rootPath))
  }

  return directories
}

function shouldRefreshFallbackPath(
  path: string,
  rootPath: string,
  affectedDirectories: ReadonlySet<string>,
  exactDirectories: ReadonlySet<string>,
  deletedPaths: ReadonlySet<string>,
  recreatedPaths: ReadonlySet<string>,
  exactPaths: ReadonlySet<string>,
) {
  if (exactPaths.has(path)) return false
  if (!recreatedPaths.has(path) && isWithinAnyPath(path, deletedPaths)) return false

  const directory = parentPath(path, rootPath)
  if (exactDirectories.has(directory)) return false

  return affectedDirectories.has(directory)
}

function isLikelyTemporarySavePath(path: string) {
  const name = path.split('/').at(-1) ?? path
  if (name.endsWith('~')) return true
  if (name.startsWith('.') && name.includes('.tmp')) return true
  if (name.endsWith('.tmp')) return true
  if (name.endsWith('.swp')) return true
  if (name.endsWith('.swx')) return true
  if (name.endsWith('.part')) return true

  return false
}

export function parentPath(path: string, rootPath: string) {
  if (path === rootPath) return rootPath

  const index = path.lastIndexOf('/')
  if (index < 0) return rootPath

  return path.slice(0, index)
}

function isWithinAnyPath(path: string, parents: ReadonlySet<string>) {
  for (const parent of parents) {
    if (isSameOrChildPath(path, parent)) return true
  }

  return false
}

function isSameOrChildPath(path: string, parent: string) {
  return path === parent || path.startsWith(`${parent}/`)
}

function recreatedOpenFilePaths(events: readonly WorkspaceFilesystemEvent[]) {
  const deletedPaths = new Set<string>()
  const recreatedPaths = new Set<string>()

  for (const event of events) {
    if (event.type === 'deleted') {
      deletedPaths.add(event.path)
      continue
    }
    if (event.type !== 'created' && event.type !== 'changed') continue
    if (!deletedPaths.has(event.path)) continue

    recreatedPaths.add(event.path)
  }

  return recreatedPaths
}

function renamedPath(path: string, from: string, to: string) {
  if (path === from) return to
  if (!path.startsWith(`${from}/`)) return null

  return `${to}${path.slice(from.length)}`
}
