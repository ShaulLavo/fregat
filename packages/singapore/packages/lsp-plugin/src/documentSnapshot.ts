import type { EditorTextBuffer, EditorTextBufferChange } from '@singapore-editor/core/document'
import type { LanguageServerDocumentSnapshot } from './types'

export function bufferDocumentSnapshot({
  buffer,
  documentId,
  uri,
  languageId,
  publication,
}: {
  readonly buffer: EditorTextBuffer
  readonly documentId?: string
  readonly uri: string
  readonly languageId: string
  readonly publication?: EditorTextBufferChange
}): LanguageServerDocumentSnapshot {
  const textSnapshot = publication?.change.textSnapshot ?? buffer.getTextSnapshot()
  const point = publication?.syncPointAfter ?? buffer.getDocumentSyncPoint()
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
      publication
        ? publication.changesSinceDocumentSyncPoint(previous, scope)
        : buffer.changesSinceDocumentSyncPoint(previous, scope),
    lineStartsView,
    get lineStarts() {
      return lineStartsView.toArray()
    },
  }
}
