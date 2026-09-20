import { clientForQueryClient } from '@/lib/environments/state/query-clients'
import {
  useEditorDocumentState,
  useEditorDocumentStoreApi,
} from '@/features/editor/state/document-state'
import { useLanguageServerMatches } from '@/features/editor/hooks/use-language-server-matches'
import { documentSymbolServerId, fetchDocumentSymbols } from '@/lib/document-symbols'
import { tabFileResource } from '@/lib/documents/utils/capabilities'
import { fileDocumentKey } from '@/lib/documents/utils/identity'
import type { FilesystemPath, TabContent } from '@/lib/documents/utils/types'
import { documentSymbolKeys } from '@/lib/query-keys'
import { useQuery } from '@tanstack/react-query'

import type { QuickAccessMode } from '@/features/command-palette/utils/types'

type UseCommandPaletteSymbolsOptions = {
  readonly mode: QuickAccessMode
  readonly rootPath: FilesystemPath | null
  readonly selectedTabContent: TabContent | null
}

export function useSymbols({
  mode,
  rootPath,
  selectedTabContent,
}: UseCommandPaletteSymbolsOptions) {
  const documentStore = useEditorDocumentStoreApi()
  const selectedFileBackedPath = selectedTabContent
    ? (tabFileResource(selectedTabContent)?.path ?? null)
    : null
  const selectedKey =
    selectedFileBackedPath === null ? null : fileDocumentKey(selectedFileBackedPath)
  const symbolsEnabled = mode === 'symbols' && rootPath !== null && selectedFileBackedPath !== null
  // The socket route needs a named server; the match query knows which one.
  const matches = useLanguageServerMatches(
    rootPath ?? '',
    selectedFileBackedPath ?? '',
    symbolsEnabled,
  )
  const serverId = documentSymbolServerId(matches)
  const selectedDocumentContentRevision = useEditorDocumentState((state) =>
    symbolsEnabled && selectedKey ? (state.documentContentRevisions[selectedKey] ?? null) : null,
  )
  const symbolQuery = useQuery({
    enabled: symbolsEnabled && serverId !== null,
    queryFn: ({ signal, client }) => {
      const selectedDocument = selectedKey
        ? documentStore.getState().liveDocumentsByKey[selectedKey]
        : null

      return fetchDocumentSymbols(
        {
          path: selectedFileBackedPath ?? '',
          rootPath: rootPath ?? '',
          serverId: serverId ?? '',
          signal,
          text: selectedDocument?.buffer.isDirty()
            ? selectedDocument.buffer.materializeFullText()
            : null,
        },
        clientForQueryClient(client),
      )
    },
    queryKey: documentSymbolKeys.document(
      rootPath ?? '',
      selectedFileBackedPath ?? '',
      `${serverId ?? ''}:${selectedDocumentContentRevision ?? 'disk'}`,
    ),
  })

  return {
    selectedFileBackedPath,
    symbolQuery,
    symbolsEnabled,
  }
}
