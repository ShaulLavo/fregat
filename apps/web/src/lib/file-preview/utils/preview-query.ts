import { createStringTextSnapshot } from '@singapore-editor/core/document'
import { queryOptions } from '@tanstack/react-query'

import { extractFsErrorCode } from '@/lib/client-error-taxonomy'
import { clientForQueryClient, originForQueryClient } from '@/lib/environments/state/query-clients'
import { fetchFileHead } from '@/lib/file-server'
import { filePreviewKeys } from '@/lib/query-keys'
import type { PreviewContent } from '@/lib/file-preview/utils/preview'

const PREVIEW_STALE_MS = 30_000

/** The head of a text file, up to the budget. A binary file is not an error: it has no text preview. */
export function previewQueryOptions(path: string, maxBytes: number) {
  return queryOptions<PreviewContent>({
    queryKey: filePreviewKeys.preview(path, maxBytes),
    staleTime: PREVIEW_STALE_MS,
    queryFn: async ({ client, signal }) => {
      const owner = clientForQueryClient(client)
      const origin = originForQueryClient(client)
      try {
        const head = await fetchFileHead(path, maxBytes, signal, owner)
        return {
          kind: 'text',
          text: head.content,
          read: {
            kind: 'disk',
            input: {
              kind: 'disk-head',
              origin,
              maxBytes,
              head,
              reader: createStringTextSnapshot(head.content),
            },
          },
          size: head.size,
          truncated: head.truncated,
          source: { origin, path: head.path, capture: head.capture },
          coverage: head.coverage,
        }
      } catch (error) {
        if (extractFsErrorCode(error) === 'FILE_IS_BINARY') return { kind: 'binary' }
        throw error
      }
    },
  })
}
