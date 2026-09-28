import type { TextSnapshot } from '@singapore-editor/core/document'
import type { FileResult } from '@/lib/file-system-types'

// Saved snapshots share the buffer's immutable pieces. Full text belongs to the reader.
export type FileSnapshot =
  | FileResult
  | (Omit<FileResult, 'content'> & {
      readonly textSnapshot: TextSnapshot
    })

export function materializeFileSnapshotText(file: FileSnapshot): string {
  return 'content' in file ? file.content : file.textSnapshot.materializeFullText()
}

export function materializeFileSnapshot(file: FileSnapshot): FileResult {
  if ('content' in file) return file
  const { textSnapshot, ...metadata } = file
  return { ...metadata, content: textSnapshot.materializeFullText() }
}
