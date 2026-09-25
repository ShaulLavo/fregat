import { synchronizeWorkerDocuments } from './typescript-worker-documents'
import type { EditorDocumentStoreApi } from '@/features/editor/state/document-state'
import { clientErrors } from '@/lib/structured-errors'
import { runMutation } from '@/lib/mutations/run'
import { editorMutationKeys } from '@/features/editor/utils/mutation-keys'
import type { EditorDisposable, EditorPlugin } from '@singapore-editor/core/extensions'
import type { QueryClient } from '@tanstack/react-query'
import type { TypeScriptLspPlugin } from '@singapore-editor/typescript-lsp'
import type { LanguageServerDocument } from '@/lib/language-server-document'
import type {
  OnApplyWorkspaceEdit,
  LanguageServerDocumentSyncController,
  LanguageServerDefinitionTarget,
  LanguageServerReferencesResult,
} from '@singapore-editor/lsp-plugin'
import type { EditorLanguageServerStatusSource } from '@/features/editor/state/language-server-status-source'
import { editorQueryKeys } from '@/features/editor/utils/query-keys'
import { typescriptWorkerProgramQuery } from '@/features/editor/utils/typescript-worker-query'
import { subscribeFilesystemEvents } from '@/lib/filesystem-events'
import { lspLanguageIdForPath } from '@/features/editor/utils/lsp-language-id'
import { fileUriForPath } from '@/lib/file-uri'
import { reportError, toClientError } from '@/lib/client-error-taxonomy'

const SERVER_ID = 'typescript-worker'

export function withWorkerStatus(
  source: EditorLanguageServerStatusSource,
): EditorLanguageServerStatusSource {
  return { ...source, setServers: (ids) => source.setServers([...ids, SERVER_ID]) }
}

type Options = {
  readonly documents: EditorDocumentStoreApi
  readonly server: EditorPlugin
  readonly client: QueryClient
  readonly root: string
  readonly file: string
  readonly document: LanguageServerDocument
  readonly maxFiles: number
  readonly maxBytes: number
  readonly status: EditorLanguageServerStatusSource
  readonly documentSyncController: LanguageServerDocumentSyncController
  readonly onApplyWorkspaceEdit: OnApplyWorkspaceEdit
  readonly onOpenDefinition?: (target: LanguageServerDefinitionTarget) => void | boolean
  readonly onOpenReferences?: (result: LanguageServerReferencesResult) => void | boolean
}

export function withTypeScriptWorker(options: Options): EditorPlugin {
  return {
    name: 'platform.typescript-worker',
    activate: (context) => {
      const server = options.server.activate(context)
      const owner = new TypeScriptWorkerOwner(options, context)
      return {
        dispose: () => {
          owner.dispose()
          disposeRegistration(server)
        },
      }
    },
  }
}

type FilesystemEvents = Parameters<Parameters<typeof subscribeFilesystemEvents>[1]>[0]
type WorkerProgram = Awaited<ReturnType<ReturnType<typeof typescriptWorkerProgramQuery>['queryFn']>>

class TypeScriptWorkerOwner {
  private disposed = false
  private readonly ownerId = crypto.randomUUID()
  private configuration = ''
  private plugin: TypeScriptLspPlugin | null = null
  private registration: ReturnType<EditorPlugin['activate']> = undefined
  private aliases = new Map<string, string[]>()
  private fileSizes = new Map<string, number>()
  private readonly unsubscribe: () => void
  private readonly unsubscribeDocuments: () => void
  private readonly liveRevisions = new Map<string, string>()

  constructor(
    private readonly options: Options,
    private readonly context: Parameters<EditorPlugin['activate']>[0],
  ) {
    this.unsubscribe = subscribeFilesystemEvents(options.client, (events) => this.receive(events))
    this.unsubscribeDocuments = options.documents.subscribe(() => {
      void this.enqueue(async () => this.syncLiveFiles())
    })
    void this.enqueue(() => this.start())
  }

  dispose() {
    this.disposed = true
    void this.options.client.cancelQueries({ queryKey: this.programQuery().queryKey, exact: true })
    this.unsubscribe()
    this.unsubscribeDocuments()
    this.stop()
    this.aliases.clear()
    this.fileSizes.clear()
  }

  private stop() {
    disposeRegistration(this.registration)
    this.registration = undefined
    this.plugin?.clearWorkspaceFiles()
    this.plugin = null
  }

  private enqueue(run: () => Promise<void>) {
    const { client, document } = this.options
    return runMutation(
      client,
      {
        mutationKey: editorMutationKeys.typescriptWorkerSync(document.key),
        scope: { id: `typescript-worker:${document.key}:${this.ownerId}` },
        mutationFn: async () => {
          if (!this.disposed) await run()
        },
        gcTime: 0,
      },
      undefined,
    ).catch((error) => this.fail(error))
  }

  private fail(error: unknown) {
    if (this.disposed) return
    this.stop()
    this.options.status.setServerStatus(SERVER_ID, 'error')
    reportError(toClientError(error))
  }

  private programQuery() {
    const options = this.options
    const query = typescriptWorkerProgramQuery(
      options.root,
      options.file,
      options.maxFiles,
      options.maxBytes,
    )
    return { ...query, queryKey: [...query.queryKey, this.ownerId] }
  }

  private async start(loaded?: WorkerProgram) {
    const options = this.options
    const [module, program] = await Promise.all([
      options.client.fetchQuery({
        queryKey: editorQueryKeys.typescriptWorkerModule(),
        queryFn: () => import('@singapore-editor/typescript-lsp'),
        staleTime: Infinity,
      }),
      loaded ?? options.client.fetchQuery(this.programQuery()),
    ])
    if (this.disposed) return
    this.stop()
    const plugin = module.createTypeScriptLspPlugin({
      rootUri: fileUriForPath(options.root),
      compilerOptions: program.options,
      canonicalPaths: Object.fromEntries(
        program.aliases.map((file) => [file.path, file.canonicalPath]),
      ),
      documentSync: {
        controller: options.documentSyncController,
        languageIdForDocument: (_languageId, uri) => lspLanguageIdForPath(uri),
        uriForDocument: (snapshot) =>
          snapshot.documentId === options.document.key ? options.document.uri : null,
      },
      onConnectionCreated: (connection) =>
        synchronizeWorkerDocuments(connection, {
          store: options.documents,
          ownerKey: options.document.key,
          controller: options.documentSyncController,
          includes: (path) => insideRoot(path, options.root) || this.aliases.has(virtualPath(path)),
        }),
      onApplyWorkspaceEdit: options.onApplyWorkspaceEdit,
      onOpenDefinition: options.onOpenDefinition,
      onOpenReferences: options.onOpenReferences,
      onStatusChange: (status) => options.status.setServerStatus(SERVER_ID, status),
      onDiagnostics: (diagnostics) => options.status.setServerDiagnostics(SERVER_ID, diagnostics),
      onError: (error) => this.fail(error),
    })
    this.configuration = JSON.stringify([program.options, program.aliases])
    this.liveRevisions.clear()
    this.rememberProgram(program)
    plugin.setWorkspaceFiles(program.files)
    this.plugin = plugin
    this.syncLiveFiles()
    this.registration = plugin.activate(this.context)
  }

  private rememberProgram(program: WorkerProgram) {
    this.aliases.clear()
    for (const file of program.aliases) {
      const paths = this.aliases.get(file.canonicalPath) ?? []
      this.aliases.set(file.canonicalPath, [...paths, file.path])
    }
    this.fileSizes = new Map(
      program.files.map((file) => [file.path, new TextEncoder().encode(file.text).byteLength]),
    )
  }

  private syncLiveFiles() {
    if (!this.plugin) return
    const files: { path: string; text: string }[] = []
    const retained = new Set<string>()
    for (const document of Object.values(this.options.documents.getState().liveDocumentsByKey)) {
      if (document.target.kind !== 'file') continue
      const path = virtualPath(document.target.resource.path)
      if (!insideRoot(path, this.options.root) && !this.aliases.has(path)) continue
      retained.add(path)
      if (this.liveRevisions.get(path) === document.contentRevision) continue
      const text = document.buffer.materializeFullText()
      for (const alias of this.aliases.get(path) ?? [path]) files.push({ path: alias, text })
      this.liveRevisions.set(path, document.contentRevision)
    }
    const released = [...this.liveRevisions.keys()].some((path) => !retained.has(path))
    if (released) {
      this.liveRevisions.clear()
      void this.enqueue(() => this.start())
    }
    const sizes = new Map(this.fileSizes)
    for (const file of files) sizes.set(file.path, new TextEncoder().encode(file.text).byteLength)
    const bytes = [...sizes.values()].reduce((sum, size) => sum + size, 0)
    if (sizes.size > this.options.maxFiles || bytes > this.options.maxBytes) {
      throw clientErrors.TYPESCRIPT_WORKER_LIMIT({
        files: sizes.size,
        bytes,
        internal: { root: this.options.root },
      })
    }
    this.fileSizes = sizes
    this.plugin.upsertWorkspaceFiles(files)
  }

  private receive(events: FilesystemEvents) {
    if (this.disposed) return
    const relevant = events.filter((event) => this.relevant(event))
    if (relevant.length) void this.enqueue(() => this.update(relevant))
  }

  private relevant(event: FilesystemEvents[number]) {
    if (event.type === 'rescan') return insideRoot(this.options.root, event.path)
    if ([...this.fileSizes.keys()].some((path) => insideRoot(path, event.path))) return true
    if ('entry' in event && event.entry?.type === 'directory')
      return insideRoot(event.path, this.options.root)
    if (this.aliases.has(virtualPath(event.path)) || this.fileSizes.has(virtualPath(event.path)))
      return true
    if (insideRoot(event.path, this.options.root) && /\.(?:[cm]?[jt]sx?|json)$/.test(event.path))
      return true
    return (
      event.type === 'renamed' &&
      [...this.fileSizes.keys()].some((path) => insideRoot(path, event.oldPath))
    )
  }

  private async update(events: FilesystemEvents) {
    if (!this.plugin) {
      await this.start()
      return
    }
    // Worker notifications are a stream; TanStack serializes their batches with initial loading.
    const removed = events
      .flatMap((event) => removedPaths(event))
      .flatMap((path) => this.aliases.get(virtualPath(path)) ?? [virtualPath(path)])
    this.plugin.deleteWorkspaceFiles(removed)
    for (const path of removed) this.fileSizes.delete(path)
    if (
      events.some(
        (event) =>
          event.type !== 'changed' ||
          /(?:^|\/)(?:[tj]sconfig[^/]*|package)\.json$/.test(event.path),
      )
    ) {
      await this.start()
      return
    }
    // A saved import can introduce files absent from the old program. Refresh its closure;
    // the plugin sends only changed texts to the worker and keeps its live document overlays.
    const program = await this.options.client.fetchQuery(this.programQuery())
    if (this.disposed) return
    if (this.configuration !== JSON.stringify([program.options, program.aliases])) {
      await this.start(program)
      return
    }
    const paths = new Set(program.files.map((file) => file.path))
    this.plugin?.deleteWorkspaceFiles([...this.fileSizes.keys()].filter((path) => !paths.has(path)))
    this.rememberProgram(program)
    this.plugin?.upsertWorkspaceFiles(program.files)
    this.liveRevisions.clear()
    this.syncLiveFiles()
  }
}

function removedPaths(event: FilesystemEvents[number]) {
  if (event.type === 'deleted') return [event.path]
  if (event.type === 'renamed') return [event.oldPath]
  return []
}

function disposeRegistration(registration: ReturnType<EditorPlugin['activate']>) {
  if (!registration) return
  if (Array.isArray(registration)) {
    for (const disposable of registration) disposable.dispose()
    return
  }
  ;(registration as EditorDisposable).dispose()
}

function virtualPath(path: string) {
  return `/${path.replace(/^\/+/, '')}`
}
function insideRoot(path: string, root: string) {
  const normalizedRoot = virtualPath(root).replace(/\/$/, '')
  const normalized = virtualPath(path)
  return normalized === normalizedRoot || normalized.startsWith(`${normalizedRoot}/`)
}
