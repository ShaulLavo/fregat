import { createClientInvariantError } from '@/lib/structured-errors'
import { mutationOptions, type QueryClient } from '@tanstack/react-query'
import type { StoreApi } from 'zustand/vanilla'
import type {
  DocumentTextSnapshot,
  EditorTextBuffer,
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

type DiskPreviewCapture = {
  readonly kind: 'disk-head'
  readonly origin: string
  readonly maxBytes: number
  readonly head: Awaited<ReturnType<typeof fetchFileHead>>
  readonly reader: TextSnapshot
}
export type DiskHeadInput = DiskPreviewCapture & { readonly scope: SnapshotComparisonScope }
export type PreviewSourceRead =
  | {
      readonly kind: 'live'
      readonly scope: SnapshotComparisonScope
      readonly key: DocumentKey
      readonly buffer: EditorTextBuffer
      readonly revision: number
      readonly snapshot: DocumentTextSnapshot
      readonly range: { readonly start: 0; readonly end: number }
      readonly text: string
      readonly maxBytes: number
      readonly utf8Bytes: number
      readonly complete: boolean
      readonly dirty: boolean
    }
  | { readonly kind: 'disk'; readonly input: DiskPreviewCapture }
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
  readonly origin: string
  readonly queryClient: QueryClient
  readonly store: Pick<StoreApi<PreviewSourceState>, 'getState' | 'getInitialState' | 'subscribe'>
  acquireLivePreview(request: LivePreviewRequest): PreviewSourceLease | null
  adoptPreviewCapture(request: {
    readonly input: DiskHeadInput
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
