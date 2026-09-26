import type { WorkspaceIndexScopeStatus } from '@workspace/contracts'
import { recordProcessInfo } from '../observability'
import type { WatchServerMessage } from './contracts'
import { createWorkspacePaths, type WorkspacePaths } from './path'
import type { FileChangeHub } from './watch'
import {
  WorkspaceIndex,
  watchWorkspaceIndex,
  type WorkspaceIndexWatchSubscription,
} from './workspace-index'

type WorkspaceIndexScope = {
  readonly abort: AbortController
  readonly index: WorkspaceIndex
  readonly paths: WorkspacePaths
  readonly startup: Promise<void>
  readonly watcher: WorkspaceIndexWatchSubscription
  holders: number
  idleTimer: ReturnType<typeof setTimeout> | undefined
  lastUsedAt: number
}

export type WorkspaceIndexScopesOptions = {
  readonly changes: FileChangeHub
  readonly excludedAbsolutePaths: readonly string[]
  /** `files.searchIndexIdleMinutes`, in milliseconds, read when the last holder leaves. */
  readonly idleMs: () => number
  /** `files.searchIndexLimit`, read whenever a new root is indexed. */
  readonly limit: () => number
  readonly paths: WorkspacePaths
}

/**
 * One file index per open root. A holder (a client's project event stream) keeps its root's index
 * alive; the last one to leave arms an idle timer, and a new root past the limit evicts the least
 * recently used index, idle ones first.
 */
export class WorkspaceIndexScopes {
  private readonly changes: FileChangeHub
  private readonly excludedAbsolutePaths: readonly string[]
  private readonly idleMs: () => number
  private readonly limit: () => number
  private readonly paths: WorkspacePaths
  private readonly retiring = new Set<Promise<void>>()
  private readonly scopes = new Map<string, WorkspaceIndexScope>()
  private closed = false

  constructor(options: WorkspaceIndexScopesOptions) {
    this.changes = options.changes
    this.excludedAbsolutePaths = options.excludedAbsolutePaths
    this.idleMs = options.idleMs
    this.limit = options.limit
    this.paths = options.paths
  }

  /** Holds `relativeRoot`'s index, building it when absent or failed. Call the result to let go. */
  acquire(relativeRoot: string) {
    if (this.closed) return () => {}
    const resolved = this.paths.resolve(relativeRoot)
    const scope = this.usableScope(resolved.absolutePath) ?? this.install(resolved)
    scope.holders += 1
    scope.lastUsedAt = performance.now()
    clearIdleTimer(scope)

    let released = false
    return () => {
      if (released) return
      released = true
      this.release(resolved.absolutePath, scope)
    }
  }

  /** The index whose root is exactly `absoluteRoot`, if one is held or still warm. */
  get(absoluteRoot: string) {
    const scope = this.scopes.get(absoluteRoot)
    if (!scope) return undefined

    scope.lastUsedAt = performance.now()
    return scope.index
  }

  /** The root's index once its first build settles, or as it stands when `signal` aborts. */
  async settled(absoluteRoot: string, signal: AbortSignal) {
    const scope = this.scopes.get(absoluteRoot)
    if (!scope) return undefined
    const aborted = new Promise<void>((resolve) => {
      if (signal.aborted) resolve()
      signal.addEventListener('abort', () => resolve(), { once: true })
    })
    await Promise.race([scope.startup, aborted])
    scope.lastUsedAt = performance.now()
    return scope.index
  }

  statuses(): WorkspaceIndexScopeStatus[] {
    return [...this.scopes.values()].map((scope) => ({
      ...scope.index.status(),
      holderCount: scope.holders,
    }))
  }

  async close() {
    this.closed = true
    for (const [root, scope] of this.scopes) this.retire(root, scope, 'closed')
    await Promise.all(this.retiring)
  }

  private usableScope(absoluteRoot: string) {
    const scope = this.scopes.get(absoluteRoot)
    if (!scope) return undefined
    if (scope.index.status().readiness !== 'failed') return scope

    // A failed index never recovers on its own; reopening its root is the retry.
    this.retire(absoluteRoot, scope, 'failed')
    return undefined
  }

  private install(resolved: { absolutePath: string; relativePath: string }) {
    const paths = createWorkspacePaths(resolved.absolutePath, {
      excludedAbsolutePaths: this.excludedAbsolutePaths,
      excludedNames: this.paths.internalNames,
    })
    const index = new WorkspaceIndex(paths)
    const abort = new AbortController()
    const watcher = watchWorkspaceIndex(index, (signal) =>
      scopedWorkspaceIndexEvents(this.changes, this.paths, paths, resolved.relativePath, signal),
    )
    const scope: WorkspaceIndexScope = {
      abort,
      holders: 0,
      idleTimer: undefined,
      index,
      lastUsedAt: performance.now(),
      paths,
      startup: startWorkspaceIndex(index, watcher, abort.signal),
      watcher,
    }
    this.scopes.set(resolved.absolutePath, scope)
    this.evictOverLimit(scope)
    return scope
  }

  private evictOverLimit(keep: WorkspaceIndexScope) {
    const limit = Math.max(1, this.limit())
    while (this.scopes.size > limit) {
      const victim = leastRecentlyUsed(this.scopes, keep)
      if (!victim) return
      this.retire(victim[0], victim[1], 'limit')
    }
  }

  private release(absoluteRoot: string, scope: WorkspaceIndexScope) {
    scope.holders -= 1
    scope.lastUsedAt = performance.now()
    if (scope.holders > 0) return
    if (this.scopes.get(absoluteRoot) !== scope) return

    const timer = setTimeout(() => {
      if (scope.holders > 0) return
      if (this.scopes.get(absoluteRoot) !== scope) return
      this.retire(absoluteRoot, scope, 'idle')
    }, this.idleMs())
    timer.unref?.()
    scope.idleTimer = timer
  }

  private retire(absoluteRoot: string, scope: WorkspaceIndexScope, reason: string) {
    clearIdleTimer(scope)
    if (this.scopes.get(absoluteRoot) === scope) this.scopes.delete(absoluteRoot)
    recordProcessInfo('fs.workspace_index.retired', {
      area: 'fs',
      holderCount: scope.holders,
      reason,
      root: absoluteRoot,
      scopeCount: this.scopes.size,
    })
    scope.abort.abort()
    const retirement = closeScope(scope).finally(() => {
      this.retiring.delete(retirement)
    })
    this.retiring.add(retirement)
  }
}

function clearIdleTimer(scope: WorkspaceIndexScope) {
  if (scope.idleTimer === undefined) return
  clearTimeout(scope.idleTimer)
  scope.idleTimer = undefined
}

function leastRecentlyUsed(
  scopes: ReadonlyMap<string, WorkspaceIndexScope>,
  keep: WorkspaceIndexScope,
): [string, WorkspaceIndexScope] | undefined {
  let victim: [string, WorkspaceIndexScope] | undefined
  for (const candidate of scopes) {
    if (candidate[1] === keep) continue
    if (!victim || evictsBefore(candidate[1], victim[1])) victim = candidate
  }
  return victim
}

/** An index nobody holds goes before a held one; then the one used longest ago. */
function evictsBefore(candidate: WorkspaceIndexScope, current: WorkspaceIndexScope) {
  const candidateHeld = candidate.holders > 0
  const currentHeld = current.holders > 0
  if (candidateHeld !== currentHeld) return !candidateHeld
  return candidate.lastUsedAt < current.lastUsedAt
}

async function startWorkspaceIndex(
  index: WorkspaceIndex,
  watcher: WorkspaceIndexWatchSubscription,
  signal: AbortSignal,
) {
  try {
    await watcher.ready
    if (signal.aborted) return
    if (watcher.coverage?.mode === 'limited') {
      index.turnOff('watch-limit')
      return
    }

    await index.rebuild({ reason: 'workspace-root-opened', signal })
  } catch {
    // The index keeps failed status internally; search can continue through fallback paths.
  }
}

async function closeScope(scope: WorkspaceIndexScope) {
  await scope.watcher.close()
  await scope.startup
}

async function* scopedWorkspaceIndexEvents(
  changes: FileChangeHub,
  servicePaths: WorkspacePaths,
  indexPaths: WorkspacePaths,
  relativeRoot: string,
  signal: AbortSignal,
): AsyncGenerator<WatchServerMessage> {
  const events = changes.stream([relativeRoot], signal, { includeIgnored: true })

  for await (const event of events) {
    const scoped = scopeWorkspaceIndexEvent(event, servicePaths, indexPaths)
    if (!scoped) continue

    yield scoped
  }
}

function scopeWorkspaceIndexEvent(
  event: WatchServerMessage,
  servicePaths: WorkspacePaths,
  indexPaths: WorkspacePaths,
): WatchServerMessage | null {
  if (!isWorkspaceFilesystemEvent(event)) return scopeNonFilesystemEvent(event)
  if (event.type === 'renamed')
    return scopeRenamedWorkspaceIndexEvent(event, servicePaths, indexPaths)

  const scopedPath = scopedIndexPath(event.path, servicePaths, indexPaths)
  if (scopedPath === null) return null

  return { ...event, path: scopedPath }
}

function scopeNonFilesystemEvent(event: WatchServerMessage): WatchServerMessage {
  if (event.type !== 'ready') return event

  return { ...event, root: '' }
}

function scopeRenamedWorkspaceIndexEvent(
  event: Extract<WatchServerMessage, { type: 'renamed' }>,
  servicePaths: WorkspacePaths,
  indexPaths: WorkspacePaths,
): WatchServerMessage | null {
  const path = scopedIndexPath(event.path, servicePaths, indexPaths)
  const oldPath = scopedIndexPath(event.oldPath, servicePaths, indexPaths)
  if (path !== null && oldPath !== null) return { ...event, oldPath, path }
  if (oldPath !== null) return { path: oldPath, sequence: event.sequence, type: 'deleted' }
  if (path === null) return null

  return { entry: event.entry, path, sequence: event.sequence, type: 'created' }
}

function scopedIndexPath(
  relativePath: string,
  servicePaths: WorkspacePaths,
  indexPaths: WorkspacePaths,
) {
  const absolutePath = servicePaths.resolve(relativePath).absolutePath

  try {
    return indexPaths.toRelative(absolutePath)
  } catch {
    return null
  }
}

function isWorkspaceFilesystemEvent(
  event: WatchServerMessage,
): event is Extract<WatchServerMessage, { type: 'changed' | 'created' | 'deleted' | 'renamed' }> {
  if (event.type === 'changed') return true
  if (event.type === 'created') return true
  if (event.type === 'deleted') return true

  return event.type === 'renamed'
}
