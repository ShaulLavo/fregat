import type { DocumentSessionChange, EditorTextBuffer } from '@singapore-editor/core/document'
import type {
  EditorContributionChange,
  EditorDisposable,
  EditorViewContributionUpdateKind,
} from '@singapore-editor/core/extensions'
import type { LspTextDocumentSnapshot } from '@singapore-editor/lsp'
import type * as lsp from 'vscode-languageserver-protocol'
import { DocumentSync } from './documentSync'
import { summarizeDiagnostics } from './diagnostics'
import {
  acquireResolvedLanguageServerLane,
  resolveLanguageServerLaneOptions,
  type AcquiredLanguageServerLane,
  type LanguageServerResolvedLaneOptions,
} from './lane'
import { PullDiagnosticsController } from './pullDiagnostics'
import type {
  LanguageServerDocumentSnapshot,
  LanguageServerDiagnosticsFreshness,
  LanguageServerDocumentSyncOptions,
  LanguageServerLaneOptions,
  LanguageServerStatus,
  OnApplyWorkspaceEdit,
} from './types'
import { bufferDocumentSnapshot } from './documentSnapshot'

/** A view's share of one lane's diagnostics for the document. */
export type DocumentLaneDiagnosticsObserver = {
  clear(): void
  render(document: LspTextDocumentSnapshot, diagnostics: readonly lsp.Diagnostic[]): void
  publishSummary(
    uri: lsp.DocumentUri,
    version: number | null,
    diagnostics: readonly lsp.Diagnostic[],
    freshness: LanguageServerDiagnosticsFreshness,
  ): void
}

type DocumentSource = {
  getSnapshot(): LanguageServerDocumentSnapshot
  subscribe?(listener: (change: DocumentSessionChange) => void): () => void
}

export type LanguageServerDocumentOptions = {
  readonly buffer: EditorTextBuffer
  readonly uri: string
  readonly languageId: string
  readonly documentId?: string
  readonly lanes: readonly LanguageServerLaneOptions[]
  readonly onApplyWorkspaceEdit?: OnApplyWorkspaceEdit
  readonly controller?: LanguageServerDocumentSyncOptions['controller']
}

/** A document's protocol state. Views borrow it; its creator disposes it. */
export class LanguageServerDocument {
  readonly lanes: readonly DocumentLanguageServerLane[]
  readonly syncOptions: LanguageServerDocumentSyncOptions
  private readonly unsubscribe: (() => void) | undefined
  private disposed = false

  constructor(
    source: DocumentSource,
    options: {
      readonly lanes: readonly LanguageServerResolvedLaneOptions[]
      readonly documentSync: LanguageServerDocumentSyncOptions
    },
  ) {
    this.syncOptions = options.documentSync
    this.lanes = options.lanes.map(
      (lane) => new DocumentLanguageServerLane(source, lane, options.documentSync),
    )
    this.unsubscribe = source.subscribe?.((change) => this.synchronize(change))
  }

  synchronize(
    change: EditorContributionChange | null = null,
    kind: EditorViewContributionUpdateKind = 'content',
  ): void {
    if (this.disposed) return
    for (const lane of this.lanes) lane.synchronize(change, kind)
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.unsubscribe?.()
    for (const lane of this.lanes) lane.dispose()
  }
}

export function createLanguageServerDocument(
  options: LanguageServerDocumentOptions,
): LanguageServerDocument {
  return new LanguageServerDocument(
    {
      getSnapshot: () => bufferDocumentSnapshot(options),
      subscribe: (listener) => options.buffer.subscribe(({ change }) => listener(change)),
    },
    {
      lanes: options.lanes.map((lane) =>
        resolveLanguageServerLaneOptions({
          ...lane,
          onApplyWorkspaceEdit: options.onApplyWorkspaceEdit ?? lane.onApplyWorkspaceEdit,
        }),
      ),
      documentSync: {
        controller: options.controller,
        uriForDocument: () => options.uri,
      },
    },
  )
}

export class DocumentLanguageServerLane {
  private connectionStatus: LanguageServerStatus = 'idle'

  get status(): LanguageServerStatus {
    return this.connectionStatus
  }
  readonly connection: AcquiredLanguageServerLane
  readonly sync: DocumentSync
  private readonly pullDiagnostics: PullDiagnosticsController | null
  private readonly registration: EditorDisposable | undefined
  private readonly observers = new Set<DocumentLaneDiagnosticsObserver>()
  /** Whether the server has answered for the active document since it became active. */
  private diagnosticsReceived = false
  private diagnosticsVersion: number | null = null
  private unavailable = false
  private readonly listeners = new Set<() => void>()
  private disposed = false

  constructor(
    private readonly source: DocumentSource,
    readonly options: LanguageServerResolvedLaneOptions,
    syncOptions: LanguageServerDocumentSyncOptions,
  ) {
    this.connection = acquireResolvedLanguageServerLane(
      {
        ...options,
        onStatusChange: (status) => {
          this.connectionStatus = status
          options.onStatusChange?.(status)
        },
      },
      {
        onReady: () => {
          this.unavailable = false
          this.synchronize()
          // After a reconnect the document is the same one; only a new request can refresh it.
          if (!this.pullDiagnostics?.pending) this.pullDiagnostics?.synchronize()
          this.republishSummary()
          this.notify()
        },
        onReconnecting: () => {
          this.unavailable = true
          this.pullDiagnostics?.cancel()
          this.sync.clearDiagnostics()
          this.notify()
        },
        onDiagnosticRefresh: () => this.pullDiagnostics?.refresh(),
        onPublishDiagnostics: (params) => {
          if (options.features.diagnostics !== undefined) this.sync.publishDiagnostics(params)
        },
        onUnavailable: () => {
          this.connectionStatus = 'error'
          this.unavailable = true
          this.pullDiagnostics?.cancel()
          this.sync.clearDiagnostics()
          this.notify()
        },
      },
    )
    this.sync = new DocumentSync(
      this.connection.workspace,
      {
        clear: () => {
          for (const observer of this.observers) observer.clear()
        },
        render: (document, diagnostics) => {
          for (const observer of this.observers) observer.render(document, diagnostics)
        },
        publishSummary: (uri, version, diagnostics, kind) => {
          this.diagnosticsReceived = kind === 'result'
          this.diagnosticsVersion = version
          this.publishSummary(uri, version, diagnostics)
        },
      },
      {
        ...syncOptions,
        logicalRevisionScope: this.connection.logicalRevisionScope,
        onDocumentClosed: () => this.notify(),
      },
    )
    this.pullDiagnostics =
      options.features.diagnostics === undefined
        ? null
        : new PullDiagnosticsController({
            client: this.connection.client,
            getDocument: () => {
              const active = this.sync.activeDocument
              return active ? { uri: active.uri, version: active.lspVersion } : null
            },
            publish: (document, items) =>
              this.sync.pullDiagnostics(document.uri, document.version, items),
            onRequestError: (error) => options.onRequestError?.('textDocument/diagnostic', error),
            onPendingChange: () => this.republishSummary(),
          })
    this.registration = syncOptions.controller?.register({
      getSnapshot: () => source.getSnapshot(),
      sync: this.sync,
      workspace: this.connection.workspace,
    })
    void this.connection.ready.catch(() => undefined)
  }

  /** How far the active document's diagnostics can be trusted. */
  get diagnosticsFreshness(): LanguageServerDiagnosticsFreshness {
    if (this.unavailable) return 'unavailable'
    if (this.pullDiagnostics?.pending) return this.diagnosticsReceived ? 'refreshing' : 'awaiting'
    return this.diagnosticsReceived ? 'current' : 'silent'
  }

  attach(
    presenter: DocumentLaneDiagnosticsObserver,
    onConnectionChange: () => void,
  ): EditorDisposable {
    this.observers.add(presenter)
    this.listeners.add(onConnectionChange)
    const active = this.sync.activeDocument
    if (active) {
      presenter.render(active, this.sync.diagnostics)
      presenter.publishSummary(
        active.uri,
        this.diagnosticsVersion,
        this.sync.diagnostics,
        this.diagnosticsFreshness,
      )
    }
    return {
      dispose: () => {
        this.observers.delete(presenter)
        this.listeners.delete(onConnectionChange)
      },
    }
  }

  synchronize(
    change: EditorContributionChange | null = null,
    kind: EditorViewContributionUpdateKind = 'content',
  ): void {
    if (this.disposed || !this.connection.isReady()) return
    const snapshot = this.source.getSnapshot()
    if (!this.sync.shouldSync(kind, snapshot)) return
    const before = this.sync.activeDocument
    this.sync.sync(snapshot, change)
    if (before !== this.sync.activeDocument) this.pullDiagnostics?.synchronize()
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.registration?.dispose()
    this.pullDiagnostics?.dispose()
    this.sync.close()
    this.connection.release()
    this.observers.clear()
    this.listeners.clear()
  }

  private notify(): void {
    for (const listener of this.listeners) listener()
  }

  private publishSummary(
    uri: lsp.DocumentUri,
    version: number | null,
    diagnostics: readonly lsp.Diagnostic[],
  ): void {
    if (this.disposed) return
    const freshness = this.diagnosticsFreshness
    this.options.onDiagnostics?.(summarizeDiagnostics(uri, version, diagnostics, freshness))
    for (const observer of this.observers)
      observer.publishSummary(uri, version, diagnostics, freshness)
  }

  /** The diagnostics did not change, but how far they can be trusted did. */
  private republishSummary(): void {
    const active = this.sync?.activeDocument
    if (!active) return
    this.publishSummary(active.uri, this.diagnosticsVersion, this.sync.diagnostics)
  }
}
