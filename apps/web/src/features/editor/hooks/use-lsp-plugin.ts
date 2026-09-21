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
  const documentKey = document?.key ?? null
  const documentUri = document?.uri ?? null
  const origin = originForQueryClient(useQueryClient())
  const { service: fileOpenIntent } = useFileOpenIntent()
  const languageServerStatusSource = createEditorLanguageServerStatusSource()
  const onApplyWorkspaceEdit = useWorkspaceEditHost()
  const documentSyncController = useWorkspaceDocumentSyncController()
  const target = languageServerTarget ?? { matchPath: filePath }
  const matches = useLanguageServerMatches(rootPath, target.matchPath, enabled && document !== null)

  const languageServer = useMemo(() => {
    return createMatchedLanguageServerPlugin({
      document:
        documentKey !== null && documentUri !== null
          ? { key: documentKey, uri: documentUri }
          : null,
      origin,
      enabled,
      documentSyncController,
      matches,
      rootPath,
      statusSource: languageServerStatusSource,
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
  }, [
    documentKey,
    documentUri,
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
