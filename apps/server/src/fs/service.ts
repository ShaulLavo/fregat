import { workspaceIndexForSearch } from './search-shared'
import { elapsedMs } from '@workspace/utils/timing'
import { homedir } from 'node:os'
import path from 'node:path'
import {
  DEFAULT_SETTING_VALUES,
  effectiveEntryType,
  isPickableEntry,
  type ServerInfo,
  type WorkspaceAddressId,
} from '@workspace/contracts'
import { platformHomePath } from '../home'
import { createWorkspacePaths } from './path'
import { FileChangeHub } from './watch'
import { entryFromStat } from './entry'
import { DEFAULT_MAX_TEXT_FILE_BYTES, MAX_TEXT_FILE_BYTES_UPPER_BOUND } from './limits'
import { statPath } from './stat'
import { readTree } from './tree'
import { getBlobFile, readTextFile } from './read'
import { writeTextFile } from './write'
import { textFileVersion } from './version'
import { AppWrites } from './app-writes'
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
  operatorErrorSummary,
  observeRequestOperation,
  recordProcessWarning,
  recordRequestContext,
  recordRequestError,
  recordRequestWarning,
  recordStreamSummary,
} from '../observability'
import { findInWorkspaceStream, type FindOptions, type SearchStreamEvent } from './search'
import { FsError, isFsError } from './errors'
import type { MetadataDatabaseHandle } from '../db/client'
import { FsMetadataStore } from './metadata'
import {
  lookupWorkspaceAddresses,
  registerWorkspaceAddress,
  resolveWorkspaceAddress,
} from './workspace-address'
import { WorkspaceIndexScopes } from './workspace-index-scopes'
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
  WorkspaceEditHistoryQuery,
  WriteBody,
} from './contracts'
import { WorkspaceEditController, type WorkspaceEditControllerOptions } from './workspace-edit'
import { driveJournalName } from './workspace-edit-journals'

export type FileSystemSearchOptions = Omit<FindOptions, 'maxContentBytes'>

export type FileSystemServiceOptions = {
  workspaceRoot?: string
  systemRoot?: string
  homeDirectory?: string
  watch?: boolean
  maxSearchContentBytes?: number
  maxTextFileBytes?: number
  treeConcurrency?: number
  /** Existing metadata database handle. When omitted the service opens and owns its own. */
  metadataDatabase?: MetadataDatabaseHandle
  /** Path for the service-owned metadata database when no handle is provided. */
  metadataDatabasePath?: string
  /** Internal durable transaction root. Tests must always inject an isolated path. */
  workspaceEditJournalRoot?: string
  /** A journal at the top of each drive. Defaults on only when no journal root is injected. */
  workspaceEditDriveJournals?: boolean
  /** Test seam: where a drive's journal goes instead of its real mount top. */
  workspaceEditMountTop?: WorkspaceEditControllerOptions['mountTop']
  /** Test seam for deterministic transaction timing. */
  workspaceEditClock?: WorkspaceEditControllerOptions['clock']
  /** Test seam for deterministic transaction filesystem failures. */
  workspaceEditDriver?: WorkspaceEditControllerOptions['driver']
  /** Test seam: how long an index nobody holds stays warm, in milliseconds. */
  workspaceIndexIdleMs?: () => number
}

type SearchIndexSettings = { readonly idleMinutes: number; readonly limit: number }

const DEFAULT_TREE_CONCURRENCY = 32
const RECENT_CANDIDATE_BATCH_SIZE = 50

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
  private readonly appWrites = new AppWrites()
  private readonly maxSearchContentBytes
  private readonly maxTextFileBytes
  private readonly workspaceEditJournalRoot
  private readonly workspaceEditReady
  private readonly workspaceEdits
  private readonly workspaceIndexes: WorkspaceIndexScopes
  private readSearchIndexSettings: () => SearchIndexSettings = () => ({
    idleMinutes: DEFAULT_SETTING_VALUES['files.searchIndexIdleMinutes'],
    limit: DEFAULT_SETTING_VALUES['files.searchIndexLimit'],
  })
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
      excludedNames: [driveJournalName(process.getuid?.() ?? 0)],
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
      enabled: options.watch ?? true,
    })
    this.workspaceEdits = new WorkspaceEditController({
      changes: this.changes,
      clock: options.workspaceEditClock,
      driveJournals: options.workspaceEditDriveJournals ?? !options.workspaceEditJournalRoot,
      driver: options.workspaceEditDriver,
      journalRoot: this.workspaceEditJournalRoot,
      mountTop: options.workspaceEditMountTop,
      paths: this.paths,
    })
    this.workspaceEditReady = this.workspaceEdits.ready()
    this.workspaceIndexes = new WorkspaceIndexScopes({
      changes: this.changes,
      excludedAbsolutePaths: [this.workspaceEditJournalRoot],
      idleMs:
        options.workspaceIndexIdleMs ?? (() => this.readSearchIndexSettings().idleMinutes * 60_000),
      limit: () => this.readSearchIndexSettings().limit,
      paths: this.paths,
    })
  }

  /** The index whose root is exactly `root` (workspace-relative), while one is held or warm. */
  workspaceIndex(root: string) {
    return this.workspaceIndexes.get(this.paths.resolve(root).absolutePath)
  }

  /** `files.searchIndexLimit` and `files.searchIndexIdleMinutes`, read when they apply. */
  set searchIndexSettings(read: () => SearchIndexSettings) {
    this.readSearchIndexSettings = read
  }

  /** `files.watchDirectoryLimit`, read at each attach; the settings store is built after this service. */
  set watchDirectoryLimit(read: () => number) {
    this.changes.directoryLimit = read
  }

  /** After `files.watchDirectoryLimit` changes: watches over it shed, limited roots that now fit grow. */
  rebalanceWatchLimit() {
    this.changes.rebalance()
  }

  info(): ServerInfo {
    return {
      workspaceRoot: this.paths.workspaceRoot,
      systemRoot: this.systemRoot,
      homePath: this.homePath,
      defaultPath: this.defaultPath,
      metadataDbPath: this.metadata.databasePath,
      maxTextFileBytes: this.maxTextFileBytes,
      workspaceIndexes: this.workspaceIndexes.statuses(),
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
      { area: 'fs', operation: 'open_workspace_root', path: body.path },
      () => this.openWorkspaceRootObserved(body),
      (result) => ({
        canonicalPath: result.entry.path,
        entryType: result.entry.type,
        workspaceAddressId: result.entry.workspaceAddress.id,
      }),
    )
  }

  /** Validates and registers the root. Its index belongs to the clients streaming its events. */
  private async openWorkspaceRootObserved(body: OpenWorkspaceRootBody) {
    await this.workspaceEditReady
    return { entry: await registerWorkspaceAddress(this.paths, this.metadata, body.path) }
  }

  registerWorkspaceAddress(input: string) {
    return observeRequestOperation(
      { area: 'fs', operation: 'register_workspace_address', path: input },
      async () =>
        (await registerWorkspaceAddress(this.paths, this.metadata, input)).workspaceAddress,
      (result) => ({ canonicalPath: result.path, workspaceAddressId: result.id }),
    )
  }

  async lookupWorkspaceAddresses(inputs: readonly string[]) {
    const { entries, failures } = await observeRequestOperation(
      { area: 'fs', operation: 'lookup_workspace_addresses', pathCount: inputs.length },
      () => lookupWorkspaceAddresses(this.paths, this.metadata, inputs),
      (result) => ({ failureCount: result.failures.length, prunedCount: result.prunedCount }),
    )
    // A missing folder is an answer; a candidate the server could not read is degraded.
    const unreadable = failures.filter(
      (failure) => failure.status >= 500 || failure.code === 'PERMISSION_DENIED',
    )
    if (unreadable.length > 0) {
      recordRequestWarning('workspace address lookup could not read some candidates', {
        failureCodes: [...new Set(unreadable.map((failure) => failure.code))],
        unreadableCount: unreadable.length,
      })
    }
    return { entries }
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

  read(path: string, acceptTextOnly = false) {
    return observeRequestOperation(
      { area: 'fs', acceptTextOnly, operation: 'read', path },
      () => readTextFile(this.paths, path, this.maxTextFileBytes, { acceptTextOnly }),
      (result) => ({ lossy: result.lossy, seemsBinary: result.seemsBinary, size: result.size }),
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
    const version = textFileVersion(body.content)
    await this.appWrites.record(target.absolutePath, version)
    const write = this.beginWriteEvents(target, body)
    try {
      return await this.publishWrittenFile(target, body, write)
    } catch (error) {
      await this.appWrites.forget(target.absolutePath, version)
      throw error
    } finally {
      if (write) this.changes.finishWrite(write)
    }
  }

  private async publishWrittenFile(
    target: MutationTarget<'content'>,
    body: WriteBody,
    write: ReturnType<FileChangeHub['beginWrite']> | undefined,
  ) {
    const path = await writeTextFile(target, body, this.maxTextFileBytes)
    const entry = {
      ...(await this.statEntry(path)),
      version: textFileVersion(body.content),
    }
    const event: WatchServerMessage = {
      type: 'changed',
      path,
      entry,
      origin: body.origin,
      version: entry.version,
      writeId: body.writeId,
    }
    if (write) this.changes.finishWrite(write, event)
    else this.changes.emit(event)

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
        writeId: body.writeId,
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
    const write = this.beginWriteEvents(target, body)
    try {
      const version = textFileVersion(body.content ?? '')
      const path = await createFile(target, body, this.maxTextFileBytes)
      const entry = { ...(await this.statEntry(path)), version }
      const event: WatchServerMessage = {
        type: 'created',
        path,
        entry,
        origin: body.origin,
        writeId: body.writeId,
        version,
      }
      if (write) this.changes.finishWrite(write, event)
      else this.changes.emit(event)

      return { ...(await this.stat(path)), version }
    } finally {
      if (write) this.changes.finishWrite(write)
    }
  }

  private beginWriteEvents(
    target: MutationTarget,
    body: { readonly origin?: string; readonly writeId?: string },
  ) {
    if (!body.origin || !body.writeId) return undefined
    return this.changes.beginWrite([
      target.relativePath,
      this.paths.toRealRelative(target.absolutePath),
    ])
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
        { workspaceIndex: workspaceIndexForSearch(options, this.workspaceIndex(options.path)) },
      ),
      options,
    )
  }

  async recents(query: RecentsQuery) {
    const { entries } = await observeRequestOperation(
      {
        area: 'fs',
        limit: query.limit,
        mode: query.mode,
        operation: 'recents',
        showHidden: query.showHidden,
      },
      () => this.recentsObserved(query),
      (result) => ({ entryCount: result.entries.length, prunedCount: result.prunedCount }),
    )
    return { entries }
  }

  private async recentsObserved(query: RecentsQuery) {
    const entries: TreeEntry[] = []
    const missing: string[] = []
    let offset = 0

    while (entries.length < query.limit) {
      const rows = this.metadata.listRecentEntryCandidates({
        limit: RECENT_CANDIDATE_BATCH_SIZE,
        offset,
      })
      if (rows.length === 0) break

      offset += rows.length
      const candidates = await Promise.all(
        rows.map((row) => this.refreshMetadataEntry(row.path, missing)),
      )
      for (const candidate of candidates) {
        if (!candidate) continue
        if (!matchesRecentQuery(candidate, query)) continue

        entries.push(candidate)
        if (entries.length >= query.limit) break
      }

      if (rows.length < RECENT_CANDIDATE_BATCH_SIZE) break
    }

    // Pruned after the scan: deleting mid-scan would shift the offset past unread rows.
    return { entries, prunedCount: this.metadata.forgetPicked(missing) }
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

  isAppWrite(absolutePath: string, version: string) {
    return observeRequestOperation(
      { area: 'fs', operation: 'app_write', path: absolutePath },
      async () => ({ appWrite: await this.appWrites.matches(absolutePath, version) }),
      (result) => result,
    )
  }

  async *events(
    paths: string[],
    signal?: AbortSignal,
    files: readonly string[] = [],
    onlyFiles = false,
  ): AsyncGenerator<WatchServerMessage> {
    await this.workspaceEditReady
    // A project stream on one root (none means the workspace root) holds that root's index.
    const release =
      !onlyFiles && paths.length <= 1 ? this.acquireWorkspaceIndex(paths[0] ?? '') : null
    try {
      yield* observedWatchEvents(this.changes.stream(paths, signal, { files, onlyFiles }), paths)
    } finally {
      release?.()
    }
  }

  private acquireWorkspaceIndex(root: string) {
    try {
      return this.workspaceIndexes.acquire(root)
    } catch {
      // A root that does not resolve fails the stream itself, which reports it.
      return null
    }
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

  workspaceEditHistory(query: WorkspaceEditHistoryQuery) {
    return this.workspaceEdits.history(query.workspace, query.category)
  }

  async close() {
    await this.workspaceIndexes.close()
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

  private async refreshMetadataEntry(input: string, missing: string[]) {
    try {
      const refreshed = await this.statEntry(input)
      if (!isPickableEntry(refreshed)) return null
      return refreshed
    } catch (error) {
      if (isFsError(error) && error.code === 'NOT_FOUND') missing.push(input)
      return null
    }
  }

  private async statEntry(input: string): Promise<TreeEntry> {
    const stat = await this.stat(input)
    return entryFromStat(stat)
  }
}

function matchesRecentQuery(entry: TreeEntry, query: RecentsQuery) {
  if (!query.showHidden && hasHiddenPathSegment(entry.path)) return false
  if (query.mode === 'file') return true

  return effectiveEntryType(entry) === 'directory'
}

function hasHiddenPathSegment(input: string) {
  return input.split('/').some((segment) => segment.startsWith('.'))
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

  // Without `recorded`, the `finally` adds a second `fs.operations[]` entry to
  // every completed and failed search — one wide event becomes two.
  let recorded = false
  const record = (outcome: SearchStreamOutcome, error?: unknown) => {
    if (recorded) return
    recorded = true
    if (error !== undefined) {
      recordRequestError(error, searchStreamSummary(options, startedAt, state, outcome))
      recordStreamSummary({
        ...searchStreamSummary(options, startedAt, state, outcome),
        error: operatorErrorSummary(error),
      })
      return
    }

    recordStreamSummary(searchStreamSummary(options, startedAt, state, outcome))
  }

  try {
    for await (const event of events) {
      updateSearchState(state, event)
      yield event
    }
    record('ok')
  } catch (error) {
    record('error', error)
    throw error
  } finally {
    // A client disconnect calls `events.return()`, resuming at the `yield` with
    // neither an error nor a completion — so nothing above this records it.
    record('aborted')
  }
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
      error: operatorErrorSummary(error),
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

type SearchStreamOutcome = 'aborted' | 'error' | 'ok'

function searchStreamSummary(
  options: FileSystemSearchOptions,
  startedAt: number,
  state: SearchStreamState,
  // 'aborted' is a terminal condition, not an absence of one.
  status: SearchStreamOutcome,
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
