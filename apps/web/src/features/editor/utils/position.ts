import type { TextSnapshot } from '@singapore-editor/core/document'
import type { LanguageServerDefinitionTarget } from '@singapore-editor/lsp-plugin/websocket'

export function selectionForDefinition(
  filePath: string,
  textSnapshot: TextSnapshot,
  target: LanguageServerDefinitionTarget | null | undefined,
) {
  if (!target) return null
  if (target.path !== filePath) return null

  const anchor = offsetForPosition(textSnapshot, target.range.start)
  const head = offsetForPosition(textSnapshot, target.range.end)
  return { anchor, head }
}

function offsetForPosition(
  textSnapshot: TextSnapshot,
  position: LanguageServerDefinitionTarget['range']['start'],
) {
  const lineStart = textSnapshot.lineStart(position.line)
  return Math.min(textSnapshot.length, lineStart + position.character)
}
