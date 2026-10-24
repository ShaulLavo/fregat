import { createStringTextSnapshot } from '@singapore-editor/core/document'
import { arrayLspLineStarts, type LspWorkspace } from '@singapore-editor/lsp'

export function syncedDocument(workspace: LspWorkspace | undefined, uri: string, text: string) {
  if (!workspace) throw new Error('missing connected workspace')

  const sourceSegment = {}
  const textSnapshot = createStringTextSnapshot(text)
  let sourceRevision = 0
  let length = text.length
  workspace.openDocumentSnapshot({
    languageId: 'typescript',
    lineStarts: arrayLspLineStarts([0]),
    sourceRevision,
    sourceSegment,
    textSnapshot,
    uri,
  })

  return {
    textSnapshot,
    replace(nextText: string) {
      sourceRevision += 1
      workspace.updateDocumentSnapshot(uri, {
        edits: [{ from: 0, text: nextText, to: length }],
        lineStarts: arrayLspLineStarts([0]),
        logicalRevisionCount: 1,
        sourceRevision,
        sourceSegment,
        textSnapshot: createStringTextSnapshot(nextText),
      })
      length = nextText.length
    },
  }
}
