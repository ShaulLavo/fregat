import * as monaco from 'monaco-editor/editor/editor.api'
import 'monaco-editor/languages/definitions/typescript/register'
import Worker from 'monaco-editor/editor/editor.worker?worker'

self.MonacoEnvironment = { getWorker: () => new Worker() }

export function mount(host, text, highlighted) {
  const editor = monaco.editor.create(host, {
    value: text,
    language: highlighted ? 'typescript' : 'plaintext',
    fontSize: 14,
    fontFamily: 'monospace',
    lineHeight: 20,
    minimap: { enabled: false },
    wordWrap: 'off',
    automaticLayout: false,
    lineNumbers: 'off',
    folding: false,
    glyphMargin: false,
    renderLineHighlight: 'none',
    scrollBeyondLastLine: false,
    // Keep lexical highlighting on beyond Monaco's default large-file cutoff.
    largeFileOptimizations: false,
  })
  const model = editor.getModel()
  return {
    slice: (from, to) =>
      model.getValueInRange({
        startLineNumber: model.getPositionAt(from).lineNumber,
        startColumn: model.getPositionAt(from).column,
        endLineNumber: model.getPositionAt(to).lineNumber,
        endColumn: model.getPositionAt(to).column,
      }),
    length: () => model.getValueLength(),
    position(offset) {
      const pos = model.getPositionAt(offset)
      editor.setPosition(pos)
      editor.revealPositionInCenter(pos)
      editor.focus()
    },
    scroll(top) {
      editor.setScrollTop(top)
    },
    scrollTop: () => editor.getScrollTop(),
    highlighted: () =>
      [...host.querySelectorAll('.view-line span')].some((node) =>
        /mtk[2-9]|mtk\d{2}/.test(node.className),
      ),
    viewport: () => host.querySelector('.monaco-scrollable-element'),
    rowCount: () => host.querySelectorAll('.view-line').length,
    facts: () => ({
      language: model.getLanguageId(),
      largeFileOptimizations: false,
      tooLargeForTokenization: model.isTooLargeForTokenization?.() ?? null,
    }),
  }
}
