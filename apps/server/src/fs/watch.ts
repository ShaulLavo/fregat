import { createHash } from 'node:crypto'
import { createReadStream, watch } from 'node:fs'
import path from 'node:path'
import {
  errorSummary,
  recordRequestContext,
  recordRequestWarning,
  runDetached,
} from '../observability'
import { OpenFileWatches } from './open-file-watches'
import { FsError } from './errors'
import {
  defaultIgnoredNames,
  isIgnoredPath,
  resolveExistingPath,
  toPosix,
  type WorkspacePaths,
} from './path'
import { entryFromStat } from './entry'
import { statPath } from './stat'
import { isWriteTemporaryPath } from './write'
import type { TreeEntry, WatchServerMessage } from './contracts'

type Listener = (event: WatchServerMessage) => void
type WatchRelease = () => void | Promise<void>
type RenameWatchServerMessage = Extract<WatchServerMessage, { type: 'renamed' }>
type WatcherEntry = {
  refCount: number
  release: Promise<WatchRelease>
}
type WakeSlot = {
  current: (() => void) | null
}
type TransactionBarrier = {
  readonly internalPaths: Set<string>
  readonly paths: Set<string>
  readonly queued: WatchServerMessage[]
}
type TransactionResultMarker = {
  readonly exists: boolean
  readonly generation: number
  readonly operationId: string
  readonly version?: string
}
type TransactionResultSignature = {
  readonly exists: boolean
  readonly path: string
  readonly version?: string
}
type WriteBarrier = {
  readonly paths: ReadonlySet<string>
  readonly queued: WatchServerMessage[]
  readonly settled: Promise<void>
  readonly release: () => void
}
type WriteResultMarker = {
  readonly origin: string
  readonly writeId: string
  readonly version: string
}

// Narrower than the tree's list: language servers and open files need rebuilt declarations in
// `dist` and `build` and a package arriving in `node_modules`, not its contents (VS Code's default).
const watcherIgnoredNames = defaultIgnoredNames.filter(
  (name) => name !== 'node_modules' && name !== 'dist' && name !== 'build',
)

// A file is written after it is created, so a brand-new entry's mtime trails
// its birthtime by however long the write took. Measured under Bun on APFS: 3ms
// for 10MB, 25ms for 50MB, 112ms for 200MB. Anything past this window is a
// later edit of a file we watched being born, not part of its creation.
const createWriteSettleMs = 250

// One kernel tick at HZ=100, the coarsest common configuration.
const coarseClockToleranceMs = 10

export type WatchOptions = {
  enabled: boolean
}

export type WatchStreamOptions = {
  onlyFiles?: boolean
  includeIgnored?: boolean
  files?: readonly string[]
  /** Watch each input's own entries only, never its subtree. */
  shallow?: boolean
}

export class FileChangeHub {
  private readonly listeners = new Set<Listener>()
  private readonly nativeWatchers = new Map<string, WatcherEntry>()
  private readonly shallowWatchers = new Map<string, WatcherEntry>()
  private readonly paths: WorkspacePaths
  private readonly openFiles: OpenFileWatches
  private readonly rawListeners = new Set<Listener>()
  private readonly transactionBarriers = new Map<string, TransactionBarrier>()
  private readonly transactionResultMarkers = new Map<string, TransactionResultMarker>()
  private readonly writes = new Set<WriteBarrier>()
  private readonly writeResultMarkers = new Map<string, WriteResultMarker>()
  private readonly watchEnabled: boolean
  private nextSequence = 1

  constructor(paths: WorkspacePaths, options: WatchOptions) {
    this.paths = paths
    this.watchEnabled = options.enabled
    this.openFiles = new OpenFileWatches(
      paths,
      (alias) =>
        runDetached(() => this.emitNativeEvent(alias, (entry) => (entry ? 'changed' : 'deleted')), {
          area: 'fs',
          operation: 'watch_open_file',
          path: alias,
        }),
      (error, alias) => this.emit(watchError(error, alias)),
    )
  }

  emit(event: WatchServerMessage) {
    if (isInternalFilesystemEvent(this.paths, event)) return
    const write = this.writeBarrierFor(event)
    if (write) {
      write.queued.push(event)
      return
    }
    const attributedEvent = this.attributeTransactionEvent(this.attributeWriteEvent(event))
    const barrier = this.transactionBarrierFor(attributedEvent)
    if (barrier) {
      barrier.queued.push(attributedEvent)
      return
    }

    const sequenced = this.withSequence(attributedEvent)
    if (!isFilesystemEvent(attributedEvent)) {
      this.broadcast(sequenced)
      return
    }

    if (sequenced.type === 'renamed') {
      this.broadcastRenamed(sequenced)
      return
    }

    if (isIgnoredPath(attributedEvent.path)) {
      this.broadcastRaw(sequenced)
      return
    }

    this.broadcast(sequenced)
  }

  stream(inputs: string[], signal?: AbortSignal, options: WatchStreamOptions = {}) {
    const subscribed = subscribedPaths(this.paths, inputs)
    const files = new Set(
      (options.files ?? []).map((input) => this.paths.resolve(input).relativePath),
    )
    const listeners = options.includeIgnored || files.size > 0 ? this.rawListeners : this.listeners
    return this.createStream(subscribed, signal, listeners, files, options)
  }

  info() {
    return {
      nativeWatcherCount: this.nativeWatchers.size,
      openFileWatcherCount: this.openFiles.size,
      shallowWatcherCount: this.shallowWatchers.size,
      watchEnabled: this.watchEnabled,
    }
  }

  beginTransaction(operationId: string, paths: readonly string[]) {
    if (this.transactionBarriers.has(operationId)) return

    this.transactionBarriers.set(operationId, {
      internalPaths: new Set(),
      paths: new Set(paths.map((input) => this.paths.resolve(input).relativePath)),
      queued: [],
    })
  }

  beginWrite(paths: readonly string[]): WriteBarrier {
    const { promise: settled, resolve: release } = Promise.withResolvers<void>()
    const write: WriteBarrier = {
      paths: new Set(paths.map((input) => this.paths.resolve(input).relativePath)),
      queued: [],
      settled,
      release,
    }
    this.writes.add(write)
    return write
  }

  finishWrite(write: WriteBarrier, event?: WatchServerMessage) {
    if (!this.writes.delete(write)) return
    if (event && isFilesystemEvent(event) && event.origin && event.writeId && event.version) {
      const marker = { origin: event.origin, writeId: event.writeId, version: event.version }
      for (const relativePath of write.paths) this.writeResultMarkers.set(relativePath, marker)
    }
    if (event) this.emit(event)
    for (const queued of write.queued) this.emit(queued)
    write.release()
  }

  addTransactionPaths(operationId: string, paths: readonly string[]) {
    const barrier = this.transactionBarriers.get(operationId)
    if (!barrier) return

    for (const input of paths) barrier.internalPaths.add(this.paths.resolve(input).relativePath)
  }

  finishTransaction(
    operationId: string,
    outcome: 'drop' | 'publish',
    events: readonly WatchServerMessage[] = [],
  ) {
    const barrier = this.transactionBarriers.get(operationId)
    if (!barrier) return

    this.transactionBarriers.delete(operationId)
    if (outcome === 'drop') return

    for (const event of events) this.emit(event)
  }

  transactionBarrierInfo(operationId: string) {
    const barrier = this.transactionBarriers.get(operationId)
    if (!barrier) return null

    return { paths: Array.from(barrier.paths), queuedEventCount: barrier.queued.length }
  }

  recordTransactionResults(
    operationId: string,
    generation: number,
    results: readonly TransactionResultSignature[],
  ) {
    this.forgetTransactionResults(operationId)
    const barrier = this.transactionBarriers.get(operationId)
    for (const relativePath of barrier?.internalPaths ?? []) {
      this.transactionResultMarkers.set(relativePath, {
        exists: false,
        generation,
        operationId,
      })
    }
    for (const result of results) {
      const relativePath = this.paths.resolve(result.path).relativePath
      this.transactionResultMarkers.set(relativePath, {
        exists: result.exists,
        generation,
        operationId,
        version: result.version,
      })
    }
  }

  forgetTransactionResults(operationId: string) {
    for (const [relativePath, marker] of this.transactionResultMarkers) {
      if (marker.operationId === operationId) this.transactionResultMarkers.delete(relativePath)
    }
  }

  async close() {
    this.openFiles.close()
    const releases = await Promise.all(
      [...this.nativeWatchers.values(), ...this.shallowWatchers.values()].map(
        (entry) => entry.release,
      ),
    )
    this.nativeWatchers.clear()
    this.shallowWatchers.clear()
    this.listeners.clear()
    this.rawListeners.clear()
    this.transactionBarriers.clear()
    this.transactionResultMarkers.clear()
    for (const write of this.writes) write.release()
    this.writes.clear()
    this.writeResultMarkers.clear()
    await releaseWatchers(releases)
  }

  private attributeTransactionEvent(event: WatchServerMessage): WatchServerMessage {
    if (!isFilesystemEvent(event)) return event
    if (event.origin || event.writeId) return event
    const marker = this.transactionResultMarkers.get(event.path)
    if (!marker) return event

    this.transactionResultMarkers.delete(event.path)
    if (!eventMatchesTransactionResult(event, marker)) return event

    return { ...event, origin: 'workspace-edit', writeId: marker.operationId }
  }

  private attributeWriteEvent(event: WatchServerMessage): WatchServerMessage {
    if (!isFilesystemEvent(event) || event.origin || event.writeId) return event
    const marker = this.writeResultMarkers.get(event.path)
    if (!marker) return event
    if (event.type !== 'deleted' && event.version === marker.version) {
      return { ...event, origin: marker.origin, writeId: marker.writeId }
    }
    this.writeResultMarkers.delete(event.path)
    return event
  }

  private writeBarrierFor(event: WatchServerMessage) {
    for (const write of this.writes) {
      if (eventTouchesBarrier(event, write.paths)) return write
    }
    return undefined
  }

  private writeForPath(relativePath: string) {
    for (const write of this.writes) {
      if (write.paths.has(relativePath)) return write
    }
    return undefined
  }

  private async waitForWrite(relativePath: string) {
    let write = this.writeForPath(relativePath)
    while (write) {
      await write.settled
      write = this.writeForPath(relativePath)
    }
  }

  private async emitNativeEvent(
    relativePath: string,
    classify: (entry: TreeEntry | undefined) => 'created' | 'changed' | 'deleted' | null,
  ) {
    while (true) {
      await this.waitForWrite(relativePath)
      const marker = this.writeResultMarkers.get(relativePath)
      const entry = await nativeEventEntry(this.paths, relativePath, marker !== undefined)
      if (this.writeForPath(relativePath) || this.writeResultMarkers.get(relativePath) !== marker)
        continue
      let type = classify(entry)
      if (!type) return
      if (type === 'deleted' && marker && entry?.version === marker.version) type = 'changed'
      this.emit(
        nativeWatchEvent(type, relativePath, isIgnoredPath(relativePath) ? undefined : entry),
      )
      return
    }
  }

  private async retainWatcher(relativeRoot: string): Promise<WatchRelease> {
    if (!this.watchEnabled) {
      return noop
    }

    // A covered subtree is already watched; a second recursive watch would only crawl it again.
    const root = coveringWatcherRoot(this.nativeWatchers, relativeRoot) ?? relativeRoot
    const existing = this.nativeWatchers.get(root)
    if (existing) {
      existing.refCount += 1
      await existing.release
      return () => this.releaseWatcher(this.nativeWatchers, root)
    }

    // Bun's recursive watch cannot skip a subtree; `watcherIgnores` drops those events before any stat.
    const release = Promise.resolve(this.createNodeWatcher(root))
    this.nativeWatchers.set(root, { refCount: 1, release })
    await release

    return () => this.releaseWatcher(this.nativeWatchers, root)
  }

  private async retainShallowWatcher(relativeDirectory: string): Promise<WatchRelease> {
    if (!this.watchEnabled) return noop

    const existing = this.shallowWatchers.get(relativeDirectory)
    if (existing) {
      existing.refCount += 1
      await existing.release
      return () => this.releaseWatcher(this.shallowWatchers, relativeDirectory)
    }

    const release = Promise.resolve(this.createNodeWatcher(relativeDirectory, false))
    this.shallowWatchers.set(relativeDirectory, { refCount: 1, release })
    await release

    return () => this.releaseWatcher(this.shallowWatchers, relativeDirectory)
  }

  private async releaseWatcher(watchers: Map<string, WatcherEntry>, relativeRoot: string) {
    const entry = watchers.get(relativeRoot)
    if (!entry) return

    entry.refCount -= 1
    if (entry.refCount > 0) return

    watchers.delete(relativeRoot)
    await releaseWatcher(await entry.release)
  }

  private createNodeWatcher(relativeRoot: string, recursive = true): WatchRelease {
    try {
      const target = this.paths.resolve(relativeRoot)
      const attachedAtMs = wallClockMs()
      const watcher = watch(target.absolutePath, { recursive }, (event, filename) => {
        if (filename && watcherIgnores(normalizeWatchFilename(filename.toString()))) return
        runDetached(
          () => this.handleNodeEvent(relativeRoot, event, filename?.toString() ?? '', attachedAtMs),
          { area: 'fs', backend: 'node', operation: 'watch_event' },
        )
      })
      watcher.on('error', (error) => {
        this.emit(watchError(error, relativeRoot))
      })
      return () => watcher.close()
    } catch (error) {
      this.emit(watchError(error, relativeRoot))
      return noop
    }
  }

  private async handleNodeEvent(
    relativeRoot: string,
    nativeEvent: string,
    filename: string,
    attachedAtMs: number,
  ) {
    const relativePath = watchEventPath(relativeRoot, filename)
    await this.emitNativeEvent(relativePath, (entry) =>
      nativeEventType(nativeEvent, entry, attachedAtMs),
    )
  }

  private async *createStream(
    subscribed: Set<string>,
    signal: AbortSignal | undefined,
    listeners: Set<Listener>,
    files: Set<string>,
    options: WatchStreamOptions,
  ) {
    const queue: WatchServerMessage[] = [{ type: 'ready', root: '' }]
    const wake: WakeSlot = { current: null }

    const listener = (event: WatchServerMessage) => {
      const visible = streamEvent(event, files, options.includeIgnored ?? false)
      if (!visible || !deliverWatchEvent(visible, subscribed, files, options.onlyFiles)) return

      queue.push(visible)
      wake.current?.()
    }

    const abort = () => wake.current?.()
    let releases: WatchRelease[] = []
    const startedAt = performance.now()
    // A files stream owns a watch per file, so its `ready` never waits on a project crawl.
    const roots = options.onlyFiles ? new Set<string>() : subscribed
    listeners.add(listener)
    signal?.addEventListener('abort', abort)

    try {
      for (const input of roots) {
        releases.push(
          await (options.shallow ? this.retainShallowWatcher(input) : this.retainWatcher(input)),
        )
      }
      if (this.watchEnabled) {
        for (const file of files) releases.push(await this.retainOpenFile(file, roots))
      }
      recordRequestContext({
        watch: {
          scope: options.onlyFiles ? 'files' : 'project',
          openFiles: [...files],
          readyMs: Math.round(performance.now() - startedAt),
          ...this.info(),
        },
      })

      yield* drainWatchQueue(queue, signal, wake)
    } finally {
      await releaseWatchers(releases)
      listeners.delete(listener)
      signal?.removeEventListener('abort', abort)
    }
  }

  private async retainOpenFile(file: string, roots: Set<string>): Promise<WatchRelease> {
    try {
      return await this.openFiles.retain(file, [...roots])
    } catch (error) {
      recordRequestWarning('fs.watch.open_file_failed', {
        area: 'fs',
        path: file,
        error: errorSummary(error),
      })
      this.emit(watchError(error, file))
      return noop
    }
  }

  private broadcast(event: WatchServerMessage) {
    this.broadcastTo(this.listeners, event)
    this.broadcastRaw(event)
  }

  private broadcastRaw(event: WatchServerMessage) {
    this.broadcastTo(this.rawListeners, event)
  }

  private broadcastRenamed(event: RenameWatchServerMessage) {
    const pathIgnored = isIgnoredPath(event.path)
    const oldPathIgnored = isIgnoredPath(event.oldPath)
    if (!pathIgnored && !oldPathIgnored) {
      this.broadcast(event)
      return
    }

    this.broadcastRaw(event)
    if (pathIgnored && oldPathIgnored) return
    if (pathIgnored) {
      this.broadcastTo(this.listeners, renamedDeleteEvent(event))
      return
    }

    this.broadcastTo(this.listeners, renamedCreateEvent(event))
  }

  private broadcastTo(listeners: Set<Listener>, event: WatchServerMessage) {
    for (const listener of listeners) listener(event)
  }

  private withSequence(event: WatchServerMessage): WatchServerMessage {
    return { ...event, sequence: this.nextSequence++ }
  }

  private transactionBarrierFor(event: WatchServerMessage) {
    if (!isFilesystemEvent(event)) return undefined

    for (const barrier of this.transactionBarriers.values()) {
      if (eventTouchesBarrier(event, barrier.paths)) return barrier
      if (eventTouchesBarrier(event, barrier.internalPaths)) return barrier
    }

    return undefined
  }
}

/** What the watcher drops: ignored names, and anything below a package inside `node_modules`. */
function watcherIgnores(relativePath: string) {
  const parts = relativePath.split('/')
  const modules = parts.indexOf('node_modules')
  if (modules >= 0 && parts.length > modules + 2) return true
  return isIgnoredPath(relativePath, watcherIgnoredNames)
}

/** Whether a recursive watcher misses part of this subtree; `node_modules` is watched one level deep. */
function watcherHides(relativePath: string) {
  return (
    relativePath.split('/').includes('node_modules') ||
    isIgnoredPath(relativePath, watcherIgnoredNames)
  )
}

/** The closest watched ancestor whose ignore rules do not hide `relativeRoot`. */
function coveringWatcherRoot(watchers: ReadonlyMap<string, WatcherEntry>, relativeRoot: string) {
  let covering: string | null = null
  for (const root of watchers.keys()) {
    if (root === relativeRoot) return root
    if (root && !relativeRoot.startsWith(`${root}/`)) continue
    if (watcherHides(root ? relativeRoot.slice(root.length + 1) : relativeRoot)) continue
    if (covering === null || root.length > covering.length) covering = root
  }
  return covering
}

function subscribedPaths(paths: WorkspacePaths, inputs: string[]) {
  const subscribed = new Set(inputs.map((input) => paths.resolve(input).relativePath))
  if (!subscribed.size) subscribed.add('')

  return subscribed
}

function watchEventPath(relativeRoot: string, filename: string) {
  const relativeFilename = normalizeWatchFilename(filename)
  if (!relativeFilename) return relativeRoot
  if (!relativeRoot) return relativeFilename

  return toPosix(path.join(relativeRoot, relativeFilename))
}

function normalizeWatchFilename(filename: string) {
  return toPosix(filename).replace(/^\/+/u, '')
}

function isFilesystemEvent(event: WatchServerMessage) {
  return (
    event.type === 'created' ||
    event.type === 'changed' ||
    event.type === 'deleted' ||
    event.type === 'renamed'
  )
}

function renamedCreateEvent(event: RenameWatchServerMessage): WatchServerMessage {
  return {
    entry: event.entry,
    origin: event.origin,
    path: event.path,
    sequence: event.sequence,
    type: 'created',
    version: event.version,
    writeId: event.writeId,
  }
}

function renamedDeleteEvent(event: RenameWatchServerMessage): WatchServerMessage {
  return {
    origin: event.origin,
    path: event.oldPath,
    sequence: event.sequence,
    type: 'deleted',
    version: event.version,
    writeId: event.writeId,
  }
}

async function* drainWatchQueue(
  queue: WatchServerMessage[],
  signal: AbortSignal | undefined,
  wake: WakeSlot,
) {
  while (!signal?.aborted) {
    const event = queue.shift()
    if (event) {
      yield event
      continue
    }

    await waitForWatchQueue(signal, wake)
  }
}

function waitForWatchQueue(signal: AbortSignal | undefined, wake: WakeSlot) {
  return new Promise<void>((resolve) => {
    const finish = () => {
      if (wake.current === finish) wake.current = null
      signal?.removeEventListener('abort', finish)
      resolve()
    }

    wake.current = finish
    signal?.addEventListener('abort', finish, { once: true })
    if (signal?.aborted) finish()
  })
}

function shouldDeliver(event: WatchServerMessage, subscribed: Set<string>) {
  if (!isFilesystemEvent(event)) return true
  if (isSubscribedPath(event.path, subscribed)) return true
  if (event.type === 'renamed') return isSubscribedPath(event.oldPath, subscribed)

  return false
}

function deliverWatchEvent(
  event: WatchServerMessage,
  roots: Set<string>,
  files: Set<string>,
  onlyFiles = false,
) {
  if (!isFilesystemEvent(event)) return true
  if (files.has(event.path)) return true
  if (event.type === 'renamed' && files.has(event.oldPath)) return true
  return !onlyFiles && shouldDeliver(event, roots)
}

function streamEvent(event: WatchServerMessage, files: Set<string>, includeIgnored: boolean) {
  if (includeIgnored || !isFilesystemEvent(event)) return event
  const visible = !isIgnoredPath(event.path) || files.has(event.path)
  if (event.type !== 'renamed') return visible ? event : null
  const oldVisible = !isIgnoredPath(event.oldPath) || files.has(event.oldPath)
  if (visible && oldVisible) return event
  if (visible) return renamedCreateEvent(event)
  if (oldVisible) return renamedDeleteEvent(event)
  return null
}

function isSubscribedPath(relativePath: string, subscribed: Set<string>) {
  for (const root of subscribed) {
    if (!root) return true
    if (relativePath === root) return true
    if (relativePath.startsWith(`${root}/`)) return true
  }

  return false
}

function eventTouchesBarrier(event: WatchServerMessage, paths: ReadonlySet<string>) {
  if (!isFilesystemEvent(event)) return false
  if (pathOrAncestorIn(event.path, paths)) return true
  if (event.type !== 'renamed') return false

  return pathOrAncestorIn(event.oldPath, paths)
}

/** A moved or deleted folder holds back the native events of everything inside it too. */
function pathOrAncestorIn(relativePath: string, paths: ReadonlySet<string>) {
  let candidate = relativePath
  while (true) {
    if (paths.has(candidate)) return true
    const separator = candidate.lastIndexOf('/')
    if (separator < 0) return false
    candidate = candidate.slice(0, separator)
  }
}

function eventMatchesTransactionResult(event: WatchServerMessage, marker: TransactionResultMarker) {
  if (!marker.exists) return event.type === 'deleted'
  if (event.type === 'deleted') return false
  if (event.type !== 'created' && event.type !== 'changed' && event.type !== 'renamed') return false

  return event.version === marker.version
}

function isInternalFilesystemEvent(paths: WorkspacePaths, event: WatchServerMessage) {
  if (!isFilesystemEvent(event)) return false
  if (paths.isInternalPath(event.path) || isWriteTemporaryPath(event.path)) return true
  if (event.type !== 'renamed') return false

  return paths.isInternalPath(event.oldPath) || isWriteTemporaryPath(event.oldPath)
}

function nativeWatchEvent(
  type: 'created' | 'changed' | 'deleted',
  path: string,
  entry: TreeEntry | undefined,
): WatchServerMessage {
  if (type === 'deleted') return { type, path }
  if (!entry) return { type, path }

  return { type, path, entry, version: entry.version }
}

// Node reports a bare `rename` for every mutation macOS FSEvents forwards —
// creations, plain writes, deletions and move-ins all arrive identically — so
// the event name alone cannot classify anything. The filesystem can: an entry's
// birthtime says when the inode appeared, and comparing that to the moment this
// watcher attached tells creation from modification without keeping a cache of
// paths that could never contain the files present at startup.
export function nativeEventType(
  nativeEvent: string,
  entry: TreeEntry | undefined,
  attachedAtMs: number,
): 'created' | 'changed' | 'deleted' | null {
  if (!entry) return 'deleted'
  if (nativeEvent === 'change') return 'changed'

  return existingPathEventType(entry, attachedAtMs)
}

function existingPathEventType(entry: TreeEntry, attachedAtMs: number) {
  // Filesystems that do not track birthtime report 0. There the old, broader
  // `created` stands: it makes the client refresh the whole directory, which
  // repairs a superset of what `changed` does.
  if (!(entry.birthtimeMs > 0)) return 'created'

  // File timestamps come from the kernel's coarse clock, up to a tick behind the
  // precise one: a file born just after the attach can be stamped just before it.
  const attachedMs = Math.floor(attachedAtMs) - coarseClockToleranceMs
  if (entry.birthtimeMs >= attachedMs) return bornWhileWatchingEventType(entry)
  // macOS replays writes made just before a watcher attaches. The event is
  // real, but its subject is not news: this inode predates us and its content
  // has not been touched since we started watching, so there is nothing a
  // client could learn from it.
  if (entry.mtimeMs < attachedMs) return null

  return 'changed'
}

function bornWhileWatchingEventType(entry: TreeEntry) {
  return entry.mtimeMs - entry.birthtimeMs > createWriteSettleMs ? 'changed' : 'created'
}

function wallClockMs() {
  return performance.timeOrigin + performance.now()
}

async function nativeEventEntry(
  paths: WorkspacePaths,
  relativePath: string,
  includeContentVersion = false,
): Promise<TreeEntry | undefined> {
  try {
    const entry = entryFromStat(await statPath(paths, relativePath))
    if (!includeContentVersion || entry.type !== 'file') return entry
    return withNativeContentVersion(paths, relativePath, entry)
  } catch {
    return undefined
  }
}

async function withNativeContentVersion(
  paths: WorkspacePaths,
  relativePath: string,
  entry: TreeEntry,
) {
  try {
    return { ...entry, version: await nativeContentVersion(paths, relativePath) }
  } catch (error) {
    recordRequestWarning('fs.watch.content_version_failed', {
      area: 'fs',
      operation: 'watch_event',
      path: relativePath,
      error: errorSummary(error),
    })
    return entry
  }
}

async function nativeContentVersion(paths: WorkspacePaths, relativePath: string) {
  const target = await resolveExistingPath(paths, relativePath)
  const hash = createHash('sha256')
  for await (const bytes of createReadStream(target.absolutePath)) hash.update(bytes)
  return `sha256:${hash.digest('hex')}`
}

function watchError(error: unknown, path: string): WatchServerMessage {
  return {
    type: 'error',
    code: 'WATCH_FAILED',
    message: `failed to watch ${path || '/'}: ${errorMessage(error)}`,
  }
}

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message

  return 'native filesystem watcher failed'
}

async function releaseWatchers(releases: WatchRelease[]) {
  await Promise.all(releases.map(releaseWatcher))
}

async function releaseWatcher(release: WatchRelease) {
  try {
    await release()
  } catch {
    // Watcher teardown should not fail the owning SSE stream.
  }
}

function noop() {}

export function parseWatchInputs(pathInput?: string, pathsInput?: string | string[]) {
  const inputs = [pathInput].concat(pathInputs(pathsInput))
  const trimmed = inputs.map((input) => input?.trim() ?? '').filter(Boolean)

  if (!trimmed.length) return []
  if (trimmed.some((input) => input.includes(path.delimiter))) throw new FsError('INVALID_PATH')

  return trimmed
}

function pathInputs(input?: string | string[]) {
  if (!input) return []
  if (Array.isArray(input)) return input

  return input.split(',')
}
