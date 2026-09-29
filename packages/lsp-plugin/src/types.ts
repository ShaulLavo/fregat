import type { TooltipAction } from '@singapore-editor/plugin-ui/tooltip'
import type { LanguageServerDocument } from './document'
import type { DocumentLogicalRevisionScope } from '@singapore-editor/core/document'
import type {
  EditorDisposable,
  EditorPlugin,
  EditorTextAnchor,
  EditorViewSnapshot,
} from '@singapore-editor/core/extensions'
import type {
  LspClient,
  LspNotificationHandler,
  LspServerRequestHandler,
  LspWebSocketTransportOptions,
} from '@singapore-editor/lsp'
import type * as lsp from 'vscode-languageserver-protocol'

import type { LanguageServerConnectionContext } from './connectionContext'
import type { LanguageServerDocumentSyncController } from './documentSyncController'
import type { LspConnectionProvider, LspReconnectOptions } from './lspConnection'
import type { ParsedWorkspaceEdit } from './workspaceEdit'
import type { WorkspaceTextDocumentProvenance } from './workspaceTextEdits'
export type { LanguageServerConnectionContext } from './connectionContext'
import type {
  LanguageServerSemanticTokensFactory,
  LanguageServerSemanticTokensOptions,
} from './semanticTokens'

export type LanguageServerStatus = 'idle' | 'loading' | 'ready' | 'error'

export const LANGUAGE_SERVER_FEATURE_IDS = [
  'completion',
  'hover',
  'navigation',
  'signatureHelp',
  'diagnostics',
  'codeActions',
  'formatting',
  'rename',
  'documentHighlights',
  'semanticTokens',
] as const

export type LanguageServerFeatureId = (typeof LANGUAGE_SERVER_FEATURE_IDS)[number]

export type LanguageServerFeatureRanks = Partial<Readonly<Record<LanguageServerFeatureId, number>>>

export type LanguageServerReadyNotification = {
  readonly method: string
  readonly params: unknown
}

export type LanguageServerDiagnosticCounts = {
  readonly error: number
  readonly warning: number
  readonly information: number
  readonly hint: number
  readonly total: number
}

/**
 * How far a summary's diagnostics can be trusted, so an empty list is never mistaken for a clean
 * file. `awaiting`: a first result is being asked for. `refreshing`: a result is shown and a newer
 * one is being asked for. `current`: nothing is pending. `silent`: the server has said nothing and
 * nothing is pending — a push-only server may never publish, so this never waits. `unavailable`:
 * the connection is gone and what was shown was cleared.
 */
export type LanguageServerDiagnosticsFreshness =
  | 'awaiting'
  | 'refreshing'
  | 'current'
  | 'silent'
  | 'unavailable'

export type LanguageServerDiagnosticSummary = {
  readonly uri: lsp.DocumentUri | null
  readonly version: number | null
  readonly diagnostics: readonly lsp.Diagnostic[]
  readonly counts: LanguageServerDiagnosticCounts
  readonly freshness: LanguageServerDiagnosticsFreshness
}

export type LanguageServerDiagnosticMarkerEvent = {
  readonly direction: 'next' | 'previous'
  readonly diagnostic: lsp.Diagnostic
  readonly documentUri: lsp.DocumentUri
  readonly textVersion: number
  readonly anchor: EditorTextAnchor
}

export type LanguageServerDiagnosticMarkerClaim =
  | { readonly kind: 'claimed'; dispose(): void }
  | { readonly kind: 'ignored' }

export type LanguageServerDefinitionTarget = {
  readonly uri: lsp.DocumentUri
  readonly path: string
  readonly range: lsp.Range
}

export type LanguageServerNavigationKind =
  | 'definition'
  | 'references'
  | 'implementation'
  | 'typeDefinition'

export type LanguageServerNavigationOpenMode = 'default' | 'peek' | 'aside'

export type LanguageServerNavigationOptions = {
  readonly kind: LanguageServerNavigationKind
  readonly openMode: LanguageServerNavigationOpenMode
}

export type LanguageServerReferencesResult = {
  readonly uri: lsp.DocumentUri
  readonly targets: readonly LanguageServerDefinitionTarget[]
}

export type LanguageServerDocumentSnapshot = Pick<
  EditorViewSnapshot,
  | 'documentId'
  | 'languageId'
  | 'textSnapshot'
  | 'textVersion'
  | 'documentSyncPoint'
  | 'changesSinceDocumentSyncPoint'
  | 'lineStarts'
  | 'lineStartsView'
>

export type LanguageServerDocumentSyncOptions = {
  /** Projects a live path transition before deferred view publication catches up. */
  readonly controller?: LanguageServerDocumentSyncController
  /** Resolves opaque editor identities to protocol URIs. Returning null disables synchronization. */
  uriForDocument?(snapshot: LanguageServerDocumentSnapshot): lsp.DocumentUri | null
  /**
   * The language id sent to the server when the editor and protocol use different names.
   * Returning undefined keeps the editor's id.
   */
  languageIdForDocument?(languageId: string, uri: lsp.DocumentUri): string | undefined
  shouldSyncLanguageId?(languageId: string, snapshot: LanguageServerDocumentSnapshot): boolean
  shouldSyncUri?(uri: lsp.DocumentUri, snapshot: LanguageServerDocumentSnapshot): boolean
}

export type { WorkspaceTextDocumentProvenance } from './workspaceTextEdits'

export type WorkspaceEditOriginGuard = {
  readonly documents: readonly WorkspaceTextDocumentProvenance[]
  isCurrent(uri: string): boolean
}

export type ApplyWorkspaceEditRequest = {
  readonly guard: WorkspaceEditOriginGuard
  readonly label: string
  readonly logicalRevisionScope: DocumentLogicalRevisionScope
  readonly originUri: string
  readonly originVersion: number
  readonly plan: ParsedWorkspaceEdit
  readonly serverId: string
  readonly signal: AbortSignal
  readonly source: 'code-action' | 'rename'
}

export type ApplyWorkspaceEditResult =
  | { readonly status: 'applied' }
  | { readonly status: 'cancelled' }
  | { readonly code: string; readonly message: string; readonly status: 'failed' }
  | { readonly code: string; readonly message: string; readonly status: 'rolled-back' }
  | {
      readonly affectedPaths: readonly string[]
      readonly code: string
      readonly message: string
      readonly status: 'recovery-required'
    }

export type OnApplyWorkspaceEdit = (
  request: ApplyWorkspaceEditRequest,
) => Promise<ApplyWorkspaceEditResult>

export type LanguageServerLaneHostOptions = {
  readonly onApplyWorkspaceEdit?: OnApplyWorkspaceEdit
}

export type LanguageServerRenamePrompt = {
  readonly anchor: DOMRect
  readonly currentName: string
  readonly signal: AbortSignal
}

export type LanguageServerDiagnosticActionContext = {
  readonly documentUri: lsp.DocumentUri
  readonly textVersion: number
  readonly diagnostic: lsp.Diagnostic
}

export type LanguageServerDiagnosticActions = (
  context: LanguageServerDiagnosticActionContext,
) => readonly TooltipAction[]

export type LanguageServerPluginOptions = LanguageServerLaneHostOptions & {
  readonly rootUri?: lsp.DocumentUri | null
  readonly initializationOptions?: unknown
  readonly timeoutMs?: number
  /**
   * Merged over `defaultClientCapabilities()`, so a host declares only what it adds. Build a
   * semantic-tokens block with `semanticTokensClientCapability()` from `@singapore-editor/lsp` rather than
   * by hand: it refuses the flags this editor cannot honour, each of which a real server acts on.
   */
  readonly capabilities?: lsp.ClientCapabilities
  /** At least one real server branches on this. The value is the host's to pick. */
  readonly clientInfo?: lsp.InitializeParams['clientInfo']
  /**
   * Merged around the plugin's own handlers. An entry for `textDocument/publishDiagnostics` runs
   * after the plugin's and cannot displace it, because the diagnostics feature hangs off it.
   */
  readonly notificationHandlers?: Readonly<Record<string, LspNotificationHandler<LspClient>>>
  /**
   * Answers requests the server sends the client, such as a server asking the host for files.
   * A method the plugin answers itself (`workspace/diagnostic/refresh`) stays the plugin's.
   */
  readonly serverRequestHandlers?: Readonly<Record<string, LspServerRequestHandler<LspClient>>>
  /** Which documents reach the server, and under what language id. */
  readonly documentSync?: LanguageServerDocumentSyncOptions
  readonly webSocketRoute: string | URL
  readonly webSocketTransportOptions?: LspWebSocketTransportOptions
  /**
   * Borrows the connection rather than owning one per view, so a file switch that rebuilds the view
   * does not also rebuild the websocket and re-run `initialize`. The route and options above still
   * describe the connection — the provider is handed them and builds from them the first time it
   * sees a key. See `LspConnectionProvider`.
   */
  readonly connectionProvider?: LspConnectionProvider
  /**
   * Turns on the semantic token layer, and is how the host gets hold of one: a layer needs a
   * viewport, a snapshot and a lifecycle, so the contribution creates it and hands it over through
   * `onLayer`. Supplying nothing creates no layer and fires no demand signal.
   */
  readonly semanticTokens?: LanguageServerSemanticTokensOptions
  /**
   * Hands the host the connection the moment it exists, which is the only way to reach the
   * `LspClient` — and therefore the only way to issue a request, override the timeout for one, or
   * cancel one. Returning a disposable ties the host's own controller to the connection's life.
   */
  onConnectionCreated?(context: LanguageServerConnectionContext): EditorDisposable | void
  /** The same context again, once `initialize` has come back and server capabilities are known. */
  onConnected?(context: LanguageServerConnectionContext): void
  readonly onStatusChange?: (status: LanguageServerStatus) => void
  readonly onDiagnostics?: (summary: LanguageServerDiagnosticSummary) => void
  readonly getDiagnosticActions?: LanguageServerDiagnosticActions
  readonly onDidNavigateDiagnostic?: (
    event: LanguageServerDiagnosticMarkerEvent,
  ) => LanguageServerDiagnosticMarkerClaim
  readonly onInteractiveReady?: () => void
  readonly onRequestError?: (serverId: string, method: string, error: unknown) => void
  /** Reports the selected destination when Ctrl/Cmd-hover renders a jumpable link. */
  readonly onDefinitionLinkHover?: (target: LanguageServerDefinitionTarget) => void
  readonly onOpenDefinition?: (
    target: LanguageServerDefinitionTarget,
    options?: LanguageServerNavigationOptions,
  ) => void | boolean
  readonly onOpenReferences?: (result: LanguageServerReferencesResult) => void | boolean
  readonly onError?: (error: unknown) => void
}

export type LanguageServerLaneOptions = LanguageServerLaneHostOptions & {
  readonly id: string
  readonly features: LanguageServerFeatureRanks
  readonly rootUri?: lsp.DocumentUri | null
  readonly initializationOptions?: unknown
  readonly timeoutMs?: number
  readonly capabilities?: lsp.ClientCapabilities
  readonly clientInfo?: lsp.InitializeParams['clientInfo']
  readonly notificationHandlers?: Readonly<Record<string, LspNotificationHandler<LspClient>>>
  readonly serverRequestHandlers?: Readonly<Record<string, LspServerRequestHandler<LspClient>>>
  readonly webSocketRoute: string | URL
  readonly webSocketTransportOptions?: LspWebSocketTransportOptions
  readonly connectionProvider?: LspConnectionProvider
  /** Reconnects after the server goes away on its own; off unless given. */
  readonly reconnect?: LspReconnectOptions
  readonly readyNotifications?: readonly LanguageServerReadyNotification[]
  onConnectionCreated?(context: LanguageServerConnectionContext): EditorDisposable | void
  onConnected?(context: LanguageServerConnectionContext): void
  readonly onStatusChange?: (status: LanguageServerStatus) => void
  readonly onDiagnostics?: (summary: LanguageServerDiagnosticSummary) => void
  readonly onInteractiveReady?: () => void
  readonly onRequestError?: (method: string, error: unknown) => void
  readonly onError?: (error: unknown) => void
}

export type LanguageServerSetPluginOptions = Pick<
  LanguageServerPluginOptions,
  | 'onDiagnostics'
  | 'onDidNavigateDiagnostic'
  | 'getDiagnosticActions'
  | 'onInteractiveReady'
  | 'onRequestError'
  | 'onDefinitionLinkHover'
  | 'onOpenDefinition'
  | 'onOpenReferences'
  | 'onError'
> & {
  readonly semanticTokens?: LanguageServerSemanticTokensFactory
} & (
    | {
        readonly lanes: readonly LanguageServerLaneOptions[]
        readonly document?: never
        readonly documentSync?: LanguageServerDocumentSyncOptions
        readonly onApplyWorkspaceEdit?: OnApplyWorkspaceEdit
      }
    | {
        readonly document: LanguageServerDocument
        readonly lanes?: never
        readonly documentSync?: never
        readonly onApplyWorkspaceEdit?: never
      }
  )

export type LanguageServerDocumentPluginOptions = Omit<
  Extract<LanguageServerSetPluginOptions, { readonly document: LanguageServerDocument }>,
  'lanes' | 'document'
> & {
  readonly document: LanguageServerDocument
  readonly webSocketRoute?: never
}

export type LanguageServerPlugin = EditorPlugin
