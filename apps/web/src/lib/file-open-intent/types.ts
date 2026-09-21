import type { DocumentKey, FilesystemPath } from '@/lib/documents/utils/types'
import type { EditorTextBuffer, PieceTableSnapshot } from '@singapore-editor/core/document'
import type { EditorPreparedDocument } from '@singapore-editor/core/editor'
import type { FileResult } from '@/lib/file-system-types'

type PreparedOpenClaimBase = {
  readonly buffer: EditorTextBuffer
  readonly path: FilesystemPath
  readonly snapshot: PieceTableSnapshot
}

export type PreparedCleanFileOpenClaim = PreparedOpenClaimBase & {
  readonly file: FileResult
  readonly fileVersion: string
  readonly kind: 'clean'
  readonly preparedDocument: EditorPreparedDocument
}

export type PreparedLiveFileOpenClaim = PreparedOpenClaimBase & {
  readonly documentKey: DocumentKey
  readonly kind: 'live'
  readonly localRevision: number
  readonly preparedDocument: EditorPreparedDocument | null
}

export type PreparedFileOpenClaim = PreparedCleanFileOpenClaim | PreparedLiveFileOpenClaim
