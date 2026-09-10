import { useQueryClient } from '@tanstack/react-query'
import { originForQueryClient } from '@/lib/environments/state/query-clients'
import type {
  LanguageServerDefinitionTarget,
  LanguageServerDiagnosticMarkerClaim,
  LanguageServerDiagnosticMarkerEvent,
  LanguageServerReferencesResult,
} from '@singapor/lsp-plugin'
import { useMemo } from 'react'

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
  enabled = true,
  filePath,
  languageServerTarget,
  rootPath,
  onOpenDefinition,
  onOpenReferences,
  onDidNavigateDiagnostic,
}: UseLanguageServerPluginOptions) {
  const origin = originForQueryClient(useQueryClient())
  const { service: fileOpenIntent } = useFileOpenIntent()
  const languageServerStatusSource = useMemo(() => createEditorLanguageServerStatusSource(), [])
  const onApplyWorkspaceEdit = useWorkspaceEditHost()
  const documentSyncController = useWorkspaceDocumentSyncController()
  const target = useMemo(
    () => languageServerTarget ?? { matchPath: filePath },
    [filePath, languageServerTarget],
  )
  const matches = useLanguageServerMatches(rootPath, target.matchPath, enabled)

  const languageServer = useMemo(() => {
    return createMatchedLanguageServerPlugin({
      origin,
      enabled,
      documentSyncController,
      matches,
      rootPath,
      statusSource: languageServerStatusSource,
      target,
      onApplyWorkspaceEdit,
      onDefinitionLinkHover: (definition) => {
        fileOpenIntent.prepare({ path: definition.path, rootPath, source: 'definition' })
      },
      onOpenDefinition,
      onOpenReferences,
      onDidNavigateDiagnostic,
    })
  }, [
    origin,
    enabled,
    documentSyncController,
    fileOpenIntent,
    languageServerStatusSource,
    matches,
    onApplyWorkspaceEdit,
    onOpenDefinition,
    onOpenReferences,
    onDidNavigateDiagnostic,
    rootPath,
    target,
  ])

  return {
    languageServer,
    languageServerStatusSource,
  }
}
