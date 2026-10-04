import type { DocumentKey, FilesystemPath } from '@/lib/documents/utils/types'
import type { EditorTextBuffer, PieceTableSnapshot } from '@singapore-editor/core/document'
import type { EditorPreparedDocument } from '@singapore-editor/core/editor'
import type { FileSnapshot } from '@/lib/file-snapshot'

type PreparedOpenClaimBase = {
  readonly buffer: EditorTextBuffer
  readonly documentKey: DocumentKey
  readonly localRevision: number
  readonly path: FilesystemPath
  readonly snapshot: PieceTableSnapshot
  release(): void
}

export type PreparedCleanFileOpenClaim = PreparedOpenClaimBase & {
  readonly file: FileSnapshot
  readonly fileVersion: string
  readonly kind: 'clean'
  readonly preparedDocument: EditorPreparedDocument
}

export type PreparedLiveFileOpenClaim = PreparedOpenClaimBase & {
  readonly kind: 'live'
  readonly preparedDocument: EditorPreparedDocument | null
}

export type PreparedFileOpenClaim = PreparedCleanFileOpenClaim | PreparedLiveFileOpenClaim
