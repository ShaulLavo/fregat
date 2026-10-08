import { Editor } from '@singapore-editor/core/editor'
import '@singapore-editor/core/style.css'

export function mountEditor(element: HTMLElement): Editor {
  const editor = new Editor(element)
  editor.setText('const greeting = "Hello, Singapore"\n')
  return editor
}
