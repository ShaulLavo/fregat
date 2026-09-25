import { queryOptions } from '@tanstack/react-query'

import { extractFsErrorCode } from '@/lib/client-error-taxonomy'
import { clientForQueryClient } from '@/lib/environments/state/query-clients'
import { fetchFile } from '@/lib/file-server'
import { filesystemPath } from '@/lib/documents/utils/identity'
import { filePreviewKeys } from '@/lib/query-keys'
import { previewLines, type PreviewContent } from '@/lib/file-preview/utils/preview'

export const PREVIEW_STALE_MS = 30_000

/** The head of a text file. Binary and oversized files are not an error: they have no text preview. */
export function previewQueryOptions(path: string) {
  return queryOptions<PreviewContent>({
    queryKey: filePreviewKeys.preview(path),
    staleTime: PREVIEW_STALE_MS,
    queryFn: async ({ client, signal }) => {
      try {
        const file = await fetchFile(filesystemPath(path), signal, clientForQueryClient(client), {
          acceptTextOnly: true,
        })
        return { kind: 'text', text: previewLines(file.content) }
      } catch (error) {
        const code = extractFsErrorCode(error)
        if (code === 'FILE_IS_BINARY' || code === 'FILE_TOO_LARGE') return { kind: 'binary' }
        throw error
      }
    },
  })
}
