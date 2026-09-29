import { createEditorCapabilityToken } from '../plugins'

export const EDITOR_FIND_FEATURE_ID = 'editor.find'

/** A provider also registers the `findVisible` keymap context key, which Escape and the toggles need. */
export type EditorFindFeature = {
  openFind(): boolean
  toggleFind(): boolean
  openFindReplace(): boolean
  closeFind(): boolean
  findNext(): boolean
  findPrevious(): boolean
  replaceOne(): boolean
  replaceAll(): boolean
  selectAllMatches(): boolean
}

export const EDITOR_FIND_FEATURE =
  createEditorCapabilityToken<EditorFindFeature>(EDITOR_FIND_FEATURE_ID)
