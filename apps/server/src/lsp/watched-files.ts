import { stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { isRecord } from '@workspace/utils/objects'

import { isOutsideRoot, isSameOrDescendant } from '../fs/path'
import { linkedDirectories, outermostTargets, type LinkedDirectory } from '../fs/linked-directories'
import type { TreeWatch, TreeWatchChange, TreeWatchSource } from '../fs/tree-watch'
import { lspErrors } from '../observability/structured-errors'
import { fileUriForNativePath } from './language'

export const DID_CHANGE_WATCHED_FILES = 'workspace/didChangeWatchedFiles'

// LSP FileChangeType and WatchKind.
const CREATED = 1
const CHANGED = 2
const DELETED = 3
const WATCH_ALL = 7
const WATCH_KIND = { created: 1, changed: 2, deleted: 4 } as const
const FLUSH_DELAY_MS = 50

type FileChangeType = typeof CREATED | typeof CHANGED | typeof DELETED
export const FILE_CHANGED: FileChangeType = CHANGED

export type FileEvent = { readonly uri: string; readonly type: FileChangeType }

type Watcher = {
  /** Absolute directory the pattern is relative to. */
  readonly base: string
  readonly glob: Bun.Glob
  readonly kind: number
  /** What the pattern needs watched; `watch` is its nearest existing stand-in. */
  readonly intended: TreeWatch
  readonly watch: TreeWatch
  /** Directories linked into the root that the base reaches, by link or by real path. */
  readonly linked: readonly TreeWatch[]
}

type WatchEntry = {
  refCount: number
  readonly release: Promise<() => Promise<void>>
}

export type WatchedFilesStats = {
  /** Registrations accepted over the session; `registrationCount` is those still live. */
  readonly registeredCount: number
  readonly registrationCount: number
  readonly watchCount: number
  readonly notificationCount: number
  readonly changeCount: number
  readonly failedRegistrationCount: number
  readonly errorCount: number
}

/**
 * The client half of `workspace/didChangeWatchedFiles` for one backend, shared by every browser
 * attached to it. Patterns keep their meaning, but the directories actually watched are bounded:
 * a `node_modules` tree only by its top level, and any ancestor of the root by the root itself.
 */
export class LspWatchedFiles {
  private readonly registrations = new Map<string, readonly Watcher[]>()
  private readonly watches = new Map<string, WatchEntry>()
  private readonly pending = new Map<string, PendingChange>()
  private links: readonly LinkedDirectory[] = []
  private linkScan: Promise<readonly LinkedDirectory[]> | null = null
  private readonly root: string
  private readonly source: TreeWatchSource
  private readonly notify: (changes: FileEvent[]) => void
  private flushTimer: ReturnType<typeof setTimeout> | null = null
  private disposed = false
  private registeredCount = 0
  private notificationCount = 0
  private changeCount = 0
  private failedRegistrationCount = 0
  private errorCount = 0

  constructor(root: string, source: TreeWatchSource, notify: (changes: FileEvent[]) => void) {
    this.root = root
    this.source = source
    this.notify = notify
  }

  get stats(): WatchedFilesStats {
    return {
      registeredCount: this.registeredCount,
      registrationCount: this.registrations.size,
      watchCount: this.watches.size,
      notificationCount: this.notificationCount,
      changeCount: this.changeCount,
      failedRegistrationCount: this.failedRegistrationCount,
      errorCount: this.errorCount,
    }
  }

  /** Resolves once every watch the registration needs is attached. */
  async register(id: string, registerOptions: unknown): Promise<void> {
    try {
      await this.attach(id, compileWatchers(registerOptions, this.root), undefined)
      this.registeredCount += 1
    } catch (error) {
      this.failedRegistrationCount += 1
      throw error
    }
  }

  async unregister(id: string): Promise<void> {
    const watchers = this.registrations.get(id)
    if (!watchers) return
    this.registrations.delete(id)
    await this.releaseAll(watchers)
  }

  async dispose(): Promise<void> {
    if (this.disposed) return
    this.disposed = true
    if (this.flushTimer) clearTimeout(this.flushTimer)
    this.flushTimer = null
    this.pending.clear()
    this.registrations.clear()
    const entries = [...this.watches.values()]
    this.watches.clear()
    await Promise.all(entries.map(async (entry) => (await entry.release.catch(() => noop))()))
  }

  /** Swaps `id` to `watchers` unless something else replaced `expected` meanwhile. */
  private async attach(
    id: string,
    compiled: readonly Watcher[],
    expected: readonly Watcher[] | undefined,
  ): Promise<void> {
    const existing = await Promise.all(compiled.map((watcher) => existingWatch(watcher, this.root)))
    const watchers = await this.withLinkedDirectories(existing)
    const retained: string[] = []
    try {
      for (const watch of watchers.flatMap(watchesOf)) retained.push(await this.retain(watch))
    } catch (error) {
      await Promise.all(retained.map((key) => this.release(key)))
      throw error
    }
    const current = this.registrations.get(id)
    if (this.disposed || (expected && current !== expected)) {
      await Promise.all(retained.map((key) => this.release(key)))
      return
    }
    this.registrations.set(id, watchers)
    await this.releaseAll(current ?? [])
  }

  /**
   * A server reaches a linked package two ways: through the link inside the root, which a watch
   * of the root does not follow, or by real path under a base that was clamped to the root.
   */
  private async withLinkedDirectories(watchers: readonly Watcher[]): Promise<Watcher[]> {
    this.links = await this.scanLinks()
    return watchers.map((watcher) => {
      const reached = this.links.filter(
        (link) =>
          isSameOrDescendant(watcher.base, link.link) ||
          (isSameOrDescendant(watcher.base, this.root) &&
            isSameOrDescendant(watcher.base, link.target)),
      )
      if (reached.length === 0) return watcher
      const linked = outermostTargets(reached).map((target) => boundedWatch(target, this.root))
      return { ...watcher, linked }
    })
  }

  /** One scan serves every registration that arrives while it runs. */
  private scanLinks(): Promise<readonly LinkedDirectory[]> {
    this.linkScan ??= linkedDirectories(this.root).finally(() => {
      this.linkScan = null
    })
    return this.linkScan
  }

  private async releaseAll(watchers: readonly Watcher[]): Promise<void> {
    await Promise.all(watchers.flatMap(watchesOf).map((watch) => this.release(watchKey(watch))))
  }

  /** A directory a registration was waiting for appeared: watch it for real. */
  private reattachAppeared(created: string): void {
    for (const [id, watchers] of this.registrations) {
      const waiting = watchers.some(
        (watcher) =>
          watchKey(watcher.watch) !== watchKey(watcher.intended) &&
          isSameOrDescendant(created, watcher.intended.path),
      )
      if (!waiting) continue
      void this.attach(id, watchers, watchers).catch(() => {
        this.errorCount += 1
      })
    }
  }

  private async retain(watch: TreeWatch): Promise<string> {
    const key = watchKey(watch)
    const existing = this.watches.get(key)
    if (existing) {
      existing.refCount += 1
      await existing.release
      return key
    }
    const release = this.source(watch, {
      change: (change) => this.changed(change),
      error: () => {
        this.errorCount += 1
      },
    })
    const entry = { refCount: 1, release }
    this.watches.set(key, entry)
    try {
      await release
    } catch (error) {
      if (this.watches.get(key) === entry) this.watches.delete(key)
      throw error
    }
    return key
  }

  private async release(key: string): Promise<void> {
    const entry = this.watches.get(key)
    if (!entry) return
    entry.refCount -= 1
    if (entry.refCount > 0) return
    this.watches.delete(key)
    await (
      await entry.release
    )()
  }

  private changed(change: TreeWatchChange): void {
    if (this.disposed) return
    if (change.type !== 'deleted') this.reattachAppeared(change.path)
    for (const candidate of this.aliases(change)) {
      if (!this.matches(candidate)) continue
      const uri = fileUriForNativePath(candidate.path)
      const previous = this.pending.get(uri)
      this.pending.set(uri, {
        type: mergeChange(previous?.type, changeType(candidate.type)),
        directory: candidate.directory ?? previous?.directory ?? false,
      })
      this.flushTimer ??= setTimeout(() => this.flush(), FLUSH_DELAY_MS)
    }
  }

  private matches(change: TreeWatchChange): boolean {
    const kind = WATCH_KIND[change.type]
    for (const watchers of this.registrations.values()) {
      for (const watcher of watchers) {
        if ((watcher.kind & kind) === 0) continue
        if (globMatches(watcher, change.path)) return true
      }
    }
    return false
  }

  /** A change inside a linked target is also a change at every link that points to it. */
  private aliases(change: TreeWatchChange): TreeWatchChange[] {
    const aliases = this.links.flatMap((link) => {
      const relative = path.relative(link.target, change.path)
      if (isOutsideRoot(relative)) return []
      return [{ ...change, path: relative ? path.join(link.link, relative) : link.link }]
    })
    return [change, ...aliases]
  }

  private flush(): void {
    this.flushTimer = null
    if (this.disposed || this.pending.size === 0) return
    const changes = [...this.pending].flatMap(([uri, change]) => fileEvents(uri, change))
    this.pending.clear()
    this.notificationCount += 1
    this.changeCount += changes.length
    this.notify(changes)
  }
}

/** One notification per burst: a file replaced within it was changed, not deleted. */
export function mergeChange(previous: FileChangeType | undefined, next: FileChangeType) {
  if (previous === undefined) return next
  if (next === DELETED) return DELETED
  if (previous === CREATED) return CREATED
  if (previous === DELETED) return CHANGED
  return next === CREATED ? CHANGED : next
}

export function compileWatchers(registerOptions: unknown, root: string): Watcher[] {
  if (!isRecord(registerOptions) || !Array.isArray(registerOptions.watchers)) {
    throw lspErrors.WATCHED_FILES_REGISTRATION_INVALID({
      internal: { reason: 'no-watchers', optionsType: typeof registerOptions },
    })
  }
  return registerOptions.watchers.map((watcher) => compileWatcher(watcher, root))
}

function compileWatcher(watcher: unknown, root: string): Watcher {
  if (!isRecord(watcher)) {
    throw lspErrors.WATCHED_FILES_REGISTRATION_INVALID({
      internal: { reason: 'watcher-not-object', watcherType: typeof watcher },
    })
  }
  const kind = typeof watcher.kind === 'number' ? watcher.kind : WATCH_ALL
  const { base, pattern } = patternBase(watcher.globPattern, root)
  const watch = boundedWatch(base, root)
  return { base, glob: new Bun.Glob(pattern), kind, intended: watch, watch, linked: [] }
}

function patternBase(globPattern: unknown, root: string) {
  if (typeof globPattern === 'string') {
    if (!path.isAbsolute(globPattern)) return { base: root, pattern: globPattern }
    return splitAbsolutePattern(globPattern)
  }
  if (isRecord(globPattern) && typeof globPattern.pattern === 'string') {
    const baseUri = isRecord(globPattern.baseUri) ? globPattern.baseUri.uri : globPattern.baseUri
    if (typeof baseUri === 'string')
      return { base: fileURLToPath(baseUri), pattern: globPattern.pattern }
  }
  throw lspErrors.WATCHED_FILES_REGISTRATION_INVALID({
    internal: { reason: 'unsupported-glob', patternType: typeof globPattern },
  })
}

function splitAbsolutePattern(pattern: string) {
  const segments = pattern.split('/')
  const glob = segments.findIndex((segment) => /[*?[{]/.test(segment))
  if (glob < 0) return { base: path.dirname(pattern), pattern: path.basename(pattern) }
  return { base: segments.slice(0, glob).join('/') || '/', pattern: segments.slice(glob).join('/') }
}

/**
 * VS Code excludes `**\/node_modules/*\/**` for the same reason: installs are seen, a recursive
 * crawl of every package is not paid. An ancestor of the root would be a whole drive.
 */
export function boundedWatch(base: string, root: string): TreeWatch {
  const modules = nodeModulesDirectory(base)
  if (modules) return { depth: 'shallow', path: modules }
  if (isSameOrDescendant(base, root)) return { depth: 'recursive', path: root }
  return { depth: 'recursive', path: base }
}

function nodeModulesDirectory(target: string) {
  const segments = target.split(path.sep)
  const index = segments.indexOf('node_modules')
  if (index < 0) return null
  return segments.slice(0, index + 1).join(path.sep)
}

/** A directory that does not exist yet is watched from its nearest existing parent. */
async function existingWatch(watcher: Watcher, root: string): Promise<Watcher> {
  const intended = watcher.intended
  let directory = intended.path
  while (!(await isDirectory(directory))) {
    const parent = path.dirname(directory)
    if (parent === directory) break
    directory = parent
  }
  if (directory === intended.path) return { ...watcher, watch: intended }
  if (isSameOrDescendant(directory, root))
    return { ...watcher, watch: { depth: 'recursive', path: root } }
  return { ...watcher, watch: { depth: 'shallow', path: directory } }
}

async function isDirectory(target: string) {
  try {
    return (await stat(target)).isDirectory()
  } catch {
    return false
  }
}

type PendingChange = { readonly type: FileChangeType; readonly directory: boolean }

/**
 * A rename onto an existing path reports `created`, and typescript-go 7.0.2 ignores Created for a
 * file it already has, keeping the old text. A preceding Deleted is true of a replacement and
 * harmless for a new file — but not for a directory, which 7.0.2 then treats as gone.
 */
function fileEvents(uri: string, { type, directory }: PendingChange): FileEvent[] {
  if (type !== CREATED || directory) return [{ uri, type }]
  return [
    { uri, type: DELETED },
    { uri, type: CREATED },
  ]
}

function changeType(type: TreeWatchChange['type']): FileChangeType {
  if (type === 'created') return CREATED
  if (type === 'changed') return CHANGED
  return DELETED
}

function globMatches(watcher: Watcher, file: string) {
  const relative = path.relative(watcher.base, file)
  if (!relative || isOutsideRoot(relative)) return false
  return watcher.glob.match(relative)
}

function watchesOf(watcher: Watcher): TreeWatch[] {
  return [watcher.watch, ...watcher.linked]
}

function watchKey(watch: TreeWatch) {
  return `${watch.depth}:${watch.path}`
}

function noop() {
  return Promise.resolve()
}
