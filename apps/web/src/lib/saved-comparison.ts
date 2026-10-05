import type { EnvironmentId } from '@workspace/contracts'
import type { DocumentTextSnapshot, EditorTextBuffer } from '@singapore-editor/core/document'
import type { EditorDocumentAnalysis } from '@singapore-editor/core/editor'
import type { DocumentKey, FilesystemPath } from '@/lib/documents/utils/types'
import type { FileSnapshot } from '@/lib/file-snapshot'

export type SavedComparisonScope = {
  readonly environmentId: EnvironmentId
  readonly rootPath: FilesystemPath
}

export type SavedComparisonRead =
  | {
      readonly kind: 'ready'
      readonly scope: SavedComparisonScope
      readonly live: {
        readonly kind: 'live-buffer'
        readonly key: DocumentKey
        readonly buffer: EditorTextBuffer
        readonly analysis: EditorDocumentAnalysis
        readonly revision: number
        readonly snapshot: DocumentTextSnapshot
      }
      readonly saved: { readonly kind: 'saved-file'; readonly snapshot: FileSnapshot }
    }
  | {
      readonly kind: 'unavailable'
      readonly scope: SavedComparisonScope
      readonly saved: { readonly kind: 'saved-file'; readonly snapshot: FileSnapshot }
    }
  | { readonly kind: 'released'; readonly reason: 'interest-ended' | 'owner-disposed' }

export type SavedComparisonLease = {
  read(): SavedComparisonRead
  requestSavedRefresh(): SavedComparisonRefresh
  refreshSaved(snapshot: FileSnapshot, request: SavedComparisonRefresh): boolean
  release(): void
}

export type SavedComparisonRequest = {
  readonly scope: SavedComparisonScope
  readonly saved: FileSnapshot
  readonly signal: AbortSignal
}

export type SavedComparisonRefresh = { readonly lease: SavedComparisonLease }
