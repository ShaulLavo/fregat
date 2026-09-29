import type {
  LspLineStarts,
  LspTextSnapshot,
  LspWebSocketTransportOptions,
} from '@singapore-editor/lsp'
import type * as lsp from 'vscode-languageserver-protocol'

import type {
  LanguageServerDefinitionTarget,
  LanguageServerDiagnosticMarkerClaim,
  LanguageServerDiagnosticMarkerEvent,
  LanguageServerDiagnosticSummary,
  LanguageServerNavigationKind,
  LanguageServerNavigationOpenMode,
  LanguageServerNavigationOptions,
  LanguageServerReferencesResult,
  LanguageServerStatus,
  OnApplyWorkspaceEdit,
} from './types'

export type LanguageServerResolvedOptions = {
  readonly rootUri: lsp.DocumentUri | null
  readonly initializationOptions: unknown
  readonly timeoutMs: number
  readonly webSocketRoute: string | URL
  readonly webSocketTransportOptions?: LspWebSocketTransportOptions
  readonly onStatusChange?: (status: LanguageServerStatus) => void
  readonly onDiagnostics?: (summary: LanguageServerDiagnosticSummary) => void
  readonly onDidNavigateDiagnostic?: (
    event: LanguageServerDiagnosticMarkerEvent,
  ) => LanguageServerDiagnosticMarkerClaim
  readonly onInteractiveReady?: () => void
  readonly onApplyWorkspaceEdit?: OnApplyWorkspaceEdit
  readonly onDefinitionLinkHover?: (target: LanguageServerDefinitionTarget) => void
  readonly onOpenDefinition?: (
    target: LanguageServerDefinitionTarget,
    options?: LanguageServerNavigationOptions,
  ) => void | boolean
  readonly onOpenReferences?: (result: LanguageServerReferencesResult) => void | boolean
  readonly onError?: (error: unknown) => void
}

export type LanguageServerNavigationCommand = {
  readonly kind: LanguageServerNavigationKind
  readonly openMode: LanguageServerNavigationOpenMode
  readonly includeDeclaration?: boolean
}

export type DiagnosticMarkerDirection = 'next' | 'previous'

export type ActiveDocument = {
  readonly uri: lsp.DocumentUri
  readonly languageId: string
  readonly textSnapshot: LspTextSnapshot
  readonly lineStarts: LspLineStarts
  readonly textVersion: number
  readonly lspVersion: number
}

export type DocumentDescriptor = {
  readonly uri: lsp.DocumentUri
  readonly languageId: string
  readonly textSnapshot: LspTextSnapshot
  readonly lineStarts: LspLineStarts
  readonly textVersion: number
}
