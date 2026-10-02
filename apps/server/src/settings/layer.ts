import { unwatchFile, watch, watchFile, type FSWatcher } from 'node:fs'
import path from 'node:path'
import { errorStringField, type SettingsLayerId } from '@workspace/contracts'
import {
  recordProcessInfo,
  recordProcessWarning,
  recordRequestWarning,
  runDetached,
} from '../observability'
import {
  parseSettingsDocument,
  readSettingsFile,
  readSettingsFileSync,
  type SettingsFileContents,
  type SettingsParseError,
  type SettingsTextRange,
} from './json-document'
import {
  pruneSettingsFile,
  pruneSettingsFileSync,
  pruneSettingsText,
  type SettingsPruneResult,
} from './prune'
import { hasSettingsRecoveryArtifacts } from './transaction'
import {
  canonicalSettingsPathSync,
  withSettingsWriteCoordinator,
  withSettingsWriteCoordinatorSync,
} from './write-coordinator'

/**
 * `fs.watch` fires more than once per editor save, and sometimes before the new
 * content has been flushed. Long enough to coalesce a save, short enough that a
 * hand-edit feels live.
 */
const RELOAD_DEBOUNCE_MS = 100
const RELOAD_RETRY_MS = 50
const MAX_RELOAD_READ_FAILURES = 3

/**
 * `fs.watch` under Bun is not live when it returns: a change landing in the
 * window between arming and the watcher actually attaching is never reported,
 * and the layer then serves the file's old contents for the life of the process.
 *
 * Measured on darwin/Bun 1.3.10, arming a directory watcher and writing the
 * watched file immediately, with the machine saturated: 15/200 events lost at
 * +0ms, 4/200 at +1ms, 1/200 at +5ms, none from +25ms on. The same probe under
 * Node loses nothing at any offset, so this is not something the call site can
 * detect -- `watch()` returns an `FSWatcher` either way.
 *
 * The window is milliseconds and it closes for good, so one catch-up read past
 * it is the whole fix. This is that offset, with two orders of magnitude of
 * margin over the measurement, spent once per layer per process.
 */
const ARMING_CATCHUP_MS = 250
const WATCH_POLL_INTERVAL_MS = 500

function settingsWatchPaths(filePath: string): readonly string[] {
  const configured = path.resolve(filePath)
  let canonical: string
  try {
    canonical = canonicalSettingsPathSync(configured)
  } catch {
    return [configured]
  }
  if (canonical === configured) return [configured]

  // Directory events name the replaced target, not the symlink used to open it.
  return [configured, canonical]
}

function settingsWatchDirectories(filePath: string): ReadonlyMap<string, ReadonlySet<string>> {
  const targets = new Map<string, Set<string>>()

  for (const watchPath of settingsWatchPaths(filePath)) {
    const directory = path.dirname(watchPath)
    const basenames = targets.get(directory) ?? new Set<string>()
    basenames.add(path.basename(watchPath))
    targets.set(directory, basenames)
  }

  return targets
}

export type LayerContents = {
  readonly raw: Readonly<Record<string, unknown>>
  readonly parseErrors: readonly SettingsParseError[]
  readonly keyRanges: Readonly<Record<string, SettingsTextRange>>
  readonly revision: string | null
  readonly text: string
  readonly present: boolean
}

export type LayerChange = {
  readonly next: LayerContents
  readonly previous: LayerContents
}

export type LayerWriteContext = {
  readonly current: LayerContents
  readonly coordinatorWaitMs: number
  readonly destination: string
}

export type SettingsLayerReader = (
  context: { readonly filePath: string; readonly layer: SettingsLayerId },
  read: () => Promise<SettingsFileContents>,
) => Promise<SettingsFileContents>

export type SettingsPruneProtection = {
  readonly ownerPath: string
  readonly eligible: () => boolean
}

const EMPTY: LayerContents = {
  raw: {},
  parseErrors: [],
  keyRanges: {},
  revision: null,
  text: '',
  present: false,
}

/**
 * One settings file, watched.
 *
 * Owns its own watcher rather than reusing the workspace `FileChangeHub`: that
 * hub is scoped to the fs workspace root, which is `/` in development but a
 * `mkdtemp` directory in every test, so a settings file outside it would never
 * emit. A dedicated watcher is a handful of lines and works in both.
 */
export class SettingsFileLayer {
  readonly id: SettingsLayerId
  readonly filePath: string

  private contents: LayerContents = EMPTY
  private readonly reader: SettingsLayerReader | null
  private readonly onPruned?: (keys: readonly string[]) => void
  private readonly pruneProtection?: SettingsPruneProtection
  private watcher: FSWatcher | null = null
  private readonly directoryWatchers: FSWatcher[] = []
  private debounce: ReturnType<typeof setTimeout> | null = null
  private catchUpTimer: ReturnType<typeof setTimeout> | null = null
  private retryTimer: ReturnType<typeof setTimeout> | null = null
  private onChange: ((change: LayerChange) => void) | null = null
  private readFailureCount = 0
  private readFailureReported = false
  private reloading = false
  private reloadQueued = false
  /**
   * Bumped on every applied change to `contents`, so a reload can tell whether
   * the layer moved underneath its own `await`.
   */
  private generation = 0
  /** Held for the duration of a write, so a reload does not read across it. */
  private writing: Promise<void> | null = null

  /** `fs.watch` is the fast path; polling covers a watcher that goes silent. */
  private readonly pollForChange = () => this.scheduleReload()

  /**
   * The hash of the last text we wrote, so the watch event our own rename
   * produces does not look like an external edit.
   */
  private selfWrittenRevision: string | null = null

  constructor(
    id: SettingsLayerId,
    filePath: string,
    reader?: SettingsLayerReader,
    onPruned?: (keys: readonly string[]) => void,
    pruneProtection?: SettingsPruneProtection,
  ) {
    this.id = id
    this.filePath = filePath
    this.reader = reader ?? null
    this.onPruned = onPruned
    this.pruneProtection = pruneProtection
  }

  snapshot(): LayerContents {
    return this.contents
  }

  async load(): Promise<void> {
    this.apply(await this.read())
  }

  loadSync(): void {
    this.apply(this.toContents(readSettingsFileSync(this.filePath)))
  }

  /** Application startup invokes cleanup separately from loading and transaction recovery. */
  pruneUnknownSettingsSync(): LayerChange | null {
    if (this.id !== 'user') return null
    let keys: readonly string[] = []
    try {
      const candidate = pruneSettingsText(readSettingsFileSync(this.filePath).text)
      if (!candidate) return null
      keys = candidate.keys
      return withSettingsWriteCoordinatorSync(this.filePath, (lease) =>
        this.withPruneOwnerSync(() => {
          const eligible = () => this.pruneEligible(lease.canonicalPath)
          if (!eligible()) return null
          const current = readSettingsFileSync(lease.canonicalPath)
          const pruned = pruneSettingsFileSync(lease.canonicalPath, current, eligible)
          return pruned ? this.acceptPruned(pruned) : null
        }),
      )
    } catch (error) {
      recordProcessWarning('settings.layer.prune_failed', {
        area: 'settings',
        operation: 'boot-prune-unknown-keys',
        settings: { layer: this.id, file: this.filePath, keys },
        error: {
          code: errorStringField(error, 'code'),
          name: error instanceof Error ? error.name : typeof error,
        },
      })
      return null
    }
  }

  async pruneUnknownSettings(): Promise<LayerChange | null> {
    if (this.id !== 'user') return null
    return this.coordinateWrite((context) =>
      this.withPruneOwner(async () => {
        if (!this.pruneEligible(context.destination)) return null
        const current = await this.read()
        return this.pruneCurrent({ ...context, current })
      }),
    )
  }

  private withPruneOwnerSync<T>(operation: () => T): T {
    if (!this.pruneProtection) return operation()
    return withSettingsWriteCoordinatorSync(this.pruneProtection.ownerPath, operation)
  }

  private async withPruneOwner<T>(operation: () => Promise<T>): Promise<T> {
    if (!this.pruneProtection) return operation()
    return withSettingsWriteCoordinator(this.pruneProtection.ownerPath, operation)
  }

  private pruneEligible(destination: string): boolean {
    if (this.pruneProtection) return this.pruneProtection.eligible()
    return !hasSettingsRecoveryArtifacts([destination])
  }

  private async pruneCurrent(context: LayerWriteContext): Promise<LayerChange | null> {
    const pruned = await pruneSettingsFile(
      context.destination,
      context.current,
      context.coordinatorWaitMs,
      () => this.pruneEligible(context.destination),
    )
    return pruned ? this.acceptPruned(pruned) : null
  }

  private acceptPruned(pruned: SettingsPruneResult): LayerChange {
    const { text, revision } = pruned.contents
    const change = this.acceptCommitted(text, revision)
    recordProcessInfo('settings.layer.pruned', {
      area: 'settings',
      operation: 'prune-unknown-keys',
      settings: { layer: this.id, file: this.filePath, keys: pruned.keys },
    })
    this.onPruned?.(pruned.keys)
    return change
  }

  /** Runs one fresh read and write transaction under the process-wide path lock. */
  async coordinateWrite<T>(operation: (context: LayerWriteContext) => Promise<T>): Promise<T> {
    return withSettingsWriteCoordinator(this.filePath, async (lease) => {
      const done = await this.beginWrite()

      try {
        return await operation({
          current: await this.read(),
          coordinatorWaitMs: lease.waitMs,
          destination: lease.canonicalPath,
        })
      } finally {
        done()
      }
    })
  }

  async readFresh(): Promise<LayerContents> {
    return this.read()
  }

  /** Makes committed bytes authoritative in-memory and suppresses their watcher echo. */
  acceptCommitted(text: string, revision: string): LayerChange {
    const parsed = parseSettingsDocument(text)
    this.selfWrittenRevision = revision
    const change = this.accept({
      raw: parsed.values,
      parseErrors: parsed.parseErrors,
      keyRanges: parsed.keyRanges,
      revision,
      text,
      present: true,
    })

    return change
  }

  /** Admits a fresh coordinated read when another store moved the shared file. */
  acceptFresh(contents: LayerContents): LayerChange {
    return this.accept(contents)
  }

  watch(onChange: (change: LayerChange) => void): void {
    this.onChange = onChange
    this.watchFile()
    this.watchDirectory()
    this.watchPollFallback()
    this.catchUpOnArming()
  }

  close(): void {
    if (this.debounce) clearTimeout(this.debounce)
    this.debounce = null
    this.stopCatchUp()
    this.stopRetry()
    this.watcher?.close()
    this.watcher = null
    this.closeDirectoryWatchers()
    unwatchFile(this.filePath, this.pollForChange)
    this.onChange = null
  }

  private async read(): Promise<LayerContents> {
    const source = this.reader
      ? await this.reader({ filePath: this.filePath, layer: this.id }, () =>
          readSettingsFile(this.filePath),
        )
      : await readSettingsFile(this.filePath)

    return this.toContents(source)
  }

  /**
   * The bytes are always news. What they *mean* is only news when they parse.
   *
   * `jsonc-parser` recovers what it can from a broken document, but "what it can"
   * is not a subset of the user's configuration — one unterminated quote in a key
   * name near the top recovers zero keys — and every absent key resolves to its
   * registry default (`combine` in `resolve.ts`), not to its previous value. So
   * publishing a partial parse does not degrade the configuration, it replaces it
   * with the factory one: theme, fonts, wallpaper and the whole keymap, for as
   * long as the file is mid-edit. Holding the last good `raw` is what makes an
   * external hand-edit survivable, and it is what VS Code does.
   *
   * The file's own state — text, revision, parseErrors — still updates, so the
   * page can say the document is broken while the app keeps running on what it
   * last understood.
   */
  private toContents({ text, revision }: { text: string; revision: string | null }): LayerContents {
    // A deleted file is a decision, not a syntax error: there are no settings
    // here now, and holding the old ones would make the delete look ignored.
    if (revision === null) return EMPTY

    const parsed = parseSettingsDocument(text)
    if (parsed.parseErrors.length > 0) {
      return {
        // Only if there is something to hold. On the first read of the process
        // there is not, and publishing `{}` there would be worse than what this
        // branch exists to prevent: booting onto a file with a stray BOM would
        // drop every key `jsonc-parser` recovered, permanently, because the
        // errors never clear on their own.
        raw: this.contents.present ? this.contents.raw : parsed.values,
        parseErrors: parsed.parseErrors,
        keyRanges: parsed.keyRanges,
        revision,
        text,
        present: true,
      }
    }

    return {
      raw: parsed.values,
      parseErrors: parsed.parseErrors,
      keyRanges: parsed.keyRanges,
      revision,
      text,
      present: true,
    }
  }

  private watchFile() {
    try {
      this.watcher = watch(this.filePath, () => this.scheduleReload())
    } catch (error) {
      // No file yet. The directory watcher picks up its creation.
      this.reportWatchFailure(error, 'file')
    }
  }

  /**
   * `fs.watch` can stop delivering after an atomic replacement, especially
   * through a symlink. Polling stats, not contents, keeps that loss recoverable.
   */
  private watchPollFallback() {
    watchFile(
      this.filePath,
      { interval: WATCH_POLL_INTERVAL_MS, persistent: false },
      this.pollForChange,
    )
  }

  /**
   * Arms whatever can be armed now.
   *
   * `fs.watch` throws ENOENT synchronously on a missing path, and a workspace
   * layer points at `<root>/.platform/settings.json` — a directory an ordinary
   * repository does not have — so at construction both watchers fail and the
   * layer is deaf for the process's life. Re-arming after every write is what
   * makes the file we just created watchable, so the hand-edit that follows a
   * click is seen.
   */
  private rearmWatchers() {
    if (!this.onChange) return

    // A live handle can already be detached after an atomic replacement.
    this.watcher?.close()
    this.watcher = null
    this.closeDirectoryWatchers()
    this.watchFile()
    this.watchDirectory()
    this.catchUpOnArming()
  }

  /**
   * An atomic save replaces the inode, which silently detaches a file watcher —
   * so the directory is watched too. Filtered on the basename because
   * `~/.platform` also holds `fonts/` and `lsp/`, and an LSP install should not
   * wake the settings store.
   */
  private watchDirectory() {
    for (const [directory, basenames] of settingsWatchDirectories(this.filePath)) {
      try {
        const watcher = watch(directory, (_event, filename) => {
          // Some platforms report a null filename, and some hand back a Buffer
          // rather than a string; re-reading is the safe answer to the first.
          const name = filename?.toString() ?? null
          if (name !== null && !basenames.has(name)) return
          this.scheduleReload()
        })
        this.directoryWatchers.push(watcher)
      } catch (error) {
        // No directory yet either; the layer stays empty until something writes.
        this.reportWatchFailure(error, 'directory')
      }
    }
  }

  private reportWatchFailure(error: unknown, source: 'directory' | 'file') {
    const code = errorStringField(error, 'code')
    if (code === 'ENOENT' || code === 'ENOTDIR') return

    recordRequestWarning('settings.layer.watch_failed', {
      area: 'settings',
      operation: 'watcher-arm',
      settings: { layer: this.id, source },
      error: {
        code,
        name: error instanceof Error ? error.name : typeof error,
      },
    })
  }

  private closeDirectoryWatchers() {
    for (const watcher of this.directoryWatchers.splice(0)) watcher.close()
  }

  private apply(next: LayerContents) {
    this.contents = next
    this.generation += 1
  }

  private accept(next: LayerContents): LayerChange {
    const previous = this.contents
    this.apply(next)
    this.rearmWatchers()

    return { next, previous }
  }

  /**
   * Marks a write in flight, and returns its release.
   *
   * A reload waits this out rather than reading across the rename: mid-write it
   * cannot tell the pre- from the post-rename bytes, and the pre-rename ones
   * would be published as an external edit of content the file no longer holds,
   * consuming the echo hash on the way so the write's own event lands as a
   * second one. The debounce alone does not settle it -- it delays a reload, it
   * does not order one against a write -- and the arming catch-up below puts a
   * second reload into the same window, so this is worth naming rather than
   * leaving to luck. It is also what serializes writes against each other; see
   * the wait at the top.
   */
  private async beginWrite(): Promise<() => void> {
    // A write also waits out the write before it. Ordering reloads against a
    // write is not enough on its own: two writes that overlap each read the same
    // revision, each find it unchanged, and each rename over the other, so
    // `expectedRevision` passes twice and one edit is gone with a 200 on both.
    // The loop rather than a single await because several callers can be parked
    // here at once, and only the first to wake gets to install the next marker.
    while (this.writing) await this.writing

    let release = () => {}
    const writing = new Promise<void>((resolve) => {
      release = resolve
    })
    this.writing = writing

    return () => {
      // Only if this write is still the current one: two overlapping writes
      // would otherwise have the first clear the second's marker.
      if (this.writing === writing) this.writing = null
      release()
    }
  }

  /** Covers the window in which the freshly armed watcher is not yet delivering. */
  private catchUpOnArming() {
    this.stopCatchUp()
    if (!this.onChange) return

    const armedRevision = this.contents.revision
    this.catchUpTimer = setTimeout(() => this.catchUp(armedRevision), ARMING_CATCHUP_MS)
  }

  private catchUp(armedRevision: string | null) {
    this.catchUpTimer = null
    // Anything that moved the layer -- a delivered watch event, or our own
    // write -- proves the window is behind us and there is nothing to catch.
    if (this.contents.revision !== armedRevision) return

    // Through the debounce rather than straight into `reload`: an atomic save is
    // a delete and a create, and a read that lands between them publishes an
    // empty document the file never held. Coalescing is what the watch path uses
    // against exactly that, and this is not a second way to notice a change --
    // only another reason to look.
    this.scheduleReload()
  }

  private stopCatchUp() {
    if (this.catchUpTimer) clearTimeout(this.catchUpTimer)
    this.catchUpTimer = null
  }

  private scheduleReload() {
    if (this.reloading) {
      this.reloadQueued = true
      return
    }
    if (this.debounce) clearTimeout(this.debounce)
    this.debounce = setTimeout(() => {
      this.debounce = null
      this.requestReload()
    }, RELOAD_DEBOUNCE_MS)
  }

  private requestReload() {
    if (!this.onChange) return
    if (this.reloading) {
      this.reloadQueued = true
      return
    }

    this.reloading = true
    runDetached(() => this.reloadQueuedReads(), {
      area: 'settings',
      layer: this.id,
      operation: 'reload',
    })
  }

  private async reloadQueuedReads() {
    try {
      do {
        this.reloadQueued = false
        await this.reloadOnce()
      } while (this.reloadQueued)
    } finally {
      this.reloading = false
      if (this.reloadQueued) this.requestReload()
    }
  }

  private async reloadUser() {
    try {
      await this.coordinateWrite((context) =>
        this.withPruneOwner(async () => {
          const current = await this.read()
          if (this.reloadQueued) return

          const change = this.pruneEligible(context.destination)
            ? await this.pruneCurrent({ ...context, current })
            : null
          if (change) {
            // Publish the committed cleanup before its rename event is suppressed.
            this.onChange?.(change)
            return
          }
          this.acceptReload(current)
        }),
      )
      this.clearReadFailure()
    } catch (error) {
      this.handleReadFailure(error)
    }
  }

  private async reloadOnce() {
    // Before the generation is captured, so a write that lands first is read as
    // the current state rather than as a change to publish.
    //
    // The loop, not a single await, for the same reason `beginWrite` has one:
    // writes now queue behind each other, and one await only clears the write
    // that happened to be in flight. A reload parked on write A would otherwise
    // wake in the same turn write B is admitted and read across B's rename.
    while (this.writing) await this.writing
    const generation = this.generation
    let next: LayerContents
    try {
      next = await this.read()
    } catch (error) {
      this.handleReadFailure(error)
      return
    }

    // An event landed while this read was pending. Its bytes may already be
    // older than the file, so let the queued read be the one that publishes.
    if (this.reloadQueued) return

    // Discard a read the layer outran. `write` re-reads, edits and renames, so a
    // reload that started before it can resolve holding the pre-write bytes --
    // and would then hand listeners content the file no longer holds, having
    // consumed the echo hash on the way, which delivers the write's own event as
    // an external edit right after it.
    if (generation !== this.generation) return

    if (this.id === 'user' && pruneSettingsText(next.text)) {
      await this.reloadUser()
      return
    }
    this.clearReadFailure()
    this.acceptReload(next)
  }

  private acceptReload(next: LayerContents) {
    if (this.reloadQueued) return

    // Suppress exactly one event: the one our own rename produced.
    //
    // Clearing this on every applied reload is load-bearing. Leaving it set
    // means a file that later returns to previously-written content — an undo in
    // the user's editor — matches the stale hash forever, and the store serves a
    // value the file no longer holds with nothing in the logs to say why.
    const isSelfWrite = next.revision !== null && next.revision === this.selfWrittenRevision
    this.selfWrittenRevision = null
    if (isSelfWrite) return

    if (next.revision === this.contents.revision) return

    const change = this.accept(next)
    this.onChange?.(change)
  }

  private handleReadFailure(error: unknown) {
    this.readFailureCount += 1
    if (!this.readFailureReported) {
      this.readFailureReported = true
      recordRequestWarning('settings.layer.reload_failed', {
        area: 'settings',
        operation: 'watcher-read',
        settings: { layer: this.id },
        error: {
          code: errorStringField(error, 'code'),
          name: error instanceof Error ? error.name : typeof error,
        },
      })
    }
    if (this.readFailureCount >= MAX_RELOAD_READ_FAILURES) return
    if (!this.onChange || this.retryTimer) return

    this.retryTimer = setTimeout(() => {
      this.retryTimer = null
      this.requestReload()
    }, RELOAD_RETRY_MS)
  }

  private clearReadFailure() {
    this.readFailureCount = 0
    this.readFailureReported = false
    this.stopRetry()
  }

  private stopRetry() {
    if (this.retryTimer) clearTimeout(this.retryTimer)
    this.retryTimer = null
  }
}
