import '@singapore-editor/core/style.css'
import { Editor } from '@singapore-editor/core/editor'
import { typeScript, html, markdown } from '@singapore-editor/tree-sitter-languages'

export function mount(host, text, highlighted) {
  const corpus = new URLSearchParams(location.search).get('corpus')
  const language = corpus === 'html' || corpus === 'markdown' ? corpus : 'typescript'
  const plugin = highlighted ? { typescript: typeScript, html, markdown }[language] : null
  const editor = new Editor(host, {
    plugins: highlighted ? [plugin()] : [],
    fontSize: 14,
    fontFamily: 'monospace',
    lineHeight: 20,
  })
  editor.setText(text, { languageId: highlighted ? language : null })
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
        ([name, ranges]) =>
          name.startsWith('editor-shared-token-') &&
          [...ranges].some((range) => host.contains(range.startContainer)),
      ),
    viewport: () => host.querySelector('.editor-virtualized'),
    rowCount: () => host.querySelectorAll('.editor-virtualized-row:not([hidden])').length,
    dispose: () => editor.dispose(),
    snapshot: () => editor.getTextSnapshot(),
    edit: (from, to, text) => editor.edit({ from, to, text }),
    reset: (text) => editor.setText(text, { languageId: language }),
    facts: () => editor.getState(),
  }
}
