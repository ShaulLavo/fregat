import type { EditorTextBuffer } from '@singapore-editor/core/document'
import type { LanguageServerDocumentSnapshot } from './types'

export function bufferDocumentSnapshot({
  buffer,
  documentId,
  uri,
  languageId,
}: {
  readonly buffer: EditorTextBuffer
  readonly documentId?: string
  readonly uri: string
  readonly languageId: string
}): LanguageServerDocumentSnapshot {
  const textSnapshot = buffer.getTextSnapshot()
  const point = buffer.getDocumentSyncPoint()
  const lineStartsView = {
    length: textSnapshot.lineCount,
    at: (index: number) =>
      index < 0 || index >= textSnapshot.lineCount ? undefined : textSnapshot.lineStart(index),
    indexForOffset: (offset: number) => textSnapshot.lineAt(offset),
    firstIndexAtOrAfter: (offset: number) => {
      const index = textSnapshot.lineAt(offset)
      return textSnapshot.lineStart(index) < offset ? index + 1 : index
    },
    toArray: () =>
      Array.from({ length: textSnapshot.lineCount }, (_, index) => textSnapshot.lineStart(index)),
  }
  return {
    documentId: documentId ?? uri,
    languageId,
    textSnapshot,
    textVersion: point.textVersion,
    documentSyncPoint: point,
    changesSinceDocumentSyncPoint: (previous, scope) =>
      buffer.changesSinceDocumentSyncPoint(previous, scope),
    lineStartsView,
    get lineStarts() {
      return lineStartsView.toArray()
    },
  }
}
