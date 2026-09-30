import { el } from './dom.ts'

export type EditorPane = {
  readonly element: HTMLDivElement
  readonly editorHost: HTMLDivElement
}

export function createEditorPane(): EditorPane {
  const element = el('div', { id: 'editor-container' })
  const editorHost = el('div', { id: 'editor-host' })
  element.append(editorHost)

  return {
    element,
    editorHost,
  }
}
