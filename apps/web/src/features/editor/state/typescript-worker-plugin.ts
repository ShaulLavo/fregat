import { acquireWorkerProject, type WorkerProject } from './typescript-worker-project'
import type { EditorDocumentStoreApi } from '@/features/editor/state/document-state'
import type { EditorDisposable, EditorPlugin } from '@singapore-editor/core/extensions'
import type { QueryClient } from '@tanstack/react-query'
import type { LanguageServerDocument } from '@/lib/language-server-document'
import type {
  OnApplyWorkspaceEdit,
  LanguageServerDiagnosticActions,
  LanguageServerDocumentSyncController,
  LanguageServerDefinitionTarget,
  LanguageServerReferencesResult,
} from '@singapore-editor/lsp-plugin'
import type { EditorLanguageServerStatusSource } from '@/features/editor/state/language-server-status-source'
import { lspLanguageIdForPath } from '@/features/editor/utils/lsp-language-id'
import { fileUriForPath } from '@/lib/file-uri'
import { reportError, toClientError } from '@/lib/client-error-taxonomy'
import { isMissingWorkerProject } from '@/features/editor/utils/typescript-worker-query'

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
  readonly getDiagnosticActions?: LanguageServerDiagnosticActions
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

class TypeScriptWorkerOwner {
  private registration: ReturnType<EditorPlugin['activate']> = undefined
  private readonly lease: { dispose(): void }
  private disposed = false

  constructor(
    private readonly options: Options,
    private readonly context: Parameters<EditorPlugin['activate']>[0],
  ) {
    this.lease = acquireWorkerProject(options, {
      key: options.document.key,
      ready: (project) => this.start(project),
      error: (error) => this.fail(error),
    })
  }

  dispose() {
    this.disposed = true
    this.stop()
    this.lease.dispose()
  }

  private stop() {
    disposeRegistration(this.registration)
    this.registration = undefined
  }
  private fail(error: unknown) {
    if (this.disposed) return
    this.stop()
    // The hook hands a file with no project back to the server backend.
    if (isMissingWorkerProject(error)) return
    this.options.status.setServerStatus(SERVER_ID, 'error')
    reportError(toClientError(error))
  }

  private start(project: WorkerProject) {
    if (this.disposed || !project.program || !project.module || !project.workspace) return
    this.stop()
    const options = this.options
    const plugin = project.module.createTypeScriptLspPlugin({
      rootUri: fileUriForPath(options.root),
      compilerOptions: project.program.options,
      canonicalPaths: Object.fromEntries(
        project.program.aliases.map((file) => [file.path, file.canonicalPath]),
      ),
      workspace: project.workspace,
      connectionProvider: project.connectionProvider,
      documentSync: {
        controller: options.documentSyncController,
        languageIdForDocument: (_languageId, uri) => lspLanguageIdForPath(uri),
        uriForDocument: (snapshot) =>
          snapshot.documentId === options.document.key ? options.document.uri : null,
      },
      onConnectionCreated: (connection) => project.registerConnection(connection),
      onApplyWorkspaceEdit: options.onApplyWorkspaceEdit,
      getDiagnosticActions: options.getDiagnosticActions,
      onOpenDefinition: options.onOpenDefinition,
      onOpenReferences: options.onOpenReferences,
      onStatusChange: (status) => options.status.setServerStatus(SERVER_ID, status),
      onDiagnostics: (diagnostics) => options.status.setServerDiagnostics(SERVER_ID, diagnostics),
      onError: (error) => this.fail(error),
    })
    this.registration = plugin.activate(this.context)
  }
}

function disposeRegistration(registration: ReturnType<EditorPlugin['activate']>) {
  if (!registration) return
  if (Array.isArray(registration)) {
    for (const disposable of registration) disposable.dispose()
    return
  }
  ;(registration as EditorDisposable).dispose()
}
