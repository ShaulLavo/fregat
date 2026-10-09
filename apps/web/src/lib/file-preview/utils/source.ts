import { createClientInvariantError } from '@/lib/structured-errors'
import { mutationOptions, type QueryClient } from '@tanstack/react-query'
import type { StoreApi } from 'zustand/vanilla'
import type {
  DocumentSyncPoint,
  DocumentTextSnapshot,
  EditorTextBuffer,
  TextEdit,
  TextOffsetRange,
  TextSnapshot,
  TextReadSnapshot,
} from '@singapore-editor/core/document'
import type { DocumentKey, FilesystemPath } from '@/lib/documents/utils/types'
import type { SnapshotComparisonScope } from '@/lib/documents/utils/snapshot-comparison'
import type { fetchFileHead } from '@/lib/file-server'
import { fileDocumentKey } from '@/lib/documents/utils/identity'
import { originForQueryClient } from '@/lib/environments/state/query-clients'
import { previewQueryOptions } from '@/lib/file-preview/utils/preview-query'
import { filePreviewMutationKeys } from '@/lib/file-preview/utils/mutation-keys'
import type { ChatAttachment, EnvironmentId } from '@workspace/contracts'
import type { DecodedText } from '@workspace/contracts/text-encoding'
import { serverEndpoint } from '@/lib/client'

type DiskPreviewCapture = {
  readonly kind: 'disk-head'
  readonly origin: string
  readonly maxBytes: number
  readonly head: Awaited<ReturnType<typeof fetchFileHead>>
  readonly reader: TextSnapshot
}
export type DiskHeadInput = DiskPreviewCapture & { readonly scope: SnapshotComparisonScope }
export type AttachmentTextCapture = {
  readonly kind: 'attachment'
  readonly environmentId: EnvironmentId
  readonly origin: string
  readonly attachment: Extract<ChatAttachment, { type: 'file' }>
  readonly provenance: 'staged' | 'sent'
  readonly url: string
  readonly bytes: Uint8Array
  readonly decoded: DecodedText
  readonly reader: TextSnapshot
}
export type PreviewSourceRead =
  | {
      readonly kind: 'live'
      readonly scope: SnapshotComparisonScope
      readonly key: DocumentKey
      readonly buffer: EditorTextBuffer
      readonly revision: number
      readonly syncPoint: DocumentSyncPoint
      readonly snapshot: DocumentTextSnapshot
      readonly range: { readonly start: 0; readonly end: number }
      readonly text: string
      readonly maxBytes: number
      readonly utf8Bytes: number
      readonly complete: boolean
      readonly dirty: boolean
    }
  | { readonly kind: 'disk'; readonly input: DiskPreviewCapture }
  | { readonly kind: 'attachment'; readonly input: AttachmentTextCapture }
  | { readonly kind: 'no-text'; readonly reason: 'binary' }
  | { readonly kind: 'unavailable'; readonly reason: 'live-ended' }
  | { readonly kind: 'released'; readonly reason: 'interest-ended' | 'owner-disposed' }
export type PreviewSourceLease = { read(): PreviewSourceRead; release(): void }
export type LivePreviewRequest = {
  readonly scope: SnapshotComparisonScope
  readonly key: DocumentKey
  readonly maxBytes: number
  readonly signal: AbortSignal
}
type PreviewSourceState = {
  readonly previewScope: SnapshotComparisonScope | null
  readonly previewSources: ReadonlyMap<PreviewSourceLease, PreviewSourceRead>
}
export type PreviewSourceCapability = {
  readonly environmentId: EnvironmentId
  readonly origin: string
  readonly queryClient: QueryClient
  readonly store: Pick<StoreApi<PreviewSourceState>, 'getState' | 'getInitialState' | 'subscribe'>
  acquireLivePreview(request: LivePreviewRequest): PreviewSourceLease | null
  adoptPreviewCapture(request: {
    readonly input: DiskHeadInput | AttachmentTextCapture
    readonly signal: AbortSignal
  }): PreviewSourceLease
}
export type PreviewViewRead =
  | PreviewSourceRead
  | { readonly kind: 'other' }
  | { readonly kind: 'pending' }
  | { readonly kind: 'error'; readonly error: unknown }
export type PreviewBinding = {
  readonly read: PreviewSourceRead
  readonly lease: PreviewSourceLease | null
}
export type PreviewViewRequest = {
  readonly path: FilesystemPath
  readonly maxBytes: number
  readonly scope: SnapshotComparisonScope | null
  readonly signal: AbortSignal
}

// Holds its buffer: drop it with the lease it was captured from.
export type SourceRangeRef = {
  readonly scope: SnapshotComparisonScope
  readonly key: DocumentKey
  readonly buffer: EditorTextBuffer
  readonly revision: number
  readonly syncPoint: DocumentSyncPoint
  readonly range: TextOffsetRange
}
type SourceRangeInvalidReason =
  | 'not-live'
  | 'partial'
  | 'stale'
  | 'ended'
  | 'replaced'
  | 'edited'
  | 'history-unavailable'
export type SourceRangeResolution =
  | { readonly kind: 'valid'; readonly ref: SourceRangeRef }
  | { readonly kind: 'invalid'; readonly reason: SourceRangeInvalidReason }

export function attachmentPreviewMutationOptions(
  capability: PreviewSourceCapability | null,
  queryClient: QueryClient,
) {
  return mutationOptions({
    mutationKey: filePreviewMutationKeys.capture,
    networkMode: 'always',
    gcTime: 0,
    mutationFn: async (request: {
      readonly input: AttachmentTextCapture
      readonly expected: Pick<
        AttachmentTextCapture,
        'attachment' | 'environmentId' | 'origin' | 'provenance' | 'url'
      >
      readonly signal: AbortSignal
    }): Promise<PreviewBinding> => {
      request.signal.throwIfAborted()
      const { input, expected } = request
      if (
        input.environmentId !== expected.environmentId ||
        input.origin !== expected.origin ||
        input.provenance !== expected.provenance ||
        input.url !== expected.url ||
        input.attachment.id !== expected.attachment.id ||
        input.attachment.name !== expected.attachment.name ||
        input.attachment.mimeType !== expected.attachment.mimeType ||
        input.attachment.sizeBytes !== expected.attachment.sizeBytes
      )
        throw createClientInvariantError('Attachment capture belongs to a different selection', {
          selectionMatches: false,
        })
      if (
        !capability ||
        capability.queryClient !== queryClient ||
        capability.environmentId !== input.environmentId ||
        serverEndpoint(capability.origin) !== input.origin
      )
        return { read: { kind: 'attachment', input }, lease: null }
      const lease = capability.adoptPreviewCapture({ input, signal: request.signal })
      return { read: lease.read(), lease }
    },
  })
}

export function boundedPreviewPrefix(snapshot: TextReadSnapshot, maxBytes: number) {
  const parts: string[] = []
  let end = 0
  let utf8Bytes = 0
  while (end < snapshot.length) {
    const remaining = maxBytes - utf8Bytes
    const count = Math.max(1, Math.min(128, Math.floor(remaining / 3) - 1))
    const chunk = previewRangeChunk(snapshot, end, count)
    for (const point of chunk) {
      const width = point.length === 2 ? 4 : utf8Width(point.charCodeAt(0))
      if (utf8Bytes + width > maxBytes)
        return {
          range: { start: 0 as const, end },
          text: parts.join(''),
          utf8Bytes,
          complete: false,
        }
      parts.push(point)
      utf8Bytes += width
      end += point.length
    }
  }
  return { range: { start: 0 as const, end }, text: parts.join(''), utf8Bytes, complete: true }
}

export function samePreviewScope(
  left: SnapshotComparisonScope | null,
  right: SnapshotComparisonScope | null,
) {
  return (
    left === right ||
    Boolean(
      left &&
      right &&
      left.environmentId === right.environmentId &&
      left.rootPath === right.rootPath,
    )
  )
}

// `expectedText` is the text the caller's offsets were computed from; offsets from another
// revision or from disk capture only when the live text at them still matches.
export function captureSourceRange(
  read: PreviewSourceRead,
  range: TextOffsetRange,
  expectedText: string,
): SourceRangeResolution {
  if (read.kind !== 'live') return { kind: 'invalid', reason: nonLiveSourceReason(read) }
  const { start, end } = range
  assertSourceRange(start, end, read.snapshot.length)
  if (end > read.range.end) return { kind: 'invalid', reason: 'partial' }
  if (read.snapshot.readRange(start, end) !== expectedText)
    return { kind: 'invalid', reason: 'stale' }
  const { scope, key, buffer, revision, syncPoint } = read
  return { kind: 'valid', ref: { scope, key, buffer, revision, syncPoint, range: { start, end } } }
}

export function resolveSourceRange(
  ref: SourceRangeRef,
  read: PreviewSourceRead,
): SourceRangeResolution {
  if (read.kind !== 'live') return { kind: 'invalid', reason: nonLiveSourceReason(read) }
  if (read.key !== ref.key || !samePreviewScope(read.scope, ref.scope))
    throw createClientInvariantError('Source range belongs to a different document', {
      keyMatches: read.key === ref.key,
      scopeMatches: samePreviewScope(read.scope, ref.scope),
    })
  if (read.buffer !== ref.buffer) return { kind: 'invalid', reason: 'replaced' }
  const changes = read.buffer.changesBetweenDocumentSyncPoints(ref.syncPoint, read.syncPoint, null)
  if (!changes?.edits) return { kind: 'invalid', reason: 'history-unavailable' }
  const range = mapSourceRange(ref.range, changes.edits)
  if (!range) return { kind: 'invalid', reason: 'edited' }
  if (range.end > read.range.end) return { kind: 'invalid', reason: 'partial' }
  return {
    kind: 'valid',
    ref: { ...ref, revision: read.revision, syncPoint: read.syncPoint, range },
  }
}

function nonLiveSourceReason(
  read: Exclude<PreviewSourceRead, { kind: 'live' }>,
): SourceRangeInvalidReason {
  if (read.kind === 'released' || read.kind === 'unavailable') return 'ended'
  if (read.kind === 'disk' && read.input.head.truncated) return 'partial'
  return 'not-live'
}

function assertSourceRange(start: number, end: number, length: number): void {
  if (
    Number.isSafeInteger(start) &&
    Number.isSafeInteger(end) &&
    start >= 0 &&
    start <= end &&
    end <= length
  )
    return
  throw createClientInvariantError('Source range must lie inside its snapshot', {
    start,
    end,
    length,
  })
}

// The chain composes publications into net edits, which lose where each edit sat relative
// to the range. Any composed edit that touches or abuts the range invalidates it, empty ones
// included, so one resolve across many publications agrees with a resolve after each.
function mapSourceRange(
  range: TextOffsetRange,
  edits: readonly TextEdit[],
): TextOffsetRange | null {
  let delta = 0
  for (const edit of edits) {
    if (edit.to < range.start) {
      delta += edit.text.length - (edit.to - edit.from)
      continue
    }
    if (edit.from > range.end) continue
    return null
  }
  return { start: range.start + delta, end: range.end + delta }
}

export function previewViewMutationOptions(
  capability: PreviewSourceCapability | null,
  queryClient: QueryClient,
) {
  return mutationOptions({
    mutationKey: filePreviewMutationKeys.view,
    networkMode: 'always',
    gcTime: 0,
    mutationFn: async (request: PreviewViewRequest): Promise<PreviewBinding> => {
      request.signal.throwIfAborted()
      const origin = originForQueryClient(queryClient)
      const capturedScope = capability?.store.getState().previewScope ?? null
      const matched = Boolean(
        capability &&
        capability.origin === origin &&
        capability.queryClient === queryClient &&
        request.scope &&
        samePreviewScope(capturedScope, request.scope),
      )
      const live =
        matched && capability && request.scope
          ? capability.acquireLivePreview({
              scope: request.scope,
              key: fileDocumentKey(request.path),
              maxBytes: request.maxBytes,
              signal: request.signal,
            })
          : null
      if (live) return { read: live.read(), lease: live }
      const result = await waitForPreview(
        queryClient.query(previewQueryOptions(request.path, request.maxBytes)),
        request.signal,
      )
      request.signal.throwIfAborted()
      if (matched && capability && capability.store.getState().previewScope !== capturedScope)
        throw createClientInvariantError('Preview namespace changed during capture', {
          scopeMatches: false,
        })
      if (result.kind === 'binary')
        return { read: { kind: 'no-text', reason: 'binary' }, lease: null }
      if (
        matched &&
        capability &&
        request.scope &&
        samePreviewScope(capability.store.getState().previewScope, request.scope)
      ) {
        const lease = capability.adoptPreviewCapture({
          input: { ...result.read.input, scope: request.scope },
          signal: request.signal,
        })
        return { read: lease.read(), lease }
      }
      return { read: result.read, lease: null }
    },
  })
}

function waitForPreview<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason)
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason)
    signal.addEventListener('abort', abort, { once: true })
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort))
  })
}

function utf8Width(code: number) {
  if (code <= 0x7f) return 1
  if (code <= 0x7ff) return 2
  if (code <= 0xffff) return 3
  return 4
}

function previewRangeChunk(snapshot: TextReadSnapshot, start: number, count: number) {
  const chunk = snapshot.readRange(start, Math.min(snapshot.length, start + count))
  const last = chunk.charCodeAt(chunk.length - 1)
  if (last < 0xd800 || last > 0xdbff || start + chunk.length >= snapshot.length) return chunk
  const next = snapshot.readRange(start + chunk.length, start + chunk.length + 1)
  const low = next.charCodeAt(0)
  return low >= 0xdc00 && low <= 0xdfff ? chunk + next : chunk
}
