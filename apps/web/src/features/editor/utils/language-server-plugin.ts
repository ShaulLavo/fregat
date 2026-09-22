import { languageIdForFilePath } from '@/features/editor/utils/file-path'
import type { EditorTextBuffer } from '@singapore-editor/core/document'
import { createLanguageServerDocument } from '@singapore-editor/lsp-plugin'
import { createEditorLanguageServerStatusSource } from '@/features/editor/state/language-server-status-source'
import type { LanguageServerDocuments } from '@/features/editor/state/language-server-documents'
import { fileUriForPath } from '@/lib/file-uri'
import type { LanguageServerDocumentSyncController } from '@singapore-editor/lsp-plugin/document-sync-controller'
import type {
  LanguageServerDefinitionTarget,
  LanguageServerLaneOptions,
  LanguageServerPlugin,
} from '@singapore-editor/lsp-plugin/websocket'
import type {
  LanguageServerDiagnosticMarkerClaim,
  LanguageServerDiagnosticMarkerEvent,
  LanguageServerFeatureRanks,
  LanguageServerReferencesResult,
  LanguageServerSemanticTokensFactory,
  LspConnectionProvider,
  OnApplyWorkspaceEdit,
} from '@singapore-editor/lsp-plugin'
import { createLanguageServerSetPlugin } from '@singapore-editor/lsp-plugin/websocket'
import {
  LSP_FEATURE_IDS,
  LSP_SEMANTIC_TOKENS_REFRESH,
  LSP_SERVER_EXITED,
  type LspFeatureId,
  type LspMatch,
} from '@workspace/contracts'

import { languageServerConnectionProvider } from '@/features/editor/state/language-server-connection-pool'
import type { EditorLanguageServerStatusSource } from '@/features/editor/state/language-server-status-source'
import { lspLanguageIdForPath } from '@/features/editor/utils/lsp-language-id'
import { SemanticTokenController } from '@/features/editor/state/semantic-token-controller'
import {
  LANGUAGE_SERVER_CLIENT_INFO,
  LANGUAGE_SERVER_REQUEST_TIMEOUT_MS,
  clientCapabilitiesForServer,
} from '@/lib/language-server-capabilities'
import { languageServerWebSocketConstructor } from '@/lib/server-sockets'
import { environmentClientFor } from '@/lib/client'
import { environmentActivitySignal } from '@/lib/environments/state/activity'
import { markerStore } from '@/lib/markers/store'
import { log } from '@/lib/client-logging'
import type { LanguageServerDocument } from '@/lib/language-server-document'

export type LanguageServerMatch = LspMatch

export type LanguageServerDocumentTarget = {
  readonly matchPath: string
  readonly disabledFeatures?: readonly LspFeatureId[]
  readonly sharedNotificationsByServer?: Readonly<
    Record<string, readonly { method: string; params: unknown }[]>
  >
}

type MatchedLanguageServerPluginOptions = {
  document: LanguageServerDocument | null
  configurationGeneration?: number
  documents?: LanguageServerDocuments
  buffer?: EditorTextBuffer | null
  origin: string
  documentSyncController: LanguageServerDocumentSyncController
  enabled: boolean
  matches: readonly LanguageServerMatch[] | null
  rootPath: string
  statusSource: EditorLanguageServerStatusSource
  target: LanguageServerDocumentTarget
  onApplyWorkspaceEdit: OnApplyWorkspaceEdit
  onDefinitionLinkHover?: (target: LanguageServerDefinitionTarget) => void
  onOpenDefinition?: (target: LanguageServerDefinitionTarget) => void | boolean
  onOpenReferences?: (result: LanguageServerReferencesResult) => void | boolean
  onDidNavigateDiagnostic?: (
    event: LanguageServerDiagnosticMarkerEvent,
  ) => LanguageServerDiagnosticMarkerClaim
}

export function createMatchedLanguageServerPlugin({
  document,
  documents,
  configurationGeneration = 0,
  buffer,
  origin,
  documentSyncController,
  enabled,
  matches,
  rootPath,
  statusSource,
  target,
  onApplyWorkspaceEdit,
  onDefinitionLinkHover,
  onOpenDefinition,
  onOpenReferences,
  onDidNavigateDiagnostic,
}: MatchedLanguageServerPluginOptions): LanguageServerPlugin {
  const eligible = enabled ? (matches ?? []) : []
  if (eligible.length === 0 || document === null)
    return createIdleLanguageServerPlugin(statusSource, () => {
      documents?.configure(configurationGeneration)
      if (document && matches !== null) documents?.delete(document.key)
    })

  const descriptors = eligible.map((match) => ({
    ...match,
    features: withoutDisabledFeatures(match.features, target.disabledFeatures),
  }))
  return {
    name: 'editor.language-server',
    activate: (context) => {
      documents?.configure(configurationGeneration)
      const configuration = JSON.stringify([origin, rootPath, document.uri, descriptors, target])
      const entry =
        buffer && documents
          ? documents.getOrCreate(document.key, buffer, configuration, () =>
              createDocumentEntry({
                document,
                buffer,
                origin,
                descriptors,
                onApplyWorkspaceEdit,
                rootPath,
                target,
                documentSyncController,
              }),
            )
          : null
      const semanticControllers =
        entry?.semanticControllers ?? new Map<string, Set<SemanticTokenController>>()
      statusSource.setServers(statusOrderedMatches(descriptors).map((match) => match.serverId))
      const unsubscribe = entry ? relayStatus(entry.status, statusSource) : () => undefined
      const source = entry
        ? { document: entry.document }
        : {
            onApplyWorkspaceEdit,
            lanes: descriptors.map((match) =>
              liveLanguageServerLane({
                origin,
                match,
                onApplyWorkspaceEdit,
                rootPath,
                semanticControllers,
                statusSource,
                target,
              }),
            ),
            documentSync: {
              controller: documentSyncController,
              uriForDocument: (snapshot: { readonly documentId: string | null }) =>
                snapshot.documentId === document.key ? document.uri : null,
              languageIdForDocument: (_languageId: string, uri: string) =>
                lspLanguageIdForPath(uri),
            },
          }
      const plugin = createLanguageServerSetPlugin({
        ...source,
        semanticTokens: descriptors.some((match) => match.features.semanticTokens !== undefined)
          ? semanticTokenOwnerFactory(semanticControllers, document)
          : undefined,
        onDefinitionLinkHover,
        onOpenDefinition,
        onOpenReferences,
        onDidNavigateDiagnostic,
      })
      return [...pluginDisposables(plugin.activate(context)), { dispose: unsubscribe }]
    },
  }
}

function createDocumentEntry({
  document,
  buffer,
  origin,
  descriptors,
  onApplyWorkspaceEdit,
  rootPath,
  target,
  documentSyncController,
}: {
  document: LanguageServerDocument
  buffer: EditorTextBuffer
  origin: string
  descriptors: readonly LanguageServerMatch[]
  onApplyWorkspaceEdit: OnApplyWorkspaceEdit
  rootPath: string
  target: LanguageServerDocumentTarget
  documentSyncController: LanguageServerDocumentSyncController
}) {
  const status = createEditorLanguageServerStatusSource()
  status.setServers(statusOrderedMatches(descriptors).map((match) => match.serverId))
  const semanticControllers = new Map<string, Set<SemanticTokenController>>()
  return {
    document: createLanguageServerDocument({
      buffer,
      documentId: document.key,
      uri: document.uri,
      languageId:
        lspLanguageIdForPath(document.uri) ??
        languageIdForFilePath(target.matchPath) ??
        'plaintext',
      controller: documentSyncController,
      onApplyWorkspaceEdit,
      lanes: descriptors.map((match) =>
        liveLanguageServerLane({
          origin,
          match,
          onApplyWorkspaceEdit,
          rootPath,
          semanticControllers,
          statusSource: status,
          target,
        }),
      ),
    }),
    status,
    semanticControllers,
  }
}

function liveLanguageServerLane({
  origin,
  match,
  onApplyWorkspaceEdit,
  rootPath,
  semanticControllers,
  statusSource,
  target,
}: {
  match: LanguageServerMatch
  onApplyWorkspaceEdit: OnApplyWorkspaceEdit
  rootPath: string
  origin: string
  semanticControllers: Map<string, Set<SemanticTokenController>>
  statusSource: EditorLanguageServerStatusSource
  target: LanguageServerDocumentTarget
}): LanguageServerLaneOptions {
  return {
    ...languageServerLaneOptions({
      origin,
      connectionProvider: languageServerConnectionProvider({
        origin,
        rootPath: match.root,
        serverId: match.serverId,
      }),
      match,
      onApplyWorkspaceEdit,
      rootPath,
      target,
    }),
    notificationHandlers: laneNotificationHandlers(
      match.serverId,
      semanticControllers,
      statusSource,
    ),
    onStatusChange: (status) => {
      // A server that stopped or failed keeps no claim on its markers.
      if (status !== 'ready') markerStore.removeOwner(match.serverId)
      statusSource.setServerStatus(match.serverId, status)
    },
    onDiagnostics: (diagnostics) => {
      // The summary names its own resource, which is how one server's markers for a file
      // it is not the active tab for still reach the panel.
      if (diagnostics.uri) {
        markerStore.changeOne(match.serverId, diagnostics.uri, diagnostics.diagnostics)
      }
      statusSource.setServerDiagnostics(match.serverId, diagnostics)
    },
    onInteractiveReady: () => statusSource.setServerInteractiveReady(match.serverId),
    onRequestError: (method, error) => {
      log.error({
        action: 'lsp.request_failed',
        area: 'lsp',
        error,
        method,
        serverId: match.serverId,
      })
    },
    onError: () => statusSource.setServerStatus(match.serverId, 'error'),
  }
}

export function languageServerLaneOptions({
  origin,
  connectionProvider,
  match,
  onApplyWorkspaceEdit,
  rootPath,
  target,
}: {
  origin: string
  connectionProvider: LspConnectionProvider
  match: LanguageServerMatch
  onApplyWorkspaceEdit: OnApplyWorkspaceEdit
  rootPath: string
  target: LanguageServerDocumentTarget
}): LanguageServerLaneOptions {
  return {
    id: match.serverId,
    features: match.features as LanguageServerFeatureRanks,
    capabilities: clientCapabilitiesForServer(match.serverId),
    clientInfo: LANGUAGE_SERVER_CLIENT_INFO,
    timeoutMs: LANGUAGE_SERVER_REQUEST_TIMEOUT_MS,
    rootUri: fileUriForPath(match.root),
    connectionProvider,
    onApplyWorkspaceEdit,
    readyNotifications: target.sharedNotificationsByServer?.[match.serverId],
    webSocketRoute: languageServerRoute(rootPath, target.matchPath, match.serverId),
    webSocketTransportOptions: {
      WebSocketCtor: languageServerWebSocketConstructor(
        environmentClientFor(origin),
        environmentActivitySignal(origin),
      ),
    },
  }
}

function laneNotificationHandlers(
  serverId: string,
  semanticControllers: ReadonlyMap<string, Set<SemanticTokenController>>,
  statusSource: EditorLanguageServerStatusSource,
) {
  return {
    [LSP_SEMANTIC_TOKENS_REFRESH]: () => {
      const semanticTokens = semanticControllers.get(serverId) ?? null
      if (semanticTokens) for (const controller of semanticTokens) controller.handleRefresh()
      return (semanticTokens?.size ?? 0) > 0
    },
    [LSP_SERVER_EXITED]: () => {
      statusSource.setServerStatus(serverId, 'error')
      return true
    },
  }
}

function semanticTokenOwnerFactory(
  controllers: Map<string, Set<SemanticTokenController>>,
  document: LanguageServerDocument,
): LanguageServerSemanticTokensFactory {
  return (owner) => {
    const listeners = controllers.get(owner.id) ?? new Set<SemanticTokenController>()
    const controller = new SemanticTokenController({ serverId: owner.id })
    listeners.add(controller)
    controllers.set(owner.id, listeners)
    controller.attachConnection(owner.connection)
    controller.handleConnected()

    return {
      ...semanticTokenLayerOptions(controller, document),
      dispose: () => {
        listeners.delete(controller)
        if (listeners.size === 0) controllers.delete(owner.id)
        controller.dispose()
      },
    }
  }
}

function semanticTokenLayerOptions(
  semanticTokens: SemanticTokenController,
  target: LanguageServerDocument,
) {
  return {
    onLayer: (
      layer: Parameters<SemanticTokenController['attachLayer']>[0],
      document: Parameters<SemanticTokenController['attachLayer']>[1],
    ) => {
      const uri = document.documentId === target.key ? target.uri : null
      semanticTokens.attachLayer(layer, document, uri)
    },
    onRangeNeeded: semanticTokens.handleRangeNeeded.bind(semanticTokens),
    onResyncRequired: semanticTokens.handleResyncRequired.bind(semanticTokens),
    scopeAliases: semanticTokens.scopeAliases,
    viewportDelayMs: 0,
  }
}

function createIdleLanguageServerPlugin(
  statusSource: EditorLanguageServerStatusSource,
  onActivate: () => void,
): LanguageServerPlugin {
  return {
    name: 'editor.language-server.idle',
    activate: () => {
      onActivate()
      statusSource.setServers([])
      return []
    },
  }
}

function rankedMatches(
  matches: readonly LanguageServerMatch[],
  feature: LspFeatureId,
): readonly LanguageServerMatch[] {
  return matches
    .filter((match) => match.features[feature] !== undefined)
    .toSorted(
      (left, right) =>
        (left.features[feature] ?? 0) - (right.features[feature] ?? 0) ||
        matches.indexOf(left) - matches.indexOf(right),
    )
}

function statusOrderedMatches(
  matches: readonly LanguageServerMatch[],
): readonly LanguageServerMatch[] {
  const diagnostics = rankedMatches(matches, 'diagnostics')
  const diagnosticIds = new Set(diagnostics.map((match) => match.serverId))
  return diagnostics.concat(matches.filter((match) => !diagnosticIds.has(match.serverId)))
}

function withoutDisabledFeatures(
  features: LanguageServerMatch['features'],
  disabled: readonly LspFeatureId[] | undefined,
): LanguageServerMatch['features'] {
  if (!disabled || disabled.length === 0) return features

  return Object.fromEntries(
    Object.entries(features).filter(([feature]) => !disabled.includes(feature as LspFeatureId)),
  )
}

function languageServerRoute(rootPath: string, matchPath: string, serverId: string) {
  // EdenLanguageServerWebSocket uses only the route parameters and dials through its client.
  const url = new URL('/lsp', 'ws://localhost')
  url.searchParams.set('root', rootPath)
  url.searchParams.set('path', matchPath)
  url.searchParams.set('server', serverId)
  return url
}

export function languageServerMatches(value: unknown): readonly LanguageServerMatch[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    const match = languageServerMatch(item)
    return match ? [match] : []
  })
}

function languageServerMatch(value: unknown): LanguageServerMatch | null {
  if (!value || typeof value !== 'object') return null

  const match = value as Record<string, unknown>
  if (typeof match.root !== 'string') return null
  if (typeof match.serverId !== 'string') return null
  const features = languageServerFeatures(match.features)
  if (!features) return null

  return { root: match.root, serverId: match.serverId, features }
}

function languageServerFeatures(value: unknown): LanguageServerMatch['features'] | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null

  const features: Partial<Record<LspFeatureId, number>> = {}
  for (const [feature, rank] of Object.entries(value)) {
    if (!LSP_FEATURE_IDS.includes(feature as LspFeatureId)) return null
    if (typeof rank !== 'number' || !Number.isInteger(rank) || rank < 0) return null
    features[feature as LspFeatureId] = rank
  }

  return features
}

function relayStatus(
  source: EditorLanguageServerStatusSource,
  target: EditorLanguageServerStatusSource,
): () => void {
  const relay = () => target.setSnapshot(source.getSnapshot())
  relay()
  return source.subscribe(relay)
}

function pluginDisposables(result: ReturnType<LanguageServerPlugin['activate']>) {
  if (!result) return []
  if ('dispose' in result) return [result]
  return result
}
