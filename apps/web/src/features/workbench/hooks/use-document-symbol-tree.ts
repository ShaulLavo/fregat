import { useQuery } from '@tanstack/react-query'

import { useEditorDocumentStoreApi } from '@/features/editor/state/document-state'
import { useSymbolRevision } from '@/features/workbench/hooks/use-symbol-revision'
import { useLanguageServerMatches } from '@/features/editor/hooks/use-language-server-matches'
import { clientForQueryClient } from '@/lib/environments/state/query-clients'
import {
  documentSymbolServerId,
  fetchDocumentSymbolTree,
  type DocumentSymbol,
} from '@/lib/document-symbols'
import { fileDocumentKey } from '@/lib/documents/utils/identity'
import type { FilesystemPath } from '@/lib/documents/utils/types'
import { documentSymbolKeys } from '@/lib/query-keys'

const EMPTY_SYMBOLS: readonly DocumentSymbol[] = []

export function useDocumentSymbolTree(rootPath: FilesystemPath, filePath: FilesystemPath | null) {
  const documentStore = useEditorDocumentStoreApi()
  const key = filePath ? fileDocumentKey(filePath) : null
  const settledRevision = useSymbolRevision(documentStore, key)
  const matches = useLanguageServerMatches(rootPath, filePath ?? '', filePath !== null)
  const serverId = documentSymbolServerId(matches)
  const query = useQuery({
    enabled: filePath !== null && serverId !== null,
    queryFn: ({ client, signal }) => {
      const liveDocument = key ? documentStore.getState().liveDocumentsByKey[key] : null

      return fetchDocumentSymbolTree(
        {
          path: filePath ?? '',
          rootPath,
          serverId: serverId ?? '',
          signal,
          text: liveDocument?.buffer.isDirty() ? liveDocument.buffer.materializeFullText() : null,
        },
        clientForQueryClient(client),
      )
    },
    queryKey: documentSymbolKeys.document(
      rootPath,
      filePath ?? '',
      `${serverId ?? ''}:${settledRevision ?? 'disk'}`,
    ),
    placeholderData: (previous) => previous,
  })

  return query.data ?? EMPTY_SYMBOLS
}
