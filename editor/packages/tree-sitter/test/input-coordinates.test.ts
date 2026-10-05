import { expect, it } from 'vitest'
import { createEditorTextBuffer, type TextReadSnapshot } from '@singapore-editor/core/document'
import { createTreeSitterEditPayload } from '../src/session'

it('computes descending sparse edit coordinates from bounded UTF-16 reads and inserted LF text', () => {
  const snapshot = createEditorTextBuffer('α😀\r\nold tail\r\nlast').getTextSnapshot()
  const read: TextReadSnapshot = {
    length: snapshot.length,
    lineCount: snapshot.lineCount,
    lineAt: (offset) => snapshot.lineAt(offset),
    lineStart: (line) => snapshot.lineStart(line),
    lineRange: (line) => snapshot.lineRange(line),
    readRange: () => {
      throw new TypeError('Coordinates require no document text copy')
    },
    forEachTextChunk: () => {
      throw new TypeError('Coordinates require no document scan')
    },
  }
  const source = {
    identity: {
      documentId: 'coordinates',
      documentGeneration: 1,
      endpointGeneration: 1,
      registrationId: 1,
    },
    point: { segment: 'issued', revision: 1, textVersion: 1 },
    readId: 'pin',
  }
  const payload = createTreeSitterEditPayload({
    documentId: 'coordinates.ts',
    runtimeSessionId: 'parser',
    languageId: 'typescript',
    previousSnapshotVersion: 1,
    snapshotVersion: 2,
    previousRead: read,
    source,
    edits: [
      { from: 4, to: 7, text: '{\n  "🪐"\n}' },
      { from: 13, to: 17, text: 'done😀' },
    ],
  })
  expect(payload?.inputEdits).toEqual([
    {
      startIndex: 13,
      oldEndIndex: 17,
      newEndIndex: 19,
      startPosition: { row: 2, column: 0 },
      oldEndPosition: { row: 2, column: 4 },
      newEndPosition: { row: 2, column: 6 },
    },
    {
      startIndex: 4,
      oldEndIndex: 7,
      newEndIndex: 14,
      startPosition: { row: 1, column: 0 },
      oldEndPosition: { row: 1, column: 3 },
      newEndPosition: { row: 3, column: 1 },
    },
  ])
})
