import type { TextEdit } from '../tokens'
import type { EditorEditInput } from './types'

export function normalizeEditorEditInput(editOrEdits: EditorEditInput): readonly TextEdit[] {
  if (isEditorEditList(editOrEdits)) return editOrEdits
  return [editOrEdits]
}

function isEditorEditList(editOrEdits: EditorEditInput): editOrEdits is readonly TextEdit[] {
  return Array.isArray(editOrEdits)
}
