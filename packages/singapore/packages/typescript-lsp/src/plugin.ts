import { TypeScriptLspWorkspace } from './workspace'
import type { EditorDisposable } from '@singapore-editor/core/extensions'
import { createEditorCapabilityToken } from '@singapore-editor/core/extensions'
import type {
  LspClient,
  LspServerRequestHandler,
  LspWebSocketTransportOptions,
  LspWorkerLike,
} from '@singapore-editor/lsp'
import {
  createLanguageServerAdapterPlugin,
  createWebSocketLspTransportFactory,
  createWorkerLspTransportFactory,
  type LanguageServerConnectionContext,
  type LspConnectionTransportFactory,
} from '@singapore-editor/lsp-plugin'
import type { LanguageServerCompletionEditFeature } from '@singapore-editor/lsp-plugin/completion'

import { isTypeScriptLspSourceFileName } from './paths'
import { LIBRARY_FILES_REQUEST } from './worker/customMethods'
import type { TypeScriptLspPlugin, TypeScriptLspPluginOptions } from './types'

const DEFAULT_DIAGNOSTIC_DELAY_MS = 150
const DEFAULT_TIMEOUT_MS = 15000
const TYPESCRIPT_LSP_COMPLETION_EDIT_FEATURE_ID = 'editor.typescript-lsp.completion-edit'
const TYPESCRIPT_LSP_COMPLETION_EDIT_FEATURE =
  createEditorCapabilityToken<LanguageServerCompletionEditFeature>(
    TYPESCRIPT_LSP_COMPLETION_EDIT_FEATURE_ID,
  )

export type TypeScriptLspResolvedOptions = {
  readonly connectionProvider: TypeScriptLspPluginOptions['connectionProvider']
  readonly documentSync: TypeScriptLspPluginOptions['documentSync']
  readonly rootUri: string | null
  readonly canonicalPaths: TypeScriptLspPluginOptions['canonicalPaths']
  readonly compilerOptions: TypeScriptLspPluginOptions['compilerOptions']
  readonly diagnosticDelayMs: number
  readonly libraryFiles: TypeScriptLspPluginOptions['libraryFiles']
  readonly timeoutMs: number
  readonly capabilities: TypeScriptLspPluginOptions['capabilities']
  readonly clientInfo: TypeScriptLspPluginOptions['clientInfo']
  readonly semanticTokens: TypeScriptLspPluginOptions['semanticTokens']
  readonly onConnectionCreated: TypeScriptLspPluginOptions['onConnectionCreated']
  readonly workerFactory?: () => LspWorkerLike
  readonly webSocketRoute?: string | URL
  readonly webSocketTransportOptions?: LspWebSocketTransportOptions
  readonly onStatusChange: TypeScriptLspPluginOptions['onStatusChange']
  readonly onDiagnostics: TypeScriptLspPluginOptions['onDiagnostics']
  readonly onOpenDefinition: TypeScriptLspPluginOptions['onOpenDefinition']
  readonly onOpenReferences: TypeScriptLspPluginOptions['onOpenReferences']
  readonly onApplyWorkspaceEdit: TypeScriptLspPluginOptions['onApplyWorkspaceEdit']
  readonly getDiagnosticActions: TypeScriptLspPluginOptions['getDiagnosticActions']
  readonly onRequestError: TypeScriptLspPluginOptions['onRequestError']
  readonly onError: TypeScriptLspPluginOptions['onError']
}

export function createTypeScriptLspPlugin(
  options: TypeScriptLspPluginOptions = {},
): TypeScriptLspPlugin {
  const resolved = resolveOptions(options)
  const workspaceFiles = options.workspace ?? new TypeScriptLspWorkspace()
  const plugin = createLanguageServerAdapterPlugin({
    name: 'editor.typescript-lsp',
    rootUri: resolved.rootUri,
    initializationOptions: typeScriptInitializationOptions(resolved),
    serverRequestHandlers: libraryRequestHandlers(resolved.libraryFiles),
    timeoutMs: resolved.timeoutMs,
    capabilities: resolved.capabilities,
    clientInfo: resolved.clientInfo,
    semanticTokens: resolved.semanticTokens,
    createTransport: typeScriptTransportFactory(resolved),
    connectionProvider: resolved.connectionProvider,
    documentSync: {
      ...resolved.documentSync,
      languageIdForDocument: resolved.documentSync?.languageIdForDocument ?? protocolLanguageId,
      shouldSyncLanguageId: resolved.documentSync?.shouldSyncLanguageId ?? isTypeScriptLspLanguage,
      shouldSyncUri: resolved.documentSync?.shouldSyncUri ?? isTypeScriptLspSourceFileName,
    },
    diagnostics: {
      minimapSourceId: 'editor.typescript-lsp.diagnostics',
      highlightNameNamespace: 'typescript-lsp',
      markerTimingNamePrefix: 'typescriptLsp.marker',
    },
    completion: {
      editFeature: TYPESCRIPT_LSP_COMPLETION_EDIT_FEATURE,
      acceptTimingName: 'typescriptLsp.completion.accept',
      widgetClassNamespace: 'typescript-lsp',
      // The worker sends TypeScript's own per-item sets, so the sets this turns on are the ones the
      // language service vouches for rather than a guess made in the editor.
      acceptOnCommitCharacter: true,
    },
    hoverDefinition: {
      linkHighlightNameNamespace: 'typescript-lsp',
      tooltipClassNamespace: 'typescript-lsp',
      navigationTimingNamePrefix: 'typescriptLsp',
    },
    onConnectionCreated: (context) =>
      registerTypeScriptConnection(context, workspaceFiles, resolved),
    onConnected: (context) => workspaceFiles.syncClient(context.client),
    onStatusChange: resolved.onStatusChange,
    onDiagnostics: resolved.onDiagnostics,
    onOpenDefinition: resolved.onOpenDefinition,
    onOpenReferences: resolved.onOpenReferences,
    getDiagnosticActions: resolved.getDiagnosticActions,
    onApplyWorkspaceEdit: resolved.onApplyWorkspaceEdit,
    onRequestError: (_serverId, method, error) => resolved.onRequestError?.(method, error),
    onError: resolved.onError,
  })

  return {
    ...plugin,
    setWorkspaceFiles: (files) => workspaceFiles.setWorkspaceFiles(files),
    upsertWorkspaceFiles: (files) => workspaceFiles.upsertWorkspaceFiles(files),
    deleteWorkspaceFiles: (paths) => workspaceFiles.deleteWorkspaceFiles(paths),
    clearWorkspaceFiles: () => workspaceFiles.setWorkspaceFiles([]),
  }
}

// The host's callback runs alongside the workspace-file registration rather than instead of it: the
// handle it is being given is the only way to reach the `LspClient`, and taking the workspace sync
// away as the price of holding it would be a trade nobody asked for.
function registerTypeScriptConnection(
  context: LanguageServerConnectionContext,
  workspaceFiles: TypeScriptLspWorkspace,
  options: TypeScriptLspResolvedOptions,
): EditorDisposable {
  const registration = workspaceFiles.registerClient(context.client, options.onError)
  const hostRegistration = options.onConnectionCreated?.(context) ?? null

  return {
    dispose: () => {
      hostRegistration?.dispose()
      registration.dispose()
    },
  }
}

function typeScriptTransportFactory(
  options: TypeScriptLspResolvedOptions,
): LspConnectionTransportFactory {
  if (options.webSocketRoute) {
    return createWebSocketLspTransportFactory(
      options.webSocketRoute,
      options.webSocketTransportOptions,
    )
  }
  if (options.workerFactory) return createWorkerLspTransportFactory(options.workerFactory)

  return missingWorkerTransportFactory
}

function missingWorkerTransportFactory(): never {
  throw new Error('TypeScript LSP worker factory was not configured')
}

function typeScriptInitializationOptions(options: TypeScriptLspResolvedOptions): unknown {
  return {
    canonicalPaths: options.canonicalPaths,
    compilerOptions: options.compilerOptions,
    diagnosticDelayMs: options.diagnosticDelayMs,
    libraryFiles: librarySource(options.libraryFiles),
  }
}

function librarySource(libraryFiles: TypeScriptLspPluginOptions['libraryFiles']): string {
  if (typeof libraryFiles === 'function') return 'host'
  return libraryFiles ?? 'bundled'
}

/** A host loader answers the worker's request for library files by name. */
function libraryRequestHandlers(
  libraryFiles: TypeScriptLspPluginOptions['libraryFiles'],
): Readonly<Record<string, LspServerRequestHandler<LspClient>>> {
  if (typeof libraryFiles !== 'function') return {}
  return {
    [LIBRARY_FILES_REQUEST]: async (_client, params) => ({
      files: await libraryFiles(libraryNames(params)),
    }),
  }
}

function libraryNames(params: unknown): readonly string[] {
  if (typeof params !== 'object' || params === null || !('names' in params)) return []
  const names = params.names
  return Array.isArray(names) ? names.filter((name) => typeof name === 'string') : []
}

function resolveOptions(options: TypeScriptLspPluginOptions): TypeScriptLspResolvedOptions {
  return {
    documentSync: options.documentSync,
    connectionProvider: options.connectionProvider,
    rootUri: options.rootUri ?? 'file:///',
    canonicalPaths: options.canonicalPaths,
    compilerOptions: options.compilerOptions,
    diagnosticDelayMs: options.diagnosticDelayMs ?? DEFAULT_DIAGNOSTIC_DELAY_MS,
    libraryFiles: options.libraryFiles,
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    capabilities: options.capabilities,
    clientInfo: options.clientInfo,
    semanticTokens: options.semanticTokens,
    onConnectionCreated: options.onConnectionCreated,
    workerFactory: options.workerFactory,
    webSocketRoute: options.webSocketRoute,
    webSocketTransportOptions: options.webSocketTransportOptions,
    onStatusChange: options.onStatusChange,
    onDiagnostics: options.onDiagnostics,
    onOpenDefinition: options.onOpenDefinition,
    onOpenReferences: options.onOpenReferences,
    getDiagnosticActions: options.getDiagnosticActions,
    onApplyWorkspaceEdit: options.onApplyWorkspaceEdit,
    onRequestError: options.onRequestError,
    onError: options.onError,
  }
}

function isTypeScriptLspLanguage(languageId: string): boolean {
  return (
    languageId === 'tsx' ||
    languageId === 'jsx' ||
    languageId === 'javascript' ||
    languageId === 'javascriptreact' ||
    languageId === 'typescript' ||
    languageId === 'typescriptreact'
  )
}

function protocolLanguageId(languageId: string): string {
  if (languageId === 'tsx') return 'typescriptreact'
  if (languageId === 'jsx') return 'javascriptreact'
  return languageId
}
