import { chatAttachmentUrlPath, type ChatAttachment } from '@workspace/contracts'
import { queryOptions } from '@tanstack/react-query'
import { createClientInvariantError } from '@/lib/structured-errors'
import { attachmentQueryKeys } from './query-keys'

export function attachmentFileUrl(attachment: ChatAttachment, origin: string) {
  return `${origin.replace(/\/+$/u, '')}${chatAttachmentUrlPath(attachment)}`
}

export function canPreviewAttachmentText(attachment: ChatAttachment) {
  return (
    attachment.sizeBytes <= 256 * 1024 &&
    (attachment.mimeType.startsWith('text/') ||
      ['application/json', 'application/xml', 'application/yaml'].includes(attachment.mimeType))
  )
}

export function attachmentTextOptions(url: string, fetcher: typeof fetch = fetch) {
  return queryOptions({
    queryKey: attachmentQueryKeys.text(url),
    staleTime: Infinity,
    queryFn: async ({ signal }) => {
      const response = await fetcher(url, { signal, credentials: 'include' })
      if (!response.ok) throw createClientInvariantError('Attachment preview could not be loaded.')
      return response.text()
    },
  })
}
