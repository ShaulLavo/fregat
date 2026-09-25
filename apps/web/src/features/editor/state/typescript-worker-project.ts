import { log } from '@/lib/client-logging'
import { QueryObserver, type QueryClient, type FetchQueryOptions } from '@tanstack/react-query'
import {
  LspConnectionPool,
  type LanguageServerConnectionContext,
  type LanguageServerDocumentSyncController,
} from '@singapore-editor/lsp-plugin'
import type { LspConnectionLease } from '@singapore-editor/lsp-plugin'
import type { TypeScriptLspWorkspace } from '@singapore-editor/typescript-lsp'
import type { EditorDocumentStoreApi } from './document-state'
import { WorkerBudget } from './typescript-worker-budget'
import { synchronizeWorkerDocuments } from './typescript-worker-documents'
import { runMutation } from '@/lib/mutations/run'
import { editorMutationKeys } from '@/features/editor/utils/mutation-keys'
import { editorQueryKeys } from '@/features/editor/utils/query-keys'
import {
  typescriptWorkerFilesQuery,
  typescriptWorkerProgramQuery,
  typescriptWorkerProjectQuery,
} from '@/features/editor/utils/typescript-worker-query'
import {
  insideRoot,
  virtualPath,
  workerIncludedFile,
  workerIncludedDirectory,
} from '@/features/editor/utils/typescript-worker-paths'
import { subscribeFilesystemEvents } from '@/lib/filesystem-events'
import { clientErrors } from '@/lib/structured-errors'

type Metadata = Awaited<ReturnType<ReturnType<typeof typescriptWorkerProjectQuery>['queryFn']>>
type Program = Awaited<ReturnType<ReturnType<typeof typescriptWorkerProgramQuery>['queryFn']>>
type Events = Parameters<Parameters<typeof subscribeFilesystemEvents>[1]>[0]
type Module = typeof import('@singapore-editor/typescript-lsp')
export type WorkerProjectOptions = {
  readonly client: QueryClient
  readonly documents: EditorDocumentStoreApi
  readonly root: string
  readonly file: string
  readonly maxFiles: number
  readonly maxBytes: number
  readonly documentSyncController: LanguageServerDocumentSyncController
}
type Borrower = {
  readonly key: string
  ready(project: WorkerProject): void
  error(error: unknown): void
}
const projects = new WeakMap<QueryClient, Map<string, WorkerProject>>()

type WorkerSettings = {
  readonly backend: string
  readonly maxFiles: number
  readonly maxBytes: number
}

export function configureWorkerProjects(client: QueryClient, settings: WorkerSettings) {
  for (const project of projects.get(client)?.values() ?? []) project.configure(settings)
}

export function acquireWorkerProject(options: WorkerProjectOptions, borrower: Borrower) {
  let released = false
  let project: WorkerProject | undefined
  const query = typescriptWorkerProjectQuery(options.root, options.file)
  const observer = new QueryObserver(options.client, { ...query, enabled: false })
  const unsubscribe = observer.subscribe(() => undefined)
  const acquire = () => {
    void options.client
      .fetchQuery(query)
      .then((metadata) => {
        if (released || project) return
        const group = projects.get(options.client) ?? new Map<string, WorkerProject>()
        projects.set(options.client, group)
        const identity = JSON.stringify([
          options.root,
          metadata.config,
          options.maxFiles,
          options.maxBytes,
        ])
        project = group.get(identity)
        if (!project) {
          project = new WorkerProject(options, metadata, identity, () => {
            group.delete(identity)
            if (!group.size) projects.delete(options.client)
          })
          group.set(identity, project)
        }
        project.add(borrower)
        unsubscribeDiscovery()
      })
      .catch((error) => {
        if (!released) borrower.error(error)
      })
  }
  const unsubscribeDiscovery = subscribeFilesystemEvents(options.client, (events) => {
    if (
      !project &&
      events.some((event) => event.type === 'rescan' && insideRoot(options.root, event.path))
    )
      acquire()
  })
  acquire()
  return {
    dispose() {
      if (released) return
      released = true
      project?.remove(borrower)
      unsubscribeDiscovery()
      unsubscribe()
    },
  }
}

export class WorkerProject {
  module: Module | null = null
  workspace: TypeScriptLspWorkspace | null = null
  program: Program | null = null
  private readonly pool = new LspConnectionPool({
    idleGraceMs: 0,
    onEvent: (event) =>
      log.info({
        action: 'lsp.worker.connection',
        area: 'lsp',
        rootPath: this.options.root,
        outcome: event.kind,
        status: event.status,
        leaseCount: event.leaseCount,
        durationMs: event.durationMs,
      }),
  })
  connectionProvider: ReturnType<LspConnectionPool['provider']>
  private readonly borrowers = new Set<Borrower>()
  private readonly ownerKeys = new Set<string>()
  private readonly connections = new Map<
    LanguageServerConnectionContext['client'],
    { workspace: { dispose(): void }; sync: ReturnType<typeof synchronizeWorkerDocuments> }
  >()
  private readonly retainedConnections = new Set<LspConnectionLease>()
  private readonly unsubscribeDocuments: () => void
  private readonly activeReads = new Set<() => void>()
  private roots: ReadonlySet<string>
  private readonly disk = new Map<string, Program['disk'][number]>()
  private readonly aliases = new Map<string, string[]>()
  private readonly budget: WorkerBudget
  private readonly unsubscribe: () => void
  private pending: Events[number][] = []
  private queued = false
  private disposed = false
  private generation = 0
  private failed = false

  constructor(
    private readonly options: WorkerProjectOptions,
    private metadata: Metadata,
    private readonly identity: string,
    private readonly onDispose: () => void,
  ) {
    this.roots = new Set(metadata.roots)
    this.connectionProvider = this.retainedProvider(identity)
    this.budget = new WorkerBudget({
      store: options.documents,
      maxBytes: options.maxBytes,
      maxFiles: options.maxFiles,
      includes: (path) => this.includes(path),
      onRelease: (path) => this.receive([{ type: 'changed', path }]),
      onError: (error) => this.fail(error),
    })
    this.unsubscribe = subscribeFilesystemEvents(options.client, (events) => this.receive(events))
    this.unsubscribeDocuments = options.documents.subscribe((state, previous) => {
      if (state.liveDocumentsByKey !== previous.liveDocumentsByKey) this.disposeIfUnused()
    })
    void this.enqueue(() => this.reload())
  }

  add(borrower: Borrower) {
    this.borrowers.add(borrower)
    this.ownerKeys.add(borrower.key)
    this.reconcileConnections()
    if (this.program && !this.failed) borrower.ready(this)
    if (this.failed) void this.enqueue(() => this.reload())
  }

  remove(borrower: Borrower) {
    this.borrowers.delete(borrower)
    if (![...this.borrowers].some((other) => other.key === borrower.key))
      this.ownerKeys.delete(borrower.key)
    this.reconcileConnections()
    this.disposeIfUnused()
  }

  private disposeIfUnused() {
    if (this.disposed || this.borrowers.size) return
    const retained = Object.values(this.options.documents.getState().liveDocumentsByKey).some(
      (document) => document.target.kind === 'file' && this.includes(document.target.resource.path),
    )
    if (retained) return
    this.dispose()
  }

  configure(settings: WorkerSettings) {
    if (
      settings.backend === 'worker' &&
      settings.maxFiles === this.options.maxFiles &&
      settings.maxBytes === this.options.maxBytes
    )
      return
    this.dispose()
  }

  private dispose() {
    if (this.disposed) return
    this.disposed = true
    this.unsubscribe()
    this.unsubscribeDocuments()
    this.budget.dispose()
    for (const unsubscribe of this.activeReads) unsubscribe()
    this.activeReads.clear()
    this.retireConnections()
    this.pool.dispose()
    this.workspace?.setWorkspaceFiles([])
    void this.options.client.cancelQueries({ queryKey: this.programQuery().queryKey, exact: true })
    this.options.client.removeQueries({ queryKey: this.programQuery().queryKey, exact: true })
    this.onDispose()
  }

  registerConnection(connection: LanguageServerConnectionContext) {
    if (!this.connections.has(connection.client) && this.workspace) {
      this.connections.set(connection.client, {
        workspace: this.workspace.registerClient(connection.client, (error) => this.fail(error)),
        sync: synchronizeWorkerDocuments(connection, {
          store: this.options.documents,
          ownerKeys: this.ownerKeys,
          controller: this.options.documentSyncController,
          includes: (path) => this.includes(path),
        }),
      })
    }
    // The live document store owns the shared worker beyond any one mounted view.
    return { dispose() {} }
  }

  private retainedProvider(identity: string): ReturnType<LspConnectionPool['provider']> {
    const provider = this.pool.provider(identity)
    let retained = false
    return {
      acquire: (options, callbacks) => {
        const view = provider.acquire(options, callbacks)
        if (!retained) {
          this.retainedConnections.add(
            provider.acquire(
              { ...options, notificationHandlers: {}, serverRequestHandlers: {} },
              {
                onConnected: () => {
                  for (const client of this.connections.keys()) this.workspace?.syncClient(client)
                },
                onUnavailable: () => {
                  this.failed = true
                },
                onPublishDiagnostics: () => undefined,
                onError: (error) => this.fail(error),
              },
            ),
          )
          retained = true
        }
        return view
      },
    }
  }

  private retireConnections() {
    for (const connection of this.connections.values()) {
      connection.sync.dispose()
      connection.workspace.dispose()
    }
    this.connections.clear()
    for (const connection of this.retainedConnections) connection.release()
    this.retainedConnections.clear()
  }

  private reconcileConnections() {
    for (const connection of this.connections.values()) connection.sync.reconcile()
  }
  private includes(path: string) {
    return (
      this.roots.has(virtualPath(path)) ||
      this.aliases.has(virtualPath(path)) ||
      this.disk.has(virtualPath(path)) ||
      workerIncludedFile(path, this.metadata.watch)
    )
  }
  private programQuery() {
    const o = this.options
    return typescriptWorkerProgramQuery(
      o.root,
      o.file,
      o.maxFiles,
      o.maxBytes,
      this.metadata.config,
    )
  }
  private enqueue(run: () => Promise<void>) {
    return runMutation(
      this.options.client,
      {
        mutationKey: editorMutationKeys.typescriptWorkerSync(this.identity),
        scope: { id: `typescript-worker:${this.identity}` },
        gcTime: 0,
        mutationFn: async () => {
          if (!this.disposed) await run()
        },
      },
      undefined,
    ).catch((error) => this.fail(error))
  }
  private fail(error: unknown) {
    if (this.disposed) return
    this.failed = true
    for (const borrower of this.borrowers) borrower.error(error)
    this.retireConnections()
  }

  private async read<T>(query: FetchQueryOptions<T>) {
    const observer = new QueryObserver(this.options.client, { ...query, enabled: false })
    const unsubscribe = observer.subscribe(() => undefined)
    this.activeReads.add(unsubscribe)
    try {
      return await this.options.client.fetchQuery(query)
    } finally {
      unsubscribe()
      this.activeReads.delete(unsubscribe)
    }
  }

  private async reload() {
    const query = this.programQuery()
    await this.options.client.invalidateQueries({
      queryKey: query.queryKey,
      exact: true,
      refetchType: 'none',
    })
    const [module, program] = await Promise.all([
      this.options.client.fetchQuery({
        queryKey: editorQueryKeys.typescriptWorkerModule(),
        queryFn: () => import('@singapore-editor/typescript-lsp'),
        staleTime: Infinity,
      }),
      this.options.client.fetchQuery(query),
    ])
    if (this.disposed) return
    const changed =
      !this.program ||
      JSON.stringify([this.program.options, this.program.aliases]) !==
        JSON.stringify([program.options, program.aliases])
    this.module = module
    this.workspace ??= new module.TypeScriptLspWorkspace()
    this.program = program
    this.disk.clear()
    for (const file of program.disk) this.disk.set(file.path, file)
    this.aliases.clear()
    for (const alias of program.aliases)
      this.aliases.set(alias.canonicalPath, [
        ...(this.aliases.get(alias.canonicalPath) ?? []),
        alias.path,
      ])
    this.budget.setDisk(program.files)
    this.workspace.setWorkspaceFiles(program.files)
    const restart = changed || this.failed
    this.failed = false
    if (restart) {
      this.retireConnections()
      this.connectionProvider = this.retainedProvider(`${this.identity}:${++this.generation}`)
      for (const borrower of this.borrowers) borrower.ready(this)
    }
    this.reconcileConnections()
  }

  private receive(events: Events) {
    if (this.disposed) return
    this.pending.push(...events.filter((event) => this.relevant(event)))
    if (!this.pending.length || this.queued) return
    this.queued = true
    void this.enqueue(async () => {
      const batch = this.pending.splice(0)
      this.queued = false
      await this.update(batch)
    })
  }

  private relevant(event: Events[number]) {
    if (event.type === 'rescan') return insideRoot(this.options.root, event.path)
    if (event.type === 'created' && event.entry?.type === 'directory') return false
    if (this.metadata.watch.configFiles.includes(virtualPath(event.path))) return true
    if (this.includes(event.path)) return true
    if (event.type === 'renamed' && this.includes(event.oldPath)) return true
    if (
      event.type === 'renamed' &&
      event.entry?.type === 'directory' &&
      (workerIncludedDirectory(event.path, this.metadata.watch) ||
        this.metadata.roots.some((path) => insideRoot(path, event.path)))
    )
      return true
    if (event.type !== 'deleted' && event.type !== 'renamed') return false
    const ancestor = event.type === 'renamed' ? event.oldPath : event.path
    return [...this.disk.keys()].some((path) => insideRoot(path, ancestor))
  }

  private async update(events: Events) {
    if (!this.program || this.failed) {
      await this.reload()
      return
    }
    const rescan = events.some((event) => event.type === 'rescan')
    const configuration = events.some((event) =>
      this.metadata.watch.configFiles.includes(virtualPath(event.path)),
    )
    if (configuration || rescan) {
      const query = typescriptWorkerProjectQuery(
        this.options.root,
        this.options.file,
        this.metadata.config,
      )
      await this.options.client.invalidateQueries({
        queryKey: query.queryKey,
        exact: true,
        refetchType: 'none',
      })
      const metadata = await this.read(query)
      const changed = JSON.stringify(metadata) !== JSON.stringify(this.metadata)
      this.metadata = metadata
      this.roots = new Set(metadata.roots)
      if (changed || configuration) {
        await this.reload()
        return
      }
    }
    if (events.some((event) => event.type !== 'changed' && event.type !== 'rescan')) {
      await this.reload()
      return
    }
    const paths = rescan
      ? [...this.disk.keys()]
      : [...new Set(events.map((event) => virtualPath(event.path)))]
    const versions = rescan
      ? Object.fromEntries([...this.disk.values()].map((file) => [file.path, file.diskVersion]))
      : {}
    const result = await this.read(
      typescriptWorkerFilesQuery(paths, this.options.maxBytes, versions),
    )
    if (this.disposed) return
    if (result.failed.some((file) => file.code !== 'NOT_FOUND'))
      throw clientErrors.TYPESCRIPT_WORKER_INCOMPLETE({ internal: { failed: result.failed } })
    if (
      result.failed.length ||
      result.files.some((file) => this.disk.get(file.path)?.dependencies !== file.dependencies)
    ) {
      await this.reload()
      return
    }
    const changed = result.files.flatMap((file) =>
      (this.aliases.get(file.path) ?? [file.path]).map((path) => ({ ...file, path })),
    )
    this.budget.upsertDisk(changed)
    for (const file of changed) this.disk.set(file.path, file)
    this.workspace?.upsertWorkspaceFiles(changed.map(({ path, text }) => ({ path, text })))
  }
}
