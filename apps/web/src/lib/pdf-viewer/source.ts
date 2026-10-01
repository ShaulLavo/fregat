import { pdfQueryKeys } from '@/lib/pdf-viewer/query-keys'
import { queryOptions } from '@tanstack/react-query'
import { chatAttachmentUrlPath, type ChatAttachment } from '@workspace/contracts'
import { pdfError } from '@/lib/pdf-viewer/structured-errors'

export type PdfSource =
  | {
      readonly kind: 'file'
      readonly origin: string
      readonly path: string
      readonly version: string
    }
  | {
      readonly kind: 'attachment'
      readonly origin: string
      readonly attachment: Extract<ChatAttachment, { type: 'file' }>
    }

export function pdfSourceUrl(source: PdfSource) {
  const origin = source.origin.replace(/\/+$/u, '')
  if (source.kind === 'attachment') return `${origin}${chatAttachmentUrlPath(source.attachment)}`
  return `${origin}/fs/blob?${new URLSearchParams({ path: source.path, v: source.version })}`
}

export function pdfBytesOptions(
  source: PdfSource,
  fetcher: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> = fetch,
) {
  const url = pdfSourceUrl(source)
  return queryOptions({
    queryKey: pdfQueryKeys.bytes(source.origin, source.kind, url),
    staleTime: Infinity,
    gcTime: 0,
    retry: false,
    queryFn: async ({ signal }) => {
      try {
        const response = await fetcher(url, { signal, credentials: 'include' })
        if (!response.ok) throw pdfError('LOAD_FAILED', response.status, 'read')
        return {
          bytes: new Uint8Array(await response.arrayBuffer()),
          revision: response.headers.get('x-fs-version') ?? url,
        }
      } catch (cause) {
        if (signal.aborted) throw cause
        throw pdfError('LOAD_FAILED', cause, 'read')
      }
    },
  })
}
