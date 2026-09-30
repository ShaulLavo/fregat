import type { Editor } from '@singapore-editor/core/editor'
import type { EditorTokenStore } from '../src/syntax/tokenStore.ts'
import type { VirtualizedTextView } from '../src/virtualization/virtualizedTextView.ts'
import type { VirtualizedTextViewInternal } from '../src/virtualization/virtualizedTextViewInternals.ts'

export function editorView(editor: Editor): VirtualizedTextView {
  const view: VirtualizedTextView = Reflect.get(editor, 'view')
  return view
}
export function viewState(view: VirtualizedTextView): VirtualizedTextViewInternal {
  const state: VirtualizedTextViewInternal = Reflect.get(view, 'view')
  return state
}
export function editorTokens(editor: Editor): EditorTokenStore {
  const tokens: EditorTokenStore = Reflect.get(editor, 'tokens')
  return tokens
}
