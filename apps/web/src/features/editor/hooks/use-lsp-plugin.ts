import { useDocumentFeatureTier } from '@/features/editor/hooks/use-document-feature-tier'
import { useDiagnosticFix } from '@/lib/diagnostic-ai/hooks/use-diagnostic-fix'
import { diagnosticHoverActions } from '@/features/editor/utils/diagnostic-hover-actions'
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
import { useLayoutEffect, useMemo, useState } from 'react'
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
} from '@/lib/workspace-edits/providers/host-context'

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
  const { analysisAllowed, analysisLimitMiCodeUnits } = useDocumentFeatureTier(buffer)
  // Child layout effects run before the provider: update the limit before plugin activation.
  useLayoutEffect(() => {
    languageServerDocuments.setLimit(analysisLimitMiCodeUnits)
  }, [languageServerDocuments, analysisLimitMiCodeUnits])
  const analysisEnabled = enabled && analysisAllowed
  const origin = originForQueryClient(useQueryClient())
  const {
    available,
    mutation: { mutateAsync },
  } = useDiagnosticFix()
  // The plugin memo depends on this callback; pending mutation updates preserve its identity.
  const getDiagnosticActions = useMemo(
    () => (available ? diagnosticHoverActions(mutateAsync) : undefined),
    [available, mutateAsync],
  )
  const { service: fileOpenIntent } = useFileOpenIntent()
  const [languageServerStatusSource] = useState(createEditorLanguageServerStatusSource)
  const onApplyWorkspaceEdit = useWorkspaceEditHost()
  const documentSyncController = useWorkspaceDocumentSyncController()
  // The plugin memo depends on this target object.
  const target = useMemo(
    () => languageServerTarget ?? { matchPath: filePath },
    [filePath, languageServerTarget],
  )
  const matches = useLanguageServerMatches(
    rootPath,
    target.matchPath,
    analysisEnabled && document !== null,
  )

  const languageServer = useMemo(() => {
    return createMatchedLanguageServerPlugin({
      document:
        documentKey !== null && documentUri !== null
          ? { key: documentKey, uri: documentUri }
          : null,
      origin,
      enabled: analysisEnabled,
      documentSyncController,
      documents: languageServerDocuments,
      configurationGeneration,
      buffer,
      matches,
      rootPath,
      statusSource: languageServerStatusSource,
      target,
      onApplyWorkspaceEdit,
      onDefinitionLinkHover: (definition) => {
        const interest = fileOpenIntent.prepare({
          path: filesystemPath(definition.path),
          rootPath: filesystemPath(rootPath),
          source: 'definition',
        })
        return interest.release
      },
      onOpenDefinition,
      onOpenReferences,
      onDidNavigateDiagnostic,
      getDiagnosticActions,
    })
  }, [
    documentKey,
    documentUri,
    origin,
    analysisEnabled,
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
    getDiagnosticActions,
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
