import type { Editor } from '@singapore-editor/core/editor'
import { editorTokens, editorView, viewState } from './state.ts'
export function installProjections(editor: Editor) {
  const snapshot = editor.getTextSnapshot()
  const step = Math.max(1, Math.floor(snapshot.lineCount / 10_000))
  const tokens = []
  for (let line = 1; line < snapshot.lineCount; line += step) {
    const start = snapshot.lineStart(line)
    tokens.push({ start, end: start + 5, style: { color: 'red' } })
  }
  editor.setTokens(tokens)
  const fold = {
    startIndex: snapshot.lineStart(20),
    endIndex: snapshot.lineStart(31) - 1,
    startLine: 20,
    endLine: 30,
    type: 'block',
  }
  editor.setSyntaxFolds([fold])
  editor.fold(fold.startIndex)
  return { tokens, fold }
}

export function inspectProjections(
  editor: Editor,
  initial: ReturnType<typeof installProjections> | null,
  delta = 7,
) {
  if (!initial) return null
  const tokens = editorTokens(editor).toTokens()
  const markers = viewState(editorView(editor)).foldMarkers
  const tokensCorrect =
    tokens.length === initial.tokens.length &&
    tokens.every((token, index) => {
      const before = initial.tokens[index]
      return token.start === before.start + delta && token.end === before.end + delta
    })
  const foldCorrect =
    markers.length === 1 &&
    markers[0].collapsed &&
    markers[0].startOffset === initial.fold.startIndex + delta &&
    markers[0].endOffset === initial.fold.endIndex + delta &&
    markers[0].startRow === initial.fold.startLine + 1 &&
    markers[0].endRow === initial.fold.endLine + 1
  return {
    inputTokens: initial.tokens.length,
    retainedTokens: tokens.length,
    tokensCorrect,
    collapsedFolds: markers.filter((marker) => marker.collapsed).length,
    foldCorrect,
  }
}
