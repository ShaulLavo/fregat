import { homedir } from 'node:os'
import path from 'node:path'
import { effectiveEntryType, type WorkspaceAddressId } from '@workspace/contracts'
import { platformHomePath } from '../home'
import { createWorkspacePaths } from './path'
import { FileChangeHub, type WatchBackend } from './watch'
import { entryFromStat } from './entry'
import { DEFAULT_MAX_TEXT_FILE_BYTES, MAX_TEXT_FILE_BYTES_UPPER_BOUND } from './limits'
import { statPath } from './stat'
import { readTree } from './tree'
import { getBlobFile, readTextFile } from './read'
import { writeTextFile } from './write'
import { textFileVersion } from './version'
import { forgetAppSave, recordAppSave } from './app-save-marker'
import { createFile, createFolder } from './create'
import { renamePath } from './rename'
import { deletePath } from './delete'
import { copyPath } from './copy'
import {
  resolveMutationTarget,
  type MutationTarget,
  type MutationTargetKind,
} from './mutation-target'
import {
  elapsedMs,
  errorSummary,
  observeRequestOperation,
  recordProcessWarning,
  recordRequestContext,
  recordRequestError,
  recordStreamSummary,
} from '../observability'
import { findInWorkspaceStream, type FindOptions, type SearchStreamEvent } from './search'
import { FsError } from './errors'
import type { MetadataDatabaseHandle } from '../db/client'
import { FsMetadataStore } from './metadata'
import { registerWorkspaceAddress, resolveWorkspaceAddress } from './workspace-address'
import {
  WorkspaceIndex,
  inactiveWorkspaceIndexStatus,
  watchWorkspaceIndex,
  type WorkspaceIndex as WorkspaceIndexInstance,
  type WorkspaceIndexWatchSubscription,
} from './workspace-index'
import type {
  CopyBody,
  CreateFileBody,
  CreateFolderBody,
  DeleteBody,
  EntryTypeFilter,
  OpenWorkspaceRootBody,
  RecentsQuery,
  RenameBody,
  TreeEntry,
  WatchServerMessage,
  WorkspaceEditPrepareBody,
  WorkspaceEditRecoverBody,
  WorkspaceEditReleaseBody,
  WorkspaceEditTransitionBody,
  WriteBody,
} from './contracts'
import type { WorkspacePaths } from './path'
import { WorkspaceEditController, type WorkspaceEditControllerOptions } from './workspace-edit'

export type FileSystemSearchOptions = Omit<FindOptions, 'maxContentBytes'>

export type FileSystemServiceOptions = {
  workspaceRoot?: string
  systemRoot?: string
  homeDirectory?: string
  watch?: boolean
  maxSearchContentBytes?: number
  maxTextFileBytes?: number
  treeConcurrency?: number
  watchBackend?: WatchBackend
  /** Existing metadata database handle. When omitted the service opens and owns its own. */
  metadataDatabase?: MetadataDatabaseHandle
  /** Path for the service-owned metadata database when no handle is provided. */
  metadataDatabasePath?: string
  /** Internal durable transaction root. Tests must always inject an isolated path. */
  workspaceEditJournalRoot?: string
  /** Test seam for deterministic transaction timing. */
  workspaceEditClock?: WorkspaceEditControllerOptions['clock']
  /** Test seam for deterministic transaction filesystem failures. */
  workspaceEditDriver?: WorkspaceEditControllerOptions['driver']
}

const DEFAULT_TREE_CONCURRENCY = 32
const RECENT_CANDIDATE_BATCH_SIZE = 50

type WorkspaceIndexScope = {
  abort: AbortController
  index: WorkspaceIndex
  paths: WorkspacePaths
  startup: Promise<void>
  watcher: WorkspaceIndexWatchSubscription
}

function resolveMaxTextFileBytes(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.MAX_TEXT_FILE_BYTES
  if (raw === undefined) return DEFAULT_MAX_TEXT_FILE_BYTES

  const parsed = Number.parseInt(raw, 10)
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_TEXT_FILE_BYTES_UPPER_BOUND) {
    recordProcessWarning('fs.invalid_max_text_file_bytes', {
      fallback: DEFAULT_MAX_TEXT_FILE_BYTES,
      max: MAX_TEXT_FILE_BYTES_UPPER_BOUND,
      value: raw,
    })
    return DEFAULT_MAX_TEXT_FILE_BYTES
  }

  return parsed
}

export class FileSystemService {
  readonly paths
  readonly changes
  readonly homePath
  readonly systemRoot
  readonly defaultPath
  readonly metadata
  private readonly maxSearchContentBytes
  private readonly maxTextFileBytes
  private readonly workspaceEditJournalRoot
  private readonly workspaceEditReady
  private readonly workspaceEdits
  private latestWorkspaceOpenGeneration = 0
  private workspaceIndexScope: WorkspaceIndexScope | undefined
  private readonly retiringWorkspaceIndexScopes = new Set<Promise<void>>()
  private readonly treeConcurrency

  constructor(options: FileSystemServiceOptions = {}) {
    const homeDirectory = options.homeDirectory ?? homedir()
    this.systemRoot = path.resolve(options.systemRoot ?? path.parse(homeDirectory).root)
    const workspaceEditJournalRoot = path.resolve(
      options.workspaceEditJournalRoot ?? platformHomePath('workspace-edit-journals'),
    )
    this.workspaceEditJournalRoot = workspaceEditJournalRoot
    this.paths = createWorkspacePaths(options.workspaceRoot ?? this.systemRoot, {
      excludedAbsolutePaths: [this.workspaceEditJournalRoot],
    })
    this.homePath = resolveHomePath(this.paths, homeDirectory)
    this.defaultPath = this.homePath
    this.metadata = new FsMetadataStore({
      database: options.metadataDatabase,
      databasePath: options.metadataDatabasePath,
    })
    this.maxSearchContentBytes = options.maxSearchContentBytes ?? 1024 * 1024
    this.maxTextFileBytes = options.maxTextFileBytes ?? resolveMaxTextFileBytes()
    this.treeConcurrency = options.treeConcurrency ?? DEFAULT_TREE_CONCURRENCY
    this.changes = new FileChangeHub(this.paths, {
      backend: options.watchBackend,
      enabled: options.watch ?? true,
    })
    this.workspaceEdits = new WorkspaceEditController({
      changes: this.changes,
      clock: options.workspaceEditClock,
      driver: options.workspaceEditDriver,
      journalRoot: this.workspaceEditJournalRoot,
      paths: this.paths,
    })
    this.workspaceEditReady = this.workspaceEdits.ready()
  }

  get workspaceIndex() {
    return this.workspaceIndexScope?.index
  }

  info() {
    return {
      workspaceRoot: this.paths.workspaceRoot,
      systemRoot: this.systemRoot,
      homePath: this.homePath,
      defaultPath: this.defaultPath,
      metadataDbPath: this.metadata.databasePath,
      maxTextFileBytes: this.maxTextFileBytes,
      workspaceIndex: this.workspaceIndex?.status() ?? inactiveWorkspaceIndexStatus(),
      ...this.changes.info(),
    }
  }

  stat(path: string) {
    return observeRequestOperation(
      { area: 'fs', operation: 'stat', path },
      () => statPath(this.paths, path),
      (result) => ({ entryType: result.type, size: result.size }),
    )
  }

  async openWorkspaceRoot(body: OpenWorkspaceRootBody) {
    return observeRequestOperation(
      {
        area: 'fs',
        generation: body.generation,
        operation: 'open_workspace_root',
        path: body.path,
      },
      () => this.openWorkspaceRootObserved(body),
      (result) => ({
        canonicalPath: result.entry?.path,
        entryType: result.entry?.type,
        openStatus: result.status,
        scanRoot: result.workspaceIndex.scanRoot,
        workspaceAddressId: result.entry?.workspaceAddress.id,
      }),
    )
  }

  private async openWorkspaceRootObserved(body: OpenWorkspaceRootBody) {
    await this.workspaceEditReady
    if (!this.claimWorkspaceOpen(body.generation)) return this.supersededWorkspaceOpen()

    const entry = await registerWorkspaceAddress(this.paths, this.metadata, body.path)
    if (!this.isCurrentWorkspaceOpen(body.generation)) return this.supersededWorkspaceOpen()

    this.installWorkspaceIndexScope(entry.path)
    return {
      entry,
      status: 'opened' as const,
      workspaceIndex: this.info().workspaceIndex,
    }
  }

  registerWorkspaceAddress(input: string) {
    return observeRequestOperation(
      { area: 'fs', operation: 'register_workspace_address', path: input },
      async () =>
        (await registerWorkspaceAddress(this.paths, this.metadata, input)).workspaceAddress,
      (result) => ({ canonicalPath: result.path, workspaceAddressId: result.id }),
    )
  }

  resolveWorkspaceAddress(id: WorkspaceAddressId) {
    return observeRequestOperation(
      { area: 'fs', operation: 'resolve_workspace_address', workspaceAddressId: id },
      () => resolveWorkspaceAddress(this.paths, this.metadata, id),
      (result) => ({ canonicalPath: result.path, workspaceAddressId: result.id }),
    )
  }

  async tree(path: string, depth: number, entryType?: EntryTypeFilter) {
    await this.workspaceEditReady
    return observeRequestOperation(
      { area: 'fs', depth, entryType, operation: 'tree', path },
      () =>
        readTree(this.paths, path, depth, entryType, {
          concurrency: this.treeConcurrency,
        }),
      (result) => ({ entryCount: result.entries.length }),
    )
  }

  read(path: string) {
    return observeRequestOperation(
      { area: 'fs', operation: 'read', path },
      () => readTextFile(this.paths, path, this.maxTextFileBytes),
      (result) => ({ size: result.size }),
    )
  }

  blob(path: string) {
    return observeRequestOperation(
      { area: 'fs', operation: 'blob', path },
      () => getBlobFile(this.paths, path),
      (result) => ({ size: result.size }),
    )
  }

  async write(body: WriteBody) {
    return observeRequestOperation(
      {
        area: 'fs',
        contentBytes: Buffer.byteLength(body.content, 'utf8'),
        hasBaseVersion: body.baseVersion !== undefined,
        hasExpectedMtime: body.expectedMtimeMs !== undefined,
        operation: 'write',
        path: body.path,
        writeId: body.writeId,
      },
      () =>
        this.withMutation({ path: body.path, kind: 'content' }, (target) =>
          this.writeObserved(target, body),
        ),
      (result) => ({ entryType: result.type, size: result.size }),
    )
  }

  private async writeObserved(target: MutationTarget<'content'>, body: WriteBody) {
    recordAppSave(target.absolutePath)

    let path: string
    try {
      path = await writeTextFile(target, body)
    } catch (error) {
      forgetAppSave(target.absolutePath)
      throw error
    }

    const entry = {
      ...(await this.statEntry(path)),
      version: textFileVersion(body.content),
    }
    this.changes.emit({
      type: 'changed',
      path,
      entry,
      origin: body.origin,
      version: entry.version,
      writeId: body.writeId,
    })

    return {
      ...(await this.stat(path)),
      version: entry.version,
    }
  }

  async createFile(body: CreateFileBody) {
    return observeRequestOperation(
      {
        area: 'fs',
        contentBytes: body.content ? Buffer.byteLength(body.content, 'utf8') : 0,
        operation: 'create_file',
        path: body.path,
      },
      () =>
        this.withMutation(
          { path: body.path, kind: body.overwrite ? 'content' : 'entry' },
          (target) => this.createFileObserved(target, body),
        ),
      (result) => ({ entryType: result.type, size: result.size }),
    )
  }

  private async createFileObserved(target: MutationTarget, body: CreateFileBody) {
    const path = await createFile(target, body)
    const entry = await this.statEntry(path)
    this.changes.emit({ type: 'created', path, entry })

    return this.stat(path)
  }

  async createFolder(body: CreateFolderBody) {
    return observeRequestOperation(
      {
        area: 'fs',
        operation: 'create_folder',
        path: body.path,
        recursive: body.recursive,
      },
      () =>
        this.withMutation({ path: body.path, kind: 'content' }, (target) =>
          this.createFolderObserved(target, body),
        ),
      (result) => ({ entryType: result.type }),
    )
  }

  private async createFolderObserved(target: MutationTarget<'content'>, body: CreateFolderBody) {
    const path = await createFolder(target, body)
    const entry = await this.statEntry(path)
    this.changes.emit({ type: 'created', path, entry })

    return entry
  }

  async rename(body: RenameBody) {
    return observeRequestOperation(
      {
        area: 'fs',
        from: body.from,
        operation: 'rename',
        path: body.to,
      },
      () => this.withTransfer(body, (targets) => this.renameObserved(targets, body)),
      (result) => ({ entryType: result.type, size: result.size }),
    )
  }

  private async renameObserved(
    targets: { from: MutationTarget<'entry'>; to: MutationTarget<'entry'> },
    body: RenameBody,
  ) {
    const result = await renamePath(targets, body)
    const entry = await this.statEntry(result.to)
    this.changes.emit({
      entry,
      type: 'renamed',
      oldPath: result.from,
      path: result.to,
    })

    return this.stat(result.to)
  }

  async copy(body: CopyBody) {
    return observeRequestOperation(
      {
        area: 'fs',
        from: body.from,
        operation: 'copy',
        path: body.to,
      },
      () => this.withTransfer(body, (targets) => this.copyObserved(targets, body)),
      (result) => ({ entryType: result.type, size: result.size }),
    )
  }

  private async copyObserved(
    targets: { from: MutationTarget<'entry'>; to: MutationTarget<'entry'> },
    body: CopyBody,
  ) {
    const result = await copyPath(targets, body)
    const entry = await this.statEntry(result.to)
    this.changes.emit({ type: 'created', path: result.to, entry })

    return this.stat(result.to)
  }

  async delete(body: DeleteBody) {
    return observeRequestOperation(
      { area: 'fs', operation: 'delete', path: body.path },
      () =>
        this.withMutation({ path: body.path, kind: 'entry' }, (target) =>
          this.deleteObserved(target, body),
        ),
      (result) => ({ deleted: result.deleted }),
    )
  }

  private async deleteObserved(target: MutationTarget<'entry'>, body: DeleteBody) {
    const path = await deletePath(target, body)
    this.changes.emit({ type: 'deleted', path })

    return { path, deleted: true as const }
  }

  async *searchEvents(
    options: FileSystemSearchOptions,
    signal?: AbortSignal,
  ): AsyncGenerator<SearchStreamEvent> {
    await this.workspaceEditReady
    yield* observedSearchEvents(
      findInWorkspaceStream(
        this.paths,
        {
          ...options,
          maxContentBytes: this.maxSearchContentBytes,
        },
        signal,
        { workspaceIndex: workspaceIndexForSearch(options, this.workspaceIndex) },
      ),
      options,
    )
  }

  async recents(query: RecentsQuery) {
    return observeRequestOperation(
      {
        area: 'fs',
        limit: query.limit,
        mode: query.mode,
        operation: 'recents',
        showHidden: query.showHidden,
      },
      () => this.recentsObserved(query),
      (result) => ({ entryCount: result.entries.length }),
    )
  }

  private async recentsObserved(query: RecentsQuery) {
    const entries: TreeEntry[] = []
    let offset = 0

    while (entries.length < query.limit) {
      const rows = this.metadata.listRecentEntryCandidates({
        limit: RECENT_CANDIDATE_BATCH_SIZE,
        offset,
      })
      if (rows.length === 0) break

      offset += rows.length
      const candidates = await Promise.all(rows.map((row) => this.refreshMetadataEntry(row.path)))
      for (const candidate of candidates) {
        if (!candidate) continue
        if (!matchesRecentQuery(candidate, query)) continue

        entries.push(candidate)
        if (entries.length >= query.limit) break
      }

      if (rows.length < RECENT_CANDIDATE_BATCH_SIZE) break
    }

    return { entries }
  }

  async recordRecent(path: string) {
    return observeRequestOperation(
      { area: 'fs', operation: 'record_recent', path },
      () => this.recordRecentObserved(path),
      (result) => ({ entryType: result.type }),
    )
  }

  private async recordRecentObserved(path: string) {
    const entry = await this.statEntry(path)
    if (!isPickableEntry(entry)) throw new FsError('INVALID_PATH')

    this.metadata.recordPicked(entry)
    return entry
  }

  async *events(paths: string[], signal?: AbortSignal): AsyncGenerator<WatchServerMessage> {
    await this.workspaceEditReady
    yield* observedWatchEvents(this.changes.stream(paths, signal), paths)
  }

  workspaceEditPrepare(body: WorkspaceEditPrepareBody) {
    return this.workspaceEdits.prepare(body)
  }

  workspaceEditCommit(body: WorkspaceEditTransitionBody) {
    return this.workspaceEdits.commit(body)
  }

  workspaceEditFinalize(body: WorkspaceEditTransitionBody) {
    return this.workspaceEdits.finalize(body)
  }

  workspaceEditStatus(operationId: string) {
    return this.workspaceEdits.status(operationId)
  }

  workspaceEditAbort(body: WorkspaceEditTransitionBody) {
    return this.workspaceEdits.abort(body)
  }

  workspaceEditRollback(body: WorkspaceEditTransitionBody) {
    return this.workspaceEdits.rollback(body)
  }

  workspaceEditUndo(body: WorkspaceEditTransitionBody) {
    return this.workspaceEdits.undo(body)
  }

  workspaceEditRedo(body: WorkspaceEditTransitionBody) {
    return this.workspaceEdits.redo(body)
  }

  workspaceEditRecover(body: WorkspaceEditRecoverBody) {
    return this.workspaceEdits.recover(body)
  }

  workspaceEditRelease(body: WorkspaceEditReleaseBody) {
    return this.workspaceEdits.release(body)
  }

  workspaceEditRecovery(workspace: string) {
    return this.workspaceEdits.recovery(workspace)
  }

  async close() {
    if (this.workspaceIndexScope) this.retireWorkspaceIndexScope(this.workspaceIndexScope)
    this.workspaceIndexScope = undefined
    await Promise.all(this.retiringWorkspaceIndexScopes)
    await this.workspaceEditReady
    await this.workspaceEdits.close()
    await this.changes.close()
    this.metadata.close()
  }

  private async withMutation<Kind extends MutationTargetKind, T>(
    input: { path: string; kind: Kind },
    mutation: (target: MutationTarget<Kind>) => Promise<T>,
  ) {
    const target = await resolveMutationTarget(this.paths, input)
    return this.workspaceEdits.withLegacyMutation([target.absolutePath], () => mutation(target))
  }

  private async withTransfer<T>(
    input: { from: string; to: string },
    mutation: (targets: {
      from: MutationTarget<'entry'>
      to: MutationTarget<'entry'>
    }) => Promise<T>,
  ) {
    const [from, to] = await Promise.all([
      resolveMutationTarget(this.paths, { path: input.from, kind: 'entry' }),
      resolveMutationTarget(this.paths, { path: input.to, kind: 'entry' }),
    ])
    return this.workspaceEdits.withLegacyMutation([from.absolutePath, to.absolutePath], () =>
      mutation({ from, to }),
    )
  }

  private claimWorkspaceOpen(generation: number) {
    if (generation <= this.latestWorkspaceOpenGeneration) return false

    this.latestWorkspaceOpenGeneration = generation
    return true
  }

  private isCurrentWorkspaceOpen(generation: number) {
    return generation === this.latestWorkspaceOpenGeneration
  }

  private supersededWorkspaceOpen() {
    return {
      entry: undefined,
      status: 'superseded' as const,
      workspaceIndex: this.info().workspaceIndex,
    }
  }

  private installWorkspaceIndexScope(relativeRoot: string) {
    const absoluteRoot = this.paths.resolve(relativeRoot).absolutePath
    if (this.workspaceIndexScope?.paths.workspaceRoot === absoluteRoot) return

    const previous = this.workspaceIndexScope
    const paths = createWorkspacePaths(absoluteRoot, {
      excludedAbsolutePaths: [this.workspaceEditJournalRoot],
    })
    const index = new WorkspaceIndex(paths)
    const abort = new AbortController()
    const watcher = watchWorkspaceIndex(index, (signal) =>
      scopedWorkspaceIndexEvents(this.changes, this.paths, paths, relativeRoot, signal),
    )
    const startup = startWorkspaceIndex(index, watcher, abort.signal)

    this.workspaceIndexScope = { abort, index, paths, startup, watcher }
    if (previous) this.retireWorkspaceIndexScope(previous)
  }

  private retireWorkspaceIndexScope(scope: WorkspaceIndexScope) {
    scope.abort.abort()
    const retirement = closeWorkspaceIndexScope(scope).finally(() => {
      this.retiringWorkspaceIndexScopes.delete(retirement)
    })
    this.retiringWorkspaceIndexScopes.add(retirement)
  }

  private async refreshMetadataEntry(input: string) {
    try {
      const refreshed = await this.statEntry(input)
      if (!isPickableEntry(refreshed)) return null
      return refreshed
    } catch {
      return null
    }
  }

  private async statEntry(input: string): Promise<TreeEntry> {
    const stat = await this.stat(input)
    return entryFromStat(stat)
  }
}

function isPickableEntry(entry: TreeEntry) {
  const type = effectiveEntryType(entry)
  return type === 'directory' || type === 'file'
}

function matchesRecentQuery(entry: TreeEntry, query: RecentsQuery) {
  if (!query.showHidden && hasHiddenPathSegment(entry.path)) return false
  if (query.mode === 'file') return true

  return effectiveEntryType(entry) === 'directory'
}

function hasHiddenPathSegment(input: string) {
  return input.split('/').some((segment) => segment.startsWith('.'))
}

function workspaceIndexForSearch(
  options: FileSystemSearchOptions,
  index: WorkspaceIndexInstance | undefined,
) {
  if (options.useWorkspaceIndex === false) return undefined

  return index
}

async function startWorkspaceIndex(
  index: WorkspaceIndex,
  watcher: WorkspaceIndexWatchSubscription,
  signal: AbortSignal,
) {
  try {
    await watcher.ready
    if (signal.aborted) return

    await index.rebuild({ reason: 'workspace-root-opened', signal })
  } catch {
    // The index keeps failed status internally; search can continue through fallback paths.
  }
}

async function closeWorkspaceIndexScope(scope: WorkspaceIndexScope) {
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

type SearchStreamState = {
  completed: boolean
  fileCount: number
  matchCount: number
  truncated: boolean
  warningCodes: string[]
}

async function* observedSearchEvents(
  events: AsyncGenerator<SearchStreamEvent>,
  options: FileSystemSearchOptions,
) {
  const startedAt = performance.now()
  const state: SearchStreamState = {
    completed: false,
    fileCount: 0,
    matchCount: 0,
    truncated: false,
    warningCodes: [],
  }
  recordRequestContext({
    area: 'fs',
    operation: 'search_events',
    search: {
      fileLimit: options.fileLimit,
      includeContent: options.includeContent,
      includeNames: options.includeNames,
      limit: options.limit,
      matchMode: options.matchMode,
      queryLength: options.query.length,
      streamNameMatchesEarly: options.streamNameMatchesEarly,
    },
  })

  try {
    for await (const event of events) {
      updateSearchState(state, event)
      yield event
    }
  } catch (error) {
    recordRequestError(error, searchStreamSummary(options, startedAt, state, 'error'))
    recordStreamSummary({
      ...searchStreamSummary(options, startedAt, state, 'error'),
      error: errorSummary(error),
    })
    throw error
  }

  recordStreamSummary(searchStreamSummary(options, startedAt, state, 'ok'))
}

async function* observedWatchEvents(
  events: AsyncGenerator<WatchServerMessage>,
  paths: readonly string[],
) {
  const startedAt = performance.now()
  const state = {
    deliveredCount: 0,
    errorEventCount: 0,
  }
  recordRequestContext({
    area: 'fs',
    operation: 'watch_events',
    watch: {
      subscribedRootCount: paths.length || 1,
    },
  })

  try {
    for await (const event of events) {
      updateWatchState(state, event)
      yield event
    }
  } catch (error) {
    recordRequestError(error, watchStreamSummary(paths, startedAt, state, 'error'))
    recordStreamSummary({
      ...watchStreamSummary(paths, startedAt, state, 'error'),
      error: errorSummary(error),
    })
    throw error
  }

  recordStreamSummary(watchStreamSummary(paths, startedAt, state, 'ok'))
}

function updateSearchState(state: SearchStreamState, event: SearchStreamEvent) {
  if (event.type === 'match') {
    state.matchCount += 1
    return
  }

  if (event.type === 'warning') {
    state.warningCodes.push(event.code)
    return
  }

  state.completed = true
  state.fileCount = event.fileCount ?? state.fileCount
  state.matchCount = event.count
  state.truncated = event.truncated
}

function updateWatchState(
  state: {
    deliveredCount: number
    errorEventCount: number
  },
  event: WatchServerMessage,
) {
  state.deliveredCount += 1
  if (event.type === 'error') state.errorEventCount += 1
}

function searchStreamSummary(
  options: FileSystemSearchOptions,
  startedAt: number,
  state: SearchStreamState,
  status: 'error' | 'ok',
) {
  return {
    area: 'fs',
    completed: state.completed,
    durationMs: elapsedMs(startedAt),
    limit: options.limit,
    matchCount: state.matchCount,
    operation: 'search_events',
    path: options.path,
    search: {
      fileCount: state.fileCount,
      matchCount: state.matchCount,
      queryLength: options.query.length,
      streamNameMatchesEarly: options.streamNameMatchesEarly,
      truncated: state.truncated,
      warningCodes: state.warningCodes.length > 0 ? state.warningCodes : undefined,
    },
    status,
    truncated: state.truncated,
  }
}

function watchStreamSummary(
  paths: readonly string[],
  startedAt: number,
  state: {
    deliveredCount: number
    errorEventCount: number
  },
  status: 'error' | 'ok',
) {
  return {
    area: 'fs',
    deliveredCount: state.deliveredCount,
    durationMs: elapsedMs(startedAt),
    errorEventCount: state.errorEventCount,
    operation: 'watch_events',
    status,
    subscribedRootCount: paths.length || 1,
  }
}

function resolveHomePath(paths: ReturnType<typeof createWorkspacePaths>, homeDirectory: string) {
  const absoluteHome = path.resolve(homeDirectory)

  try {
    paths.assertInside(absoluteHome)
    return paths.toRelative(absoluteHome)
  } catch {
    return ''
  }
}
