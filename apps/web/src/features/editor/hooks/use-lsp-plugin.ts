import { useSettingValue } from '@/hooks/use-setting-value'
import {
  withTypeScriptWorker,
  withWorkerStatus,
} from '@/features/editor/state/typescript-worker-plugin'
import { useLanguageServerMatchConfiguration } from '@/features/editor/providers/language-server-match-context'
import { useEditorRuntime } from '@/features/editor/hooks/use-runtime'
import { filesystemPath } from '@/lib/documents/utils/identity'
import type { LanguageServerDocument } from '@/lib/language-server-document'
import { useQueryClient } from '@tanstack/react-query'
import { originForQueryClient } from '@/lib/environments/state/query-clients'
import type { LanguageServerDefinitionTarget } from '@singapore-editor/lsp-plugin/websocket'
import type {
  LanguageServerDiagnosticMarkerClaim,
  LanguageServerDiagnosticMarkerEvent,
  LanguageServerReferencesResult,
} from '@singapore-editor/lsp-plugin'
import { useMemo } from 'react'
import { useStore } from 'zustand'

import { useFileOpenIntent } from '@/lib/file-open-intent/providers/context'
import {
  createMatchedLanguageServerPlugin,
  type LanguageServerDocumentTarget,
} from '@/features/editor/utils/language-server-plugin'
import { useLanguageServerMatches } from '@/features/editor/hooks/use-language-server-matches'
import { createEditorLanguageServerStatusSource } from '@/features/editor/state/language-server-status-source'
import {
  useWorkspaceDocumentSyncController,
  useWorkspaceEditHost,
} from '@/features/editor/providers/workspace-edit-context'

type UseLanguageServerPluginOptions = {
  document: LanguageServerDocument | null
  enabled?: boolean
  filePath: string
  languageServerTarget?: LanguageServerDocumentTarget
  rootPath: string
  onOpenDefinition?: (target: LanguageServerDefinitionTarget) => void | boolean
  onOpenReferences?: (result: LanguageServerReferencesResult) => void | boolean
  onDidNavigateDiagnostic?: (
    event: LanguageServerDiagnosticMarkerEvent,
  ) => LanguageServerDiagnosticMarkerClaim
}

export function useLanguageServerPlugin({
  document,
  enabled = true,
  filePath,
  languageServerTarget,
  rootPath,
  onOpenDefinition,
  onOpenReferences,
  onDidNavigateDiagnostic,
}: UseLanguageServerPluginOptions) {
  const { generation: configurationGeneration } = useLanguageServerMatchConfiguration()
  const { languageServerDocuments, documentStore } = useEditorRuntime()
  const documentKey = document?.key ?? null
  const documentUri = document?.uri ?? null
  const buffer = useStore(documentStore, (state) =>
    documentKey === null ? null : (state.liveDocumentsByKey[documentKey]?.buffer ?? null),
  )
  const queryClient = useQueryClient()
  const origin = originForQueryClient(queryClient)
  const backend = useSettingValue('lsp.typescript.backend')
  const maxFiles = useSettingValue('lsp.typescript.workerMaxFiles')
  const maxBytes = useSettingValue('lsp.typescript.workerMaxBytes')
  const worker = enabled && backend === 'worker' && /\.[cm]?[jt]sx?$/.test(filePath)
  const { service: fileOpenIntent } = useFileOpenIntent()
  // Manual memo: `languageServerStatusSource` is a useMemo dependency, and the compiler's cache is a
  // cache, not an identity guarantee — when it recomputes, the useMemo re-runs.
  const languageServerStatusSource = useMemo(() => createEditorLanguageServerStatusSource(), [])
  const onApplyWorkspaceEdit = useWorkspaceEditHost()
  const documentSyncController = useWorkspaceDocumentSyncController()
  // Manual memo: `target` is a useMemo dependency, and the compiler's cache is a
  // cache, not an identity guarantee — when it recomputes, the useMemo re-runs.
  const target = useMemo(
    () => languageServerTarget ?? { matchPath: filePath },
    [filePath, languageServerTarget],
  )
  const matches = useLanguageServerMatches(rootPath, target.matchPath, enabled && document !== null)

  const languageServer = useMemo(() => {
    const server = createMatchedLanguageServerPlugin({
      document:
        documentKey !== null && documentUri !== null
          ? { key: documentKey, uri: documentUri }
          : null,
      origin,
      enabled,
      documentSyncController,
      documents: languageServerDocuments,
      configurationGeneration,
      buffer,
      matches: worker
        ? (matches?.filter((match) => match.serverId !== 'typescript') ?? null)
        : matches,
      rootPath,
      statusSource: worker
        ? withWorkerStatus(languageServerStatusSource)
        : languageServerStatusSource,
      target,
      onApplyWorkspaceEdit,
      onDefinitionLinkHover: (definition) => {
        fileOpenIntent.prepare({
          path: filesystemPath(definition.path),
          rootPath: filesystemPath(rootPath),
          source: 'definition',
        })
      },
      onOpenDefinition,
      onOpenReferences,
      onDidNavigateDiagnostic,
    })
    if (!worker || documentKey === null || documentUri === null) return server
    return withTypeScriptWorker({
      documents: documentStore,
      server,
      client: queryClient,
      root: rootPath,
      file: filePath,
      document: { key: documentKey, uri: documentUri },
      maxFiles,
      maxBytes,
      status: languageServerStatusSource,
      documentSyncController,
      onApplyWorkspaceEdit,
      onOpenDefinition,
      onOpenReferences,
    })
  }, [
    worker,
    documentStore,
    queryClient,
    maxFiles,
    maxBytes,
    filePath,
    documentKey,
    documentUri,
    origin,
    enabled,
    documentSyncController,
    languageServerDocuments,
    configurationGeneration,
    buffer,
    fileOpenIntent,
    languageServerStatusSource,
    matches,
    onApplyWorkspaceEdit,
    onOpenDefinition,
    onOpenReferences,
    onDidNavigateDiagnostic,
    rootPath,
    // `target` is not rebuilt every render: the compiler keys it on filePath and
    // languageServerTarget. Verified with `bun run compiler:explain` on this file.
    // oxlint-disable-next-line react/exhaustive-deps
    target,
  ])

  return {
    languageServer,
    languageServerStatusSource,
  }
}
