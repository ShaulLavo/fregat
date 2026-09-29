import type { TypeScriptLspWorkspace, TypeScriptLspSourceFile } from './workspace'
export type { TypeScriptLspSourceFile } from './workspace'
import type { EditorDisposable, EditorPlugin } from '@singapore-editor/core/extensions'
import type { LspWebSocketTransportOptions, LspWorkerLike } from '@singapore-editor/lsp'
import type {
  LanguageServerConnectionContext,
  LspConnectionProvider,
  LanguageServerDiagnosticActions,
  LanguageServerDocumentSyncOptions,
  LanguageServerDefinitionTarget,
  LanguageServerDiagnosticCounts,
  LanguageServerDiagnosticSummary,
  LanguageServerNavigationKind,
  LanguageServerNavigationOpenMode,
  LanguageServerNavigationOptions,
  LanguageServerReferencesResult,
  LanguageServerSemanticTokensOptions,
  LanguageServerStatus,
  OnApplyWorkspaceEdit,
} from '@singapore-editor/lsp-plugin'
import type ts from 'typescript'
import type * as lsp from 'vscode-languageserver-protocol'

/**
 * Where the worker's standard library comes from. `bundled`, the default, ships with this package
 * and needs no network; `cdn` fetches TypeScript's playground copy; `host` asks the plugin's
 * `libraryFiles` loader.
 */
export type TypeScriptLspLibrarySource = 'bundled' | 'cdn' | 'host'

/** Reads library files by name (`lib.es5.d.ts`); a name left out of the answer does not exist. */
export type TypeScriptLspLibraryLoader = (
  names: readonly string[],
) => Promise<Readonly<Record<string, string>>>

export type TypeScriptLspStatus = LanguageServerStatus

export type TypeScriptLspDiagnosticCounts = LanguageServerDiagnosticCounts

export type TypeScriptLspDiagnosticSummary = LanguageServerDiagnosticSummary

export type TypeScriptLspDefinitionTarget = LanguageServerDefinitionTarget

export type TypeScriptLspNavigationKind = LanguageServerNavigationKind

export type TypeScriptLspNavigationOpenMode = LanguageServerNavigationOpenMode

export type TypeScriptLspNavigationOptions = LanguageServerNavigationOptions

export type TypeScriptLspReferencesResult = LanguageServerReferencesResult

export type TypeScriptLspPluginOptions = {
  readonly workspace?: TypeScriptLspWorkspace
  readonly connectionProvider?: LspConnectionProvider
  readonly documentSync?: LanguageServerDocumentSyncOptions
  readonly rootUri?: lsp.DocumentUri | null
  /** Logical filesystem names mapped to their canonical source identity. */
  readonly canonicalPaths?: Readonly<Record<string, string>>
  readonly compilerOptions?: ts.CompilerOptions
  readonly diagnosticDelayMs?: number
  /** The standard library: bundled with this package unless the host opts into the CDN or its own. */
  readonly libraryFiles?: 'bundled' | 'cdn' | TypeScriptLspLibraryLoader
  readonly timeoutMs?: number
  /**
   * Merged over `defaultClientCapabilities()`. Build a semantic-tokens block with
   * `semanticTokensClientCapability()` from `@singapore-editor/lsp` rather than by hand — the worker
   * advertises `semanticTokensProvider`, but a server only answers a client that asked.
   */
  readonly capabilities?: lsp.ClientCapabilities
  readonly clientInfo?: lsp.InitializeParams['clientInfo']
  /**
   * Turns on the semantic token layer and is how a host gets hold of one. Supplying nothing creates
   * no layer and fires no demand signal, so an app that paints no semantic colour pays nothing.
   */
  readonly semanticTokens?: LanguageServerSemanticTokensOptions
  /**
   * Hands the host the connection the moment it exists, which is the only way to reach the
   * `LspClient` — and therefore to issue a token request, cancel one, or override its timeout. Runs
   * alongside this plugin's own registration rather than replacing it.
   */
  onConnectionCreated?(context: LanguageServerConnectionContext): EditorDisposable | void
  readonly workerFactory?: () => LspWorkerLike
  readonly webSocketRoute?: string | URL
  readonly webSocketTransportOptions?: LspWebSocketTransportOptions
  readonly onStatusChange?: (status: TypeScriptLspStatus) => void
  readonly onDiagnostics?: (summary: TypeScriptLspDiagnosticSummary) => void
  readonly onOpenDefinition?: (
    target: TypeScriptLspDefinitionTarget,
    options?: TypeScriptLspNavigationOptions,
  ) => void | boolean
  readonly onOpenReferences?: (result: TypeScriptLspReferencesResult) => void | boolean
  /**
   * Applies rename and code-action edits. Without it, an edit that spans files cannot land and
   * reports that instead.
   */
  readonly onApplyWorkspaceEdit?: OnApplyWorkspaceEdit
  readonly getDiagnosticActions?: LanguageServerDiagnosticActions
  readonly onRequestError?: (method: string, error: unknown) => void
  readonly onError?: (error: unknown) => void
}

export type TypeScriptLspPlugin = EditorPlugin & {
  /** Replaces every workspace file; the worker rebuilds its program from them. */
  setWorkspaceFiles(files: readonly TypeScriptLspSourceFile[]): void
  /** Adds or changes files in place; only a tsconfig or package.json rebuilds the program. */
  upsertWorkspaceFiles(files: readonly TypeScriptLspSourceFile[]): void
  deleteWorkspaceFiles(paths: readonly string[]): void
  clearWorkspaceFiles(): void
}
