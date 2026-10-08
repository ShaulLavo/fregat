import '@singapore-editor/core/style.css'
import { Editor } from '@singapore-editor/core/editor'
import { typeScript } from '@singapore-editor/tree-sitter-languages'

export function mount(host, text, highlighted) {
  const editor = new Editor(host, {
    plugins: highlighted ? [typeScript()] : [],
    fontSize: 14,
    fontFamily: 'monospace',
    lineHeight: 20,
  })
  editor.setText(text, { languageId: highlighted ? 'typescript' : null })
  return {
    slice: (from, to) => editor.getTextSnapshot().readRange(from, to),
    length: () => editor.getState().length,
    position(offset) {
      editor.setSelection(offset, offset, { reveal: true })
      editor.focus()
    },
    scroll(top) {
      editor.setScrollPosition({ top })
    },
    scrollTop: () => editor.getScrollPosition().top,
    highlighted: () =>
      [...CSS.highlights].some(
        ([name, ranges]) => name.startsWith('editor-shared-token-') && ranges.size > 0,
      ),
    viewport: () => host.querySelector('.editor-virtualized'),
    rowCount: () => host.querySelectorAll('.editor-virtualized-row:not([hidden])').length,
    facts: () => editor.getState(),
  }
}
