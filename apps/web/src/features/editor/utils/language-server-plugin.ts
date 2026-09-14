import type {
  LanguageServerDefinitionTarget,
  LanguageServerDiagnosticMarkerClaim,
  LanguageServerDiagnosticMarkerEvent,
  LanguageServerDocumentSyncController,
  LanguageServerFeatureRanks,
  LanguageServerLaneOptions,
  LanguageServerPlugin,
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
    return createIdleLanguageServerPlugin(statusSource)

  const descriptors = eligible.map((match) => ({
    ...match,
    features: withoutDisabledFeatures(match.features, target.disabledFeatures),
  }))
  const semanticControllers = new Map<string, SemanticTokenController>()
  const lanes = descriptors.map((match) =>
    liveLanguageServerLane({
      origin,
      match,
      onApplyWorkspaceEdit,
      rootPath,
      semanticControllers,
      statusSource,
      target,
    }),
  )
  const plugin = createLanguageServerSetPlugin({
    lanes,
    documentSync: {
      controller: documentSyncController,
      uriForDocument: (snapshot) => (snapshot.documentId === document.key ? document.uri : null),
      languageIdForDocument: (_languageId, uri) => lspLanguageIdForPath(uri),
    },
    semanticTokens: descriptors.some((match) => match.features.semanticTokens !== undefined)
      ? semanticTokenOwnerFactory(semanticControllers, document)
      : undefined,
    onApplyWorkspaceEdit,
    onDefinitionLinkHover,
    onOpenDefinition,
    onOpenReferences,
    onDidNavigateDiagnostic,
  })

  return initializeStatusOnActivation(plugin, statusSource, descriptors)
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
  semanticControllers: Map<string, SemanticTokenController>
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
    onStatusChange: (status) => statusSource.setServerStatus(match.serverId, status),
    onDiagnostics: (diagnostics) => statusSource.setServerDiagnostics(match.serverId, diagnostics),
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
  semanticControllers: ReadonlyMap<string, SemanticTokenController>,
  statusSource: EditorLanguageServerStatusSource,
) {
  return {
    [LSP_SEMANTIC_TOKENS_REFRESH]: () => {
      const semanticTokens = semanticControllers.get(serverId) ?? null
      semanticTokens?.handleRefresh()
      return semanticTokens !== null
    },
    [LSP_SERVER_EXITED]: () => {
      statusSource.setServerStatus(serverId, 'error')
      return true
    },
  }
}

function semanticTokenOwnerFactory(
  controllers: Map<string, SemanticTokenController>,
  document: LanguageServerDocument,
): LanguageServerSemanticTokensFactory {
  return (owner) => {
    controllers.get(owner.id)?.dispose()
    const controller = new SemanticTokenController({ serverId: owner.id })
    controllers.set(owner.id, controller)
    controller.attachConnection(owner.connection)
    controller.handleConnected()

    return {
      ...semanticTokenLayerOptions(controller, document),
      dispose: () => {
        if (controllers.get(owner.id) === controller) controllers.delete(owner.id)
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

function initializeStatusOnActivation(
  plugin: LanguageServerPlugin,
  statusSource: EditorLanguageServerStatusSource,
  matches: readonly LanguageServerMatch[],
): LanguageServerPlugin {
  return {
    name: plugin.name,
    activate: (context) => {
      statusSource.setServers(statusOrderedMatches(matches).map((match) => match.serverId))
      return plugin.activate(context)
    },
  }
}

function createIdleLanguageServerPlugin(
  statusSource: EditorLanguageServerStatusSource,
): LanguageServerPlugin {
  return {
    name: 'editor.language-server.idle',
    activate: () => {
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

function fileUriForPath(path: string) {
  const normalized = path.replace(/^\/+/, '')
  return `file:///${normalized.split('/').map(encodeURIComponent).join('/')}`
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
