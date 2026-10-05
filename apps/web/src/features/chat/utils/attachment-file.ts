import { isPdfFile } from '@/lib/pdf-viewer/format'
import { decodeText } from '@workspace/contracts/text-encoding'
import {
  chatAttachmentUrlPath,
  type ChatAttachment,
  type EnvironmentId,
} from '@workspace/contracts'
import { createStringTextSnapshot } from '@singapore-editor/core'
import { QueryObserver, queryOptions, type QueryClient } from '@tanstack/react-query'
import { createStructuredError } from '@workspace/observability/errors'
import { attachmentQueryKeys } from './query-keys'

const previewByteLimit = 256 * 1024

export function attachmentFileUrl(attachment: ChatAttachment, origin: string) {
  return `${origin.replace(/\/+$/u, '')}${chatAttachmentUrlPath(attachment)}`
}

export function canPreviewAttachmentText(attachment: ChatAttachment) {
  if (isPdfFile(attachment.name, attachment.mimeType)) return false
  return (
    attachment.sizeBytes <= previewByteLimit &&
    (attachment.mimeType.startsWith('text/') ||
      ['application/json', 'application/xml', 'application/yaml'].includes(attachment.mimeType))
  )
}

export function attachmentTextOptions(
  input: {
    attachment: Extract<ChatAttachment, { type: 'file' }>
    environmentId: EnvironmentId
    origin: string
    provenance: 'staged' | 'sent'
  },
  fetcher: (...args: Parameters<typeof fetch>) => ReturnType<typeof fetch> = fetch,
) {
  const attachment = Object.freeze({ ...input.attachment })
  const captured = Object.freeze({
    ...input,
    attachment,
    url: attachmentFileUrl(attachment, input.origin),
  })
  return queryOptions({
    queryKey: attachmentQueryKeys.text(captured),
    staleTime: input.provenance === 'sent' ? Infinity : 0,
    structuralSharing: false,
    queryFn: async ({ signal }) => {
      if (!canPreviewAttachmentText(attachment)) {
        return Object.freeze({
          ...captured,
          kind: 'no-text' as const,
          reason:
            attachment.sizeBytes > previewByteLimit ? ('size' as const) : ('unsupported' as const),
        })
      }
      const response = await fetcher(captured.url, {
        signal,
        credentials: 'include',
        ...(captured.provenance === 'staged' ? { cache: 'no-store' as const } : {}),
      }).catch((cause: unknown) => {
        signal.throwIfAborted()
        throw previewError('transport', { receivedBytes: 0 }, cause)
      })
      if (!response.ok) {
        void response.body?.cancel().catch(() => undefined)
        throw previewError(
          'status',
          { status: response.status, receivedBytes: 0 },
          undefined,
          response.status,
        )
      }
      const bytes = await readAttachmentBytes(response, attachment, signal)
      const decoded = Object.freeze(decodeText(bytes))
      if (decoded.seemsBinary)
        return Object.freeze({ ...captured, kind: 'binary' as const, bytes, decoded })
      return Object.freeze({
        ...captured,
        kind: 'attachment' as const,
        bytes,
        decoded,
        reader: createStringTextSnapshot(decoded.content),
      })
    },
  })
}

export async function acquireAttachmentText(
  input: Parameters<typeof attachmentTextOptions>[0],
  queryClient: QueryClient,
  signal: AbortSignal,
) {
  signal.throwIfAborted()
  const options = attachmentTextOptions(input)
  const earlier = queryClient.getQueryCache().find({ queryKey: options.queryKey })
  if (earlier?.state.fetchStatus !== 'idle' && earlier?.promise) {
    await waitForQuery(
      earlier.promise.then(
        () => undefined,
        () => undefined,
      ),
      signal,
    )
  }
  signal.throwIfAborted()
  const current = queryClient.getQueryCache().find({ queryKey: options.queryKey })
  const peerRead = current?.state.fetchStatus !== 'idle' && current?.promise
  const read = queryClient.query(options)
  const observer = peerRead ? null : new QueryObserver(queryClient, { ...options, enabled: false })
  const unsubscribe = observer?.subscribe(() => undefined)
  if (unsubscribe) signal.addEventListener('abort', unsubscribe, { once: true })
  if (signal.aborted) unsubscribe?.()
  try {
    const capture = await waitForQuery(read, signal)
    signal.throwIfAborted()
    return capture
  } finally {
    if (unsubscribe) signal.removeEventListener('abort', unsubscribe)
    unsubscribe?.()
  }
}

async function waitForQuery<T>(read: Promise<T>, signal: AbortSignal) {
  let abort: () => void = () => undefined
  const canceled = new Promise<never>((_resolve, reject) => {
    abort = () => reject(signal.reason)
    if (signal.aborted) return abort()
    signal.addEventListener('abort', abort, { once: true })
  })
  try {
    return await Promise.race([read, canceled])
  } finally {
    signal.removeEventListener('abort', abort)
  }
}

async function readAttachmentBytes(
  response: Response,
  attachment: Extract<ChatAttachment, { type: 'file' }>,
  signal: AbortSignal,
) {
  const reader = response.body?.getReader()
  let receivedBytes = 0
  let complete = false
  const cancel = () => {
    void reader?.cancel().catch(() => undefined)
  }
  signal.addEventListener('abort', cancel, { once: true })
  try {
    signal.throwIfAborted()
    validateResponseMetadata(response, attachment)
    const bytes = new Uint8Array(attachment.sizeBytes)
    while (reader) {
      const chunk = await readChunk(reader, signal, receivedBytes, attachment.sizeBytes)
      signal.throwIfAborted()
      if (chunk.done) break
      const nextLength = receivedBytes + chunk.value.byteLength
      if (nextLength > bytes.byteLength)
        throw previewError('excess', { receivedBytes: nextLength, expectedBytes: bytes.byteLength })
      bytes.set(chunk.value, receivedBytes)
      receivedBytes = nextLength
    }
    if (receivedBytes !== attachment.sizeBytes)
      throw previewError('length', { receivedBytes, expectedBytes: attachment.sizeBytes })
    complete = true
    return bytes
  } finally {
    signal.removeEventListener('abort', cancel)
    if (!complete) cancel()
    reader?.releaseLock()
  }
}

async function readChunk(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  signal: AbortSignal,
  receivedBytes: number,
  expectedBytes: number,
) {
  try {
    return await reader.read()
  } catch (cause) {
    signal.throwIfAborted()
    throw previewError('stream', { receivedBytes, expectedBytes }, cause)
  }
}

function validateResponseMetadata(
  response: Response,
  attachment: Extract<ChatAttachment, { type: 'file' }>,
) {
  const advertisedLength = response.headers.get('content-length')
  const encoding = response.headers.get('content-encoding')
  const identityTransfer =
    !encoding || encoding.split(',').every((coding) => coding.trim().toLowerCase() === 'identity')
  if (
    advertisedLength !== null &&
    (!/^\d+$/u.test(advertisedLength) ||
      (identityTransfer && Number(advertisedLength) !== attachment.sizeBytes))
  ) {
    throw previewError('advertised-length', {
      expectedBytes: attachment.sizeBytes,
      advertisedBytes: Number(advertisedLength),
      receivedBytes: 0,
    })
  }
  const advertisedType = response.headers.get('content-type')
  if (
    advertisedType !== null &&
    advertisedType.split(';', 1)[0]?.trim().toLowerCase() !==
      attachment.mimeType.split(';', 1)[0]?.trim().toLowerCase()
  ) {
    throw previewError('advertised-type', { typeMatches: false, receivedBytes: 0 })
  }
}

function previewError(
  reason: string,
  facts: Record<string, unknown>,
  cause?: unknown,
  status = 502,
) {
  return createStructuredError({
    code: 'ATTACHMENT_PREVIEW_FAILED',
    status,
    message: 'Attachment preview could not be loaded.',
    why: 'The attachment download failed or its bytes did not match its metadata.',
    fix: 'Retry the preview or download the original file.',
    internal: { reason, ...facts },
    cause,
  })
}
