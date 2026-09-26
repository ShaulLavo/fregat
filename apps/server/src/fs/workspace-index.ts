import { sortedDirents } from './dirents'
import { joinRelative } from './search-shared'
import {
  errorMessage,
  type WorkspaceIndexReadiness,
  type WorkspaceIndexStatus,
} from '@workspace/contracts'
import { elapsedMs } from '@workspace/utils/timing'
import type { Stats } from 'node:fs'
import { open, readdir } from 'node:fs/promises'
import path from 'node:path'

import type { EntryTypeFilter, WatchServerMessage } from './contracts'
import type { WatchCoverage } from '@workspace/contracts'
import { defaultIgnoredNames, isIgnoredPath, toPosix, type WorkspacePaths } from './path'
import {
  workspaceGitIgnoreMatcher,
  type GitIgnoreMatcher,
  type GitIgnoreMatcherOptions,
} from './search-gitignore'
import { readEntryStats, type FsEntryStats } from './stat'
import { recordProcessInfo } from '../observability'
import { fileVersion } from './version'

const SNIFF_BYTES = 512
const DEFAULT_INDEX_UPDATE_COALESCE_MS = 25
const DEFAULT_INDEX_REBUILD_EVENT_LIMIT = 500

type WorkspaceIndexContentKind = 'binary' | 'image' | 'text' | 'unknown'
type WorkspaceIndexFileKind = 'binary' | 'config' | 'document' | 'image' | 'other' | 'source'
type WorkspaceIndexSpecialKind = 'block-device' | 'character-device' | 'fifo' | 'socket' | 'unknown'

export type WorkspaceIndexEntry = {
  basename: string
  birthtimeMs: number
  charBag: string
  contentKind: WorkspaceIndexContentKind
  defaultIgnored: boolean
  extension: string
  fileKind: WorkspaceIndexFileKind
  gitIgnored: boolean
  hidden: boolean
  mtimeMs: number
  path: string
  size: number
  specialKind?: WorkspaceIndexSpecialKind
  stale: boolean
  targetSpecialKind?: WorkspaceIndexSpecialKind
  targetType?: EntryTypeFilter
  type: EntryTypeFilter
  version: string
}

export type WorkspaceIndexBuildOptions = {
  reason?: string
  signal?: AbortSignal
}

export type WorkspaceIndexOptions = {
  ignore?: GitIgnoreMatcherOptions
}

export type WorkspaceIndexWatchOptions = {
  coalesceMs?: number
  rebuildEventLimit?: number
}

export type WorkspaceIndexWatchEvents = (signal: AbortSignal) => AsyncIterable<WatchServerMessage>

export type WorkspaceIndexWatchSubscription = {
  ready: Promise<void>
  /** How the root is watched, known once `ready` settles. */
  readonly coverage: WatchCoverage | undefined
  close(): Promise<void>
}

type WorkspaceIndexMutableStatus = WorkspaceIndexStatus
type WorkspaceIndexFilesystemEvent = Extract<
  WatchServerMessage,
  { type: 'changed' | 'created' | 'deleted' | 'renamed' }
>

type ScanContext = {
  entries: Map<string, WorkspaceIndexEntry>
  gitIgnore: GitIgnoreMatcher
  paths: WorkspacePaths
  scanWarningCount: number
  signal?: AbortSignal
  skippedEntryCount: number
}

type ScanResult = {
  entries: Map<string, WorkspaceIndexEntry>
  scanWarningCount: number
  skippedEntryCount: number
}

type WorkspaceIndexCounts = {
  entryCount: number
  fileCount: number
  staleEntryCount: number
}

type IndexPathAction = 'changed' | 'created' | 'deleted'

export class WorkspaceIndex {
  private childPathsByParent = new Map<string, Set<string>>()
  private entriesByPath = new Map<string, WorkspaceIndexEntry>()
  private fileEntryCount = 0
  private pendingCreatedPaths = new Set<string>()
  private readonly options: WorkspaceIndexOptions
  private readonly paths: WorkspacePaths
  private rebuildSequence = 0
  private staleEntryCount = 0
  private state: WorkspaceIndexMutableStatus

  constructor(paths: WorkspacePaths, options: WorkspaceIndexOptions = {}) {
    this.options = options
    this.paths = paths
    this.state = emptyStatus(paths.workspaceRoot)
  }

  status(): WorkspaceIndexStatus {
    return { ...this.state }
  }

  entryMap(): ReadonlyMap<string, Readonly<WorkspaceIndexEntry>> {
    return this.entriesByPath
  }

  get(relativePath: string) {
    const entry = this.entriesByPath.get(indexPathKey(relativePath))
    if (!entry) return undefined

    return cloneEntry(entry)
  }

  async rebuild(options: WorkspaceIndexBuildOptions = {}) {
    if (this.state.readiness === 'off') return this.status()
    const startedAt = performance.now()
    const reason = options.reason ?? 'manual'
    const rebuildId = this.nextRebuildId()

    this.state = {
      ...this.state,
      errorMessage: undefined,
      readiness: 'building',
      rebuildReason: reason,
      scanRoot: this.paths.workspaceRoot,
    }

    try {
      const result = await scanWorkspaceIndex(this.paths, this.options, options.signal)
      if (!this.isCurrentRebuild(rebuildId)) return this.status()

      this.replaceEntries(result.entries)
      this.pendingCreatedPaths.clear()
      this.state = readyStatus(this.paths.workspaceRoot, this.counts(), result, startedAt, reason)
      recordIndexBuild(this.state)
      return this.status()
    } catch (error) {
      if (!this.isCurrentRebuild(rebuildId)) return this.status()

      this.clearEntries()
      this.pendingCreatedPaths.clear()
      this.state = failedStatus(this.paths.workspaceRoot, startedAt, reason, error)
      recordIndexBuild(this.state)
      throw error
    }
  }

  /** A root that was too large to watch now fits; build the index it went without. */
  async turnOn(reason: string) {
    if (this.state.readiness !== 'off') return this.status()
    this.state = { ...this.state, readiness: 'cold' }
    try {
      return await this.rebuild({ reason })
    } catch {
      return this.status()
    }
  }

  /** For a root too large to watch: nothing would keep an index current, so none is built. */
  turnOff(reason: string) {
    this.nextRebuildId()
    this.clearEntries()
    this.pendingCreatedPaths.clear()
    this.state = {
      ...emptyStatus(this.paths.workspaceRoot),
      readiness: 'off',
      rebuildReason: reason,
    }
    recordIndexBuild(this.state)
  }

  async applyWatchEvents(events: readonly WatchServerMessage[]) {
    const queuedEvents = events.filter(shouldQueueIndexEvent)
    if (queuedEvents.length === 0) return this.status()
    if (this.state.readiness === 'off') return this.status()
    const watchError = queuedEvents.find(isWatchErrorEvent)
    if (watchError) return this.markFailed('watch-error', watchError.message)
    if (this.state.readiness === 'failed') return this.status()
    if (!canApplyIncrementalUpdates(this.state.readiness)) {
      return this.rebuild({ reason: 'watch-event-without-ready-index' })
    }

    const updateId = this.rebuildSequence
    for (const event of queuedEvents) {
      if (!isWorkspaceIndexFilesystemEvent(event)) continue
      if (!this.canCommitIncrementalUpdate(updateId)) return this.status()

      await this.applyFilesystemEvent(event, updateId)
    }

    this.clearPendingCreatedPaths(queuedEvents)
    return this.status()
  }

  async refresh(relativePath: string) {
    if (this.state.readiness === 'failed' || this.state.readiness === 'off') return this.status()
    if (!canApplyIncrementalUpdates(this.state.readiness)) {
      return this.rebuild({ reason: 'incremental-refresh-without-ready-index' })
    }

    return this.refreshForUpdate(relativePath, this.rebuildSequence)
  }

  private async refreshForUpdate(relativePath: string, updateId: number) {
    if (!this.canCommitIncrementalUpdate(updateId)) return this.status()

    const normalized = indexPathKey(relativePath)
    if (!normalized) return this.rebuild({ reason: 'incremental-root-refresh' })

    const scanPath = this.refreshScanPath(normalized)
    const result = await scanWorkspaceIndexPath(this.paths, scanPath, this.options)

    return this.commitScannedEntries(scanPath, result, updateId)
  }

  deleteSubtree(relativePath: string) {
    if (!canApplyIncrementalUpdates(this.state.readiness)) return this.status()

    return this.deleteSubtreeForUpdate(relativePath, this.rebuildSequence)
  }

  private deleteSubtreeForUpdate(relativePath: string, updateId: number) {
    if (!this.canCommitIncrementalUpdate(updateId)) return this.status()

    this.removeEntriesAt(relativePath)
    this.state = incrementalStatus(this.state, this.counts())
    return this.status()
  }

  markSubtreeStale(relativePath: string) {
    if (!canApplyIncrementalUpdates(this.state.readiness)) return

    const changed = this.markSubtreeEntriesStale(indexPathKey(relativePath))
    if (!changed && this.state.readiness === 'stale') return

    this.state = staleLiveStatus(this.state, this.counts())
  }

  private markSubtreeEntriesStale(normalized: string) {
    let changed = false

    for (const entryPath of this.collectSubtreePaths(normalized)) {
      const entry = this.entriesByPath.get(entryPath)
      if (!entry) continue
      if (entry.stale) continue

      this.setEntry({ ...entry, stale: true })
      changed = true
    }

    return changed
  }

  markCreatedPathPending(relativePath: string) {
    if (!canApplyIncrementalUpdates(this.state.readiness)) return

    this.pendingCreatedPaths.add(indexPathKey(relativePath))
    this.state = staleLiveStatus(this.state, this.counts(), this.pendingCreatedPaths)
  }

  // Search reads the entries only while `ready`, so a failure needs no fresh scan to record it.
  markFailed(reason: string, error: unknown) {
    if (this.state.readiness === 'off') return this.status()
    this.nextRebuildId()
    this.pendingCreatedPaths.clear()
    this.state = failedLiveStatus(this.state, this.counts(), reason, error)
    recordIndexBuild(this.state)
    return this.status()
  }

  private clearPendingCreatedPaths(events: readonly WatchServerMessage[]) {
    for (const event of events) {
      if (!isWorkspaceIndexFilesystemEvent(event)) continue

      this.pendingCreatedPaths.delete(indexPathKey(event.path))
    }

    this.state = statusWithPendingCreatedPathCount(this.state, this.pendingCreatedPaths)
  }

  private async applyFilesystemEvent(event: WorkspaceIndexFilesystemEvent, updateId: number) {
    if (shouldRebuildForFilesystemEvent(event)) {
      await this.rebuild({ reason: 'gitignore-change' })
      return
    }

    if (event.type === 'deleted') {
      this.deleteSubtreeForUpdate(event.path, updateId)
      return
    }

    if (event.type === 'renamed') {
      await this.applyRenameEvent(event, updateId)
      return
    }

    await this.refreshForUpdate(event.path, updateId)
  }

  private async applyRenameEvent(
    event: Extract<WorkspaceIndexFilesystemEvent, { type: 'renamed' }>,
    updateId: number,
  ) {
    if (!this.canCommitIncrementalUpdate(updateId)) return

    const normalized = indexPathKey(event.path)
    if (!normalized) {
      await this.rebuild({ reason: 'incremental-root-refresh' })
      return
    }

    const scanPath = this.refreshScanPath(normalized)
    const result = await scanWorkspaceIndexPath(this.paths, scanPath, this.options)

    this.commitScannedEntries(scanPath, result, updateId, [event.oldPath])
  }

  private refreshScanPath(normalizedPath: string) {
    const ignoredRoot = defaultIgnoredScanRootPath(normalizedPath)
    if (ignoredRoot) return ignoredRoot

    const missingAncestor = firstMissingAncestorPath(this.entriesByPath, normalizedPath)
    return missingAncestor ?? normalizedPath
  }

  private commitScannedEntries(
    scanPath: string,
    result: ScanResult,
    updateId: number,
    removePaths: readonly string[] = [],
  ) {
    if (!this.canCommitIncrementalUpdate(updateId)) return this.status()

    for (const removePath of removePaths) {
      this.removeEntriesAt(removePath)
    }

    this.removeEntriesAt(scanPath)
    for (const entry of result.entries.values()) {
      this.setEntry(entry)
    }

    this.state = incrementalStatus(this.state, this.counts(), result)
    return this.status()
  }

  private removeEntriesAt(relativePath: string) {
    const normalized = indexPathKey(relativePath)
    if (!normalized) {
      this.clearEntries()
      return
    }

    for (const entryPath of this.collectSubtreePaths(normalized)) {
      this.deleteEntryPath(entryPath)
    }

    this.unlinkChildPath(normalized)
  }

  private counts(): WorkspaceIndexCounts {
    return {
      entryCount: this.entriesByPath.size,
      fileCount: this.fileEntryCount,
      staleEntryCount: this.staleEntryCount,
    }
  }

  private applyCountDelta(entry: WorkspaceIndexEntry, delta: number) {
    if (entry.type === 'file') this.fileEntryCount += delta
    if (entry.stale) this.staleEntryCount += delta
  }

  private setEntry(entry: WorkspaceIndexEntry) {
    const previous = this.entriesByPath.get(entry.path)
    if (previous) this.applyCountDelta(previous, -1)
    if (!previous) this.linkChildPath(entry.path)

    this.entriesByPath.set(entry.path, entry)
    this.applyCountDelta(entry, 1)
  }

  private replaceEntries(entries: Map<string, WorkspaceIndexEntry>) {
    this.entriesByPath = entries
    this.childPathsByParent = new Map()
    this.fileEntryCount = 0
    this.staleEntryCount = 0

    for (const entry of entries.values()) {
      this.linkChildPath(entry.path)
      this.applyCountDelta(entry, 1)
    }
  }

  // `.clear()`, not `= new Map()`. The old removeEntriesAt('') cleared in place,
  // and `entryMap()` hands the live map to ContentIndexFilter — swapping the
  // instance here would change what an in-flight search observes.
  private clearEntries() {
    this.entriesByPath.clear()
    this.childPathsByParent.clear()
    this.fileEntryCount = 0
    this.staleEntryCount = 0
  }

  private linkChildPath(entryPath: string) {
    const parent = parentIndexPath(entryPath)
    if (parent === undefined) return

    const siblings = this.childPathsByParent.get(parent)
    if (siblings) {
      siblings.add(entryPath)
      return
    }

    this.childPathsByParent.set(parent, new Set([entryPath]))
  }

  private unlinkChildPath(entryPath: string) {
    const parent = parentIndexPath(entryPath)
    if (parent === undefined) return

    const siblings = this.childPathsByParent.get(parent)
    if (!siblings) return

    siblings.delete(entryPath)
    if (siblings.size > 0) return

    this.childPathsByParent.delete(parent)
  }

  // Materializes the subtree rooted at `normalized` (inclusive) by walking the
  // parent->children links instead of scanning every key in the index.
  private collectSubtreePaths(normalized: string) {
    const collected: string[] = []
    const stack: string[] = [normalized]

    while (stack.length > 0) {
      const current = stack.pop()
      if (current === undefined) continue

      collected.push(current)
      const children = this.childPathsByParent.get(current)
      if (!children) continue

      for (const child of children) stack.push(child)
    }

    return collected
  }

  private deleteEntryPath(entryPath: string) {
    const entry = this.entriesByPath.get(entryPath)
    this.entriesByPath.delete(entryPath)
    // Every descendant of this path is deleted in the same pass, so its whole
    // child set goes with it; only the subtree root needs unlinking from its
    // parent's set.
    this.childPathsByParent.delete(entryPath)
    if (!entry) return

    this.applyCountDelta(entry, -1)
  }

  private nextRebuildId() {
    this.rebuildSequence += 1
    return this.rebuildSequence
  }

  private isCurrentRebuild(rebuildId: number) {
    return rebuildId === this.rebuildSequence
  }

  private canCommitIncrementalUpdate(updateId: number) {
    if (!this.isCurrentRebuild(updateId)) return false

    return canApplyIncrementalUpdates(this.state.readiness)
  }
}

export async function buildWorkspaceIndex(
  paths: WorkspacePaths,
  options: WorkspaceIndexBuildOptions & WorkspaceIndexOptions = {},
) {
  const index = new WorkspaceIndex(paths, { ignore: options.ignore })
  await index.rebuild(options)
  return index
}

export function watchWorkspaceIndex(
  index: WorkspaceIndex,
  events: WorkspaceIndexWatchEvents,
  options: WorkspaceIndexWatchOptions = {},
): WorkspaceIndexWatchSubscription {
  const watcher = new WorkspaceIndexEventWatcher(index, events, options)
  watcher.start()
  return watcher
}

class WorkspaceIndexEventWatcher implements WorkspaceIndexWatchSubscription {
  private readonly abort = new AbortController()
  private readonly coalesceMs: number
  private readonly events: WorkspaceIndexWatchEvents
  private readonly index: WorkspaceIndex
  private readonly rebuildEventLimit: number
  readonly ready: Promise<void>
  coverage: WatchCoverage | undefined
  private closed = false
  private flushChain = Promise.resolve()
  private pending: WatchServerMessage[] = []
  private pendingKeys = new Set<string>()
  private resolveReady!: () => void
  private task: Promise<void> | undefined
  private timer: ReturnType<typeof setTimeout> | undefined

  constructor(
    index: WorkspaceIndex,
    events: WorkspaceIndexWatchEvents,
    options: WorkspaceIndexWatchOptions,
  ) {
    this.index = index
    this.events = events
    this.coalesceMs = options.coalesceMs ?? DEFAULT_INDEX_UPDATE_COALESCE_MS
    this.rebuildEventLimit = options.rebuildEventLimit ?? DEFAULT_INDEX_REBUILD_EVENT_LIMIT
    this.ready = new Promise((resolve) => {
      this.resolveReady = resolve
    })
  }

  start() {
    if (this.task) return

    this.task = this.consumeEvents()
  }

  async close() {
    this.closed = true
    this.abort.abort()
    this.clearTimer()
    this.pending = []
    this.pendingKeys.clear()
    await this.task
    await this.flushChain
  }

  private async consumeEvents() {
    let streamFailed = false

    try {
      for await (const event of this.events(this.abort.signal)) {
        if (event.type === 'ready') this.coverage ??= event.watch
        if (event.type === 'coverage') this.resumeWhenWatched(event.watch)
        this.resolveReady()
        this.enqueue(event)
      }
    } catch (error) {
      this.resolveReady()
      if (this.closed) return

      streamFailed = true
      this.index.markFailed('watch-stream-error', error)
    } finally {
      this.resolveReady()
      await this.finishConsumingEvents(streamFailed)
    }
  }

  private resumeWhenWatched(coverage: WatchCoverage) {
    this.coverage = coverage
    if (coverage.mode === 'limited') {
      this.flushChain = this.flushChain.then(() => this.index.turnOff('watch-limit'))
      return
    }
    this.flushChain = this.flushChain.then(async () => {
      await this.index.turnOn('watch-limit-freed')
    })
  }

  private async finishConsumingEvents(streamFailed: boolean) {
    if (streamFailed || this.closed) {
      this.pending = []
      this.pendingKeys.clear()
      return
    }

    await this.flushPending('stream-end')
  }

  private enqueue(event: WatchServerMessage) {
    let added = false

    for (const indexEvent of indexQueueEvents(event)) {
      if (!this.addPendingEvent(indexEvent)) continue

      added = true
      if (this.pending.length < this.rebuildEventLimit) continue

      this.clearTimer()
      void this.flushPending('event-limit')
      return
    }

    if (!added) return

    this.scheduleFlush()
  }

  private addPendingEvent(event: WatchServerMessage) {
    const key = pendingEventKey(event)
    if (this.pendingKeys.has(key)) return false

    this.pendingKeys.add(key)
    markWatchEventStale(this.index, event)
    this.pending.push(event)
    return true
  }

  private scheduleFlush() {
    if (this.timer) return

    this.timer = setTimeout(() => {
      this.timer = undefined
      void this.flushPending('coalesced')
    }, this.coalesceMs)
  }

  private clearTimer() {
    if (!this.timer) return

    clearTimeout(this.timer)
    this.timer = undefined
  }

  private flushPending(reason: string) {
    const events = this.takePending()
    if (events.length === 0) return this.flushChain

    this.flushChain = this.flushChain.then(
      () => this.applyPendingEvents(events, reason),
      () => this.applyPendingEvents(events, reason),
    )
    return this.flushChain
  }

  private takePending() {
    const events = this.pending
    this.pending = []
    this.pendingKeys.clear()
    return events
  }

  private async applyPendingEvents(events: readonly WatchServerMessage[], reason: string) {
    if (reason === 'event-limit') {
      await this.rebuildAfterFailure('watch-event-limit')
      return
    }

    try {
      await this.index.applyWatchEvents(events)
    } catch {
      await this.rebuildAfterFailure('incremental-update-failed')
    }
  }

  private async rebuildAfterFailure(reason: string) {
    if (this.index.status().readiness === 'failed') return

    try {
      await this.index.rebuild({ reason })
    } catch {
      // The failed rebuild status is retained on the index.
    }
  }
}

async function scanWorkspaceIndex(
  paths: WorkspacePaths,
  options: WorkspaceIndexOptions,
  signal?: AbortSignal,
) {
  const context = await createScanContext(paths, options, signal)

  await scanEntry(context, paths.workspaceRoot, '')
  return scanResult(context)
}

async function scanWorkspaceIndexPath(
  paths: WorkspacePaths,
  relativePath: string,
  options: WorkspaceIndexOptions,
) {
  const target = paths.resolve(relativePath)
  const context = await createScanContext(paths, options)
  if (shouldSkipTargetedScan(context, target.relativePath)) return scanResult(context)

  await scanEntry(context, target.absolutePath, target.relativePath)
  return scanResult(context)
}

async function createScanContext(
  paths: WorkspacePaths,
  options: WorkspaceIndexOptions,
  signal?: AbortSignal,
): Promise<ScanContext> {
  return {
    entries: new Map(),
    gitIgnore: await workspaceGitIgnoreMatcher(paths, options.ignore),
    paths,
    scanWarningCount: 0,
    signal,
    skippedEntryCount: 0,
  }
}

async function scanEntry(context: ScanContext, absolutePath: string, relativePath: string) {
  context.signal?.throwIfAborted()
  if (context.paths.isInternalPath(relativePath)) return
  const stats = await scanEntryStats(context, absolutePath, relativePath)
  if (!stats) return

  const entry = await indexEntry(context, relativePath, stats)
  context.entries.set(entry.path, entry)

  if (!shouldScanChildren(entry)) return

  await scanChildren(context, absolutePath, relativePath)
}

async function scanChildren(context: ScanContext, absoluteDirectory: string, relativePath: string) {
  const dirents = await scanDirents(context, absoluteDirectory, relativePath)

  for (const dirent of sortedDirents(dirents)) {
    const childRelativePath = joinRelative(relativePath, dirent.name)
    const childAbsolutePath = path.join(absoluteDirectory, dirent.name)
    await scanEntry(context, childAbsolutePath, childRelativePath)
  }
}

async function scanDirents(context: ScanContext, absoluteDirectory: string, relativePath: string) {
  try {
    return await readdir(absoluteDirectory, { withFileTypes: true })
  } catch (error) {
    if (!relativePath) throw error

    recordSkippedScanEntry(context)
    return []
  }
}

async function scanEntryStats(context: ScanContext, absolutePath: string, relativePath: string) {
  try {
    return await readEntryStats(absolutePath)
  } catch (error) {
    if (!relativePath) throw error

    recordSkippedScanEntry(context)
    return null
  }
}

function scanResult(context: ScanContext): ScanResult {
  return {
    entries: context.entries,
    scanWarningCount: context.scanWarningCount,
    skippedEntryCount: context.skippedEntryCount,
  }
}

function recordSkippedScanEntry(context: ScanContext) {
  context.scanWarningCount += 1
  context.skippedEntryCount += 1
}

async function indexEntry(
  context: ScanContext,
  relativePath: string,
  stats: FsEntryStats,
): Promise<WorkspaceIndexEntry> {
  const basename = path.posix.basename(relativePath)
  const defaultIgnored = isIgnoredPath(relativePath, defaultIgnoredNames)
  const effectiveType = entryEffectiveType(stats)
  const gitIgnored = context.gitIgnore.ignores(relativePath, effectiveType === 'directory')
  const extension = entryExtension(relativePath, effectiveType)
  const contentKind = await entryContentKind(context.paths, relativePath, stats, extension)
  const fileKind = entryFileKind(effectiveType, basename, extension, contentKind)

  return {
    basename,
    birthtimeMs: Number(stats.targetStats.birthtimeMs),
    charBag: pathCharBag(relativePath || basename),
    contentKind,
    defaultIgnored,
    extension,
    fileKind,
    gitIgnored,
    hidden: entryHidden(relativePath),
    mtimeMs: Number(stats.targetStats.mtimeMs),
    path: relativePath,
    size: Number(stats.targetStats.size),
    specialKind: specialKindFromStats(stats.displayStats),
    stale: false,
    targetSpecialKind: targetSpecialKindFromStats(stats),
    targetType: stats.targetType,
    type: stats.type,
    version: fileVersion(stats.targetStats),
  }
}

function shouldScanChildren(entry: WorkspaceIndexEntry) {
  if (entry.type !== 'directory') return false
  if (entry.defaultIgnored) return false
  if (entry.gitIgnored) return false

  return true
}

function entryEffectiveType(stats: FsEntryStats): EntryTypeFilter {
  return stats.targetType ?? stats.type
}

async function entryContentKind(
  paths: WorkspacePaths,
  relativePath: string,
  stats: FsEntryStats,
  extension: string,
): Promise<WorkspaceIndexContentKind> {
  if (entryEffectiveType(stats) !== 'file') return 'unknown'
  if (imageExtensions.has(extension)) return 'image'
  if (binaryExtensions.has(extension)) return 'binary'
  if (textExtensions.has(extension))
    return sniffKnownTextFileContentKind(paths, relativePath, stats)
  const sniffed = await sniffWorkspaceFileContentKind(paths, relativePath, stats)
  if (sniffed === 'binary') return 'binary'

  return sniffed
}

async function sniffKnownTextFileContentKind(
  paths: WorkspacePaths,
  relativePath: string,
  stats: FsEntryStats,
): Promise<WorkspaceIndexContentKind> {
  const absolutePath = paths.resolve(relativePath).absolutePath
  const size = Number(stats.targetStats.size)

  return sniffFileKnownTextContentKind(absolutePath, size)
}

function sniffWorkspaceFileContentKind(
  paths: WorkspacePaths,
  relativePath: string,
  stats: FsEntryStats,
) {
  return sniffFileContentKind(
    paths.resolve(relativePath).absolutePath,
    Number(stats.targetStats.size),
  )
}

function entryFileKind(
  type: EntryTypeFilter,
  basename: string,
  extension: string,
  contentKind: WorkspaceIndexContentKind,
): WorkspaceIndexFileKind {
  if (type !== 'file') return 'other'
  if (contentKind === 'image') return 'image'
  if (contentKind === 'binary') return 'binary'
  if (isConfigFileName(basename, extension)) return 'config'
  if (sourceExtensions.has(extension)) return 'source'
  if (documentExtensions.has(extension)) return 'document'

  return 'other'
}

function isConfigFileName(basename: string, extension: string) {
  if (configBasenames.has(basename)) return true
  if (basename.startsWith('.env.')) return true

  return configExtensions.has(extension)
}

async function sniffFileContentKind(
  absolutePath: string,
  size: number,
): Promise<WorkspaceIndexContentKind> {
  if (size === 0) return 'text'

  try {
    return await sniffReadableFileContentKind(absolutePath, size)
  } catch {
    return 'unknown'
  }
}

async function sniffFileKnownTextContentKind(
  absolutePath: string,
  size: number,
): Promise<WorkspaceIndexContentKind> {
  if (size === 0) return 'text'

  try {
    return await sniffReadableKnownTextContentKind(absolutePath, size)
  } catch {
    return 'unknown'
  }
}

async function readSniffBytes(absolutePath: string, size: number) {
  const handle = await open(absolutePath, 'r')
  try {
    const buffer = new Uint8Array(Math.min(size, SNIFF_BYTES))
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
    return buffer.subarray(0, bytesRead)
  } finally {
    await handle.close()
  }
}

async function sniffReadableFileContentKind(
  absolutePath: string,
  size: number,
): Promise<WorkspaceIndexContentKind> {
  return sniffBytes(await readSniffBytes(absolutePath, size))
}

async function sniffReadableKnownTextContentKind(
  absolutePath: string,
  size: number,
): Promise<WorkspaceIndexContentKind> {
  return (await readSniffBytes(absolutePath, size)).includes(0) ? 'binary' : 'text'
}

function sniffBytes(bytes: Uint8Array): WorkspaceIndexContentKind {
  if (bytes.length === 0) return 'text'
  if (isImageBytes(bytes)) return 'image'
  if (bytes.includes(0)) return 'binary'
  if (hasBinaryControlByte(bytes)) return 'binary'

  return 'text'
}

function isImageBytes(bytes: Uint8Array) {
  if (isPngBytes(bytes)) return true
  if (isJpegBytes(bytes)) return true
  if (isGifBytes(bytes)) return true
  if (isWebpBytes(bytes)) return true

  return isBmpBytes(bytes)
}

function isPngBytes(bytes: Uint8Array) {
  return bytesStartWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
}

function isJpegBytes(bytes: Uint8Array) {
  return bytesStartWith(bytes, [0xff, 0xd8, 0xff])
}

function isGifBytes(bytes: Uint8Array) {
  if (bytesStartWith(bytes, [0x47, 0x49, 0x46, 0x38, 0x37, 0x61])) return true

  return bytesStartWith(bytes, [0x47, 0x49, 0x46, 0x38, 0x39, 0x61])
}

function isWebpBytes(bytes: Uint8Array) {
  if (!bytesStartWith(bytes, [0x52, 0x49, 0x46, 0x46])) return false

  return bytesStartWith(bytes.subarray(8), [0x57, 0x45, 0x42, 0x50])
}

function isBmpBytes(bytes: Uint8Array) {
  return bytesStartWith(bytes, [0x42, 0x4d])
}

function bytesStartWith(bytes: Uint8Array, prefix: readonly number[]) {
  if (bytes.length < prefix.length) return false

  for (let index = 0; index < prefix.length; index += 1) {
    if (bytes[index] === prefix[index]) continue

    return false
  }

  return true
}

function hasBinaryControlByte(bytes: Uint8Array) {
  for (const byte of bytes) {
    if (!isBinaryControlByte(byte)) continue

    return true
  }

  return false
}

function isBinaryControlByte(byte: number) {
  if (byte === 9) return false
  if (byte === 10) return false
  if (byte === 13) return false

  return byte < 32
}

function entryExtension(relativePath: string, type: EntryTypeFilter) {
  if (type !== 'file') return ''

  return path.posix.extname(relativePath).toLowerCase()
}

// Returns undefined for the workspace root (key ''), which has no parent.
function parentIndexPath(entryPath: string) {
  if (!entryPath) return undefined

  const separatorIndex = entryPath.lastIndexOf('/')
  if (separatorIndex < 0) return ''

  return entryPath.slice(0, separatorIndex)
}

function indexPathKey(relativePath: string) {
  const normalized = path.posix.normalize(toPosix(relativePath) || '.')
  if (normalized === '.') return ''

  return normalized
}

function canApplyIncrementalUpdates(readiness: WorkspaceIndexReadiness) {
  if (readiness === 'ready') return true

  return readiness === 'stale'
}

function shouldSkipTargetedScan(context: ScanContext, relativePath: string) {
  if (!relativePath) return false
  if (context.paths.isInternalPath(relativePath)) return true

  return hasGitIgnoredAncestor(context.gitIgnore, relativePath)
}

function hasGitIgnoredAncestor(gitIgnore: GitIgnoreMatcher, relativePath: string) {
  const parts = relativePath.split('/')

  for (let index = 1; index < parts.length; index += 1) {
    const ancestor = parts.slice(0, index).join('/')
    if (gitIgnore.ignores(ancestor, true)) return true
  }

  return false
}

function defaultIgnoredScanRootPath(relativePath: string) {
  const parts = relativePath.split('/').filter(Boolean)
  const scanRootParts: string[] = []

  for (const part of parts) {
    scanRootParts.push(part)
    if (!isIgnoredPath(part, defaultIgnoredNames)) continue

    return scanRootParts.join('/')
  }

  return undefined
}

function firstMissingAncestorPath(
  entries: ReadonlyMap<string, WorkspaceIndexEntry>,
  relativePath: string,
) {
  const parts = relativePath.split('/').filter(Boolean)
  const ancestorParts = parts.slice(0, -1)
  const scanRootParts: string[] = []

  for (const part of ancestorParts) {
    scanRootParts.push(part)
    const ancestorPath = scanRootParts.join('/')
    if (entries.has(ancestorPath)) continue

    return ancestorPath
  }

  return undefined
}

function isWatchErrorEvent(event: WatchServerMessage) {
  return event.type === 'error'
}

function isWorkspaceIndexFilesystemEvent(
  event: WatchServerMessage,
): event is WorkspaceIndexFilesystemEvent {
  if (event.type === 'created') return true
  if (event.type === 'changed') return true
  if (event.type === 'deleted') return true

  return event.type === 'renamed'
}

function shouldQueueIndexEvent(event: WatchServerMessage) {
  if (isWatchErrorEvent(event)) return true

  return isWorkspaceIndexFilesystemEvent(event)
}

function indexQueueEvents(event: WatchServerMessage): WatchServerMessage[] {
  if (isWatchErrorEvent(event)) return [event]
  if (!isWorkspaceIndexFilesystemEvent(event)) return []
  if (event.type === 'renamed') return renamedIndexQueueEvents(event)

  return [pathIndexQueueEvent(event.path, event.type)]
}

function renamedIndexQueueEvents(
  event: Extract<WorkspaceIndexFilesystemEvent, { type: 'renamed' }>,
) {
  return dedupeQueueEvents([
    pathIndexQueueEvent(event.oldPath, 'deleted'),
    pathIndexQueueEvent(event.path, 'changed'),
  ])
}

function pathIndexQueueEvent(
  relativePath: string,
  action: IndexPathAction,
): WorkspaceIndexFilesystemEvent {
  const normalized = indexPathKey(relativePath)
  const ignoredRoot = defaultIgnoredScanRootPath(normalized)
  if (!ignoredRoot) return { path: normalized, type: action }
  if (action === 'deleted' && ignoredRoot === normalized) return { path: ignoredRoot, type: action }

  return { path: ignoredRoot, type: 'changed' }
}

function dedupeQueueEvents(events: readonly WorkspaceIndexFilesystemEvent[]) {
  const result: WorkspaceIndexFilesystemEvent[] = []
  const seen = new Set<string>()

  for (const event of events) {
    const key = pendingEventKey(event)
    if (seen.has(key)) continue

    seen.add(key)
    result.push(event)
  }

  return result
}

function pendingEventKey(event: WatchServerMessage) {
  if (isWorkspaceIndexFilesystemEvent(event)) return `${event.type}:${event.path}`
  if (isWatchErrorEvent(event)) return `error:${event.code}:${event.message}`

  return event.type
}

function markWatchEventStale(index: WorkspaceIndex, event: WatchServerMessage) {
  if (!isWorkspaceIndexFilesystemEvent(event)) return

  if (event.type === 'created') {
    index.markCreatedPathPending(event.path)
    return
  }

  index.markSubtreeStale(event.path)
  if (event.type !== 'renamed') return

  index.markSubtreeStale(event.oldPath)
}

function shouldRebuildForFilesystemEvent(event: WorkspaceIndexFilesystemEvent) {
  if (event.path === '.gitignore') return true
  if (event.type !== 'renamed') return false

  return event.oldPath === '.gitignore'
}

function specialKindFromStats(stats: Stats): WorkspaceIndexSpecialKind | undefined {
  if (stats.isFIFO()) return 'fifo'
  if (stats.isSocket()) return 'socket'
  if (stats.isBlockDevice()) return 'block-device'
  if (stats.isCharacterDevice()) return 'character-device'
  if (stats.isFile()) return undefined
  if (stats.isDirectory()) return undefined
  if (stats.isSymbolicLink()) return undefined

  return 'unknown'
}

function targetSpecialKindFromStats(stats: FsEntryStats) {
  if (!stats.targetType) return undefined
  if (stats.targetType !== 'other') return undefined

  return specialKindFromStats(stats.targetStats)
}

function entryHidden(relativePath: string) {
  if (!relativePath) return false

  return relativePath.split('/').some((part) => part.startsWith('.'))
}

function pathCharBag(relativePath: string) {
  const characters = new Set<string>()

  for (const character of relativePath.toLowerCase()) {
    if (character === '/') continue
    characters.add(character)
  }

  return Array.from(characters).sort().join('')
}

function recordIndexBuild(status: WorkspaceIndexStatus) {
  recordProcessInfo('fs.workspace_index.build', {
    area: 'fs',
    root: status.scanRoot,
    reason: status.rebuildReason,
    readiness: status.readiness,
    durationMs: status.lastFullScanDurationMs,
    entryCount: status.entryCount,
    fileCount: status.fileCount,
    skippedEntryCount: status.skippedEntryCount,
    scanWarningCount: status.scanWarningCount,
    errorMessage: status.errorMessage,
  })
}

function emptyStatus(scanRoot: string): WorkspaceIndexStatus {
  return {
    entryCount: 0,
    fileCount: 0,
    pendingCreatedPathCount: 0,
    readiness: 'cold',
    scanWarningCount: 0,
    scanRoot,
    skippedEntryCount: 0,
    staleEntryCount: 0,
  }
}

export function inactiveWorkspaceIndexStatus(): WorkspaceIndexStatus {
  return {
    entryCount: 0,
    fileCount: 0,
    pendingCreatedPathCount: 0,
    readiness: 'cold',
    scanRoot: null,
    scanWarningCount: 0,
    skippedEntryCount: 0,
    staleEntryCount: 0,
  }
}

function readyStatus(
  scanRoot: string,
  counts: WorkspaceIndexCounts,
  result: ScanResult,
  startedAt: number,
  reason: string,
): WorkspaceIndexStatus {
  return {
    entryCount: counts.entryCount,
    fileCount: counts.fileCount,
    lastFullScanAtMs: Date.now(),
    lastFullScanDurationMs: elapsedMs(startedAt),
    pendingCreatedPathCount: 0,
    readiness: 'ready',
    rebuildReason: reason,
    scanWarningCount: result.scanWarningCount,
    scanRoot,
    skippedEntryCount: result.skippedEntryCount,
    staleEntryCount: counts.staleEntryCount,
  }
}

function failedStatus(
  scanRoot: string,
  startedAt: number,
  reason: string,
  error: unknown,
): WorkspaceIndexStatus {
  return {
    entryCount: 0,
    errorMessage: errorMessage(error),
    fileCount: 0,
    lastFullScanDurationMs: elapsedMs(startedAt),
    pendingCreatedPathCount: 0,
    readiness: 'failed',
    rebuildReason: reason,
    scanWarningCount: 0,
    scanRoot,
    skippedEntryCount: 0,
    staleEntryCount: 0,
  }
}

function failedLiveStatus(
  previous: WorkspaceIndexMutableStatus,
  counts: WorkspaceIndexCounts,
  reason: string,
  error: unknown,
): WorkspaceIndexStatus {
  return {
    ...previous,
    entryCount: counts.entryCount,
    errorMessage: errorMessage(error),
    fileCount: counts.fileCount,
    lastIncrementalUpdateAtMs: Date.now(),
    pendingCreatedPathCount: 0,
    readiness: 'failed',
    rebuildReason: reason,
    staleEntryCount: counts.staleEntryCount,
  }
}

function staleLiveStatus(
  previous: WorkspaceIndexMutableStatus,
  counts: WorkspaceIndexCounts,
  pendingCreatedPaths = new Set<string>(),
): WorkspaceIndexStatus {
  return {
    ...previous,
    lastIncrementalUpdateAtMs: Date.now(),
    pendingCreatedPathCount: pendingCreatedPaths.size,
    readiness: 'stale',
    staleEntryCount: counts.staleEntryCount,
  }
}

function incrementalStatus(
  previous: WorkspaceIndexMutableStatus,
  counts: WorkspaceIndexCounts,
  result?: ScanResult,
): WorkspaceIndexStatus {
  return {
    ...previous,
    entryCount: counts.entryCount,
    errorMessage: undefined,
    fileCount: counts.fileCount,
    lastIncrementalUpdateAtMs: Date.now(),
    pendingCreatedPathCount: 0,
    readiness: counts.staleEntryCount === 0 ? 'ready' : 'stale',
    scanWarningCount: previous.scanWarningCount + (result?.scanWarningCount ?? 0),
    skippedEntryCount: previous.skippedEntryCount + (result?.skippedEntryCount ?? 0),
    staleEntryCount: counts.staleEntryCount,
  }
}

function statusWithPendingCreatedPathCount(
  previous: WorkspaceIndexMutableStatus,
  pendingCreatedPaths: ReadonlySet<string>,
): WorkspaceIndexStatus {
  return {
    ...previous,
    pendingCreatedPathCount: pendingCreatedPaths.size,
  }
}

function cloneEntry(entry: WorkspaceIndexEntry): WorkspaceIndexEntry {
  return { ...entry }
}

const imageExtensions = new Set([
  '.avif',
  '.bmp',
  '.gif',
  '.heic',
  '.ico',
  '.jpeg',
  '.jpg',
  '.png',
  '.tif',
  '.tiff',
  '.webp',
])

const binaryExtensions = new Set(['.7z', '.dmg', '.exe', '.gz', '.pdf', '.tar', '.wasm', '.zip'])

const configExtensions = new Set([
  '.config',
  '.editorconfig',
  '.env',
  '.ini',
  '.json',
  '.jsonc',
  '.lock',
  '.toml',
  '.yaml',
  '.yml',
])

const configBasenames = new Set(['.editorconfig', '.env'])

const sourceExtensions = new Set([
  '.c',
  '.cc',
  '.cpp',
  '.css',
  '.go',
  '.h',
  '.hpp',
  '.html',
  '.java',
  '.js',
  '.jsx',
  '.kt',
  '.lua',
  '.php',
  '.py',
  '.rb',
  '.rs',
  '.scss',
  '.sh',
  '.swift',
  '.ts',
  '.tsx',
  '.vue',
])

const documentExtensions = new Set([
  '.csv',
  '.log',
  '.md',
  '.mdx',
  '.rst',
  '.svg',
  '.tsv',
  '.txt',
  '.xml',
])

const textExtensions = new Set([...configExtensions, ...sourceExtensions, ...documentExtensions])
