import * as monaco from 'monaco-editor/editor/editor.api'
import 'monaco-editor/languages/definitions/typescript/register'
import { language } from 'monaco-editor/languages/definitions/typescript/typescript'
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
  let fullHighlight
  return {
    fullHighlight() {
      monaco.languages.setMonarchTokensProvider('typescript', language)
      const start = performance.now()
      const lines = monaco.editor.tokenize(text, 'typescript')
      const elapsedMs = performance.now() - start
      const spans = lines.reduce((sum, tokens) => sum + tokens.length, 0)
      if (
        lines.length !== text.split('\n').length ||
        !lines.some((tokens) => tokens.some((token) => token.type))
      )
        throw new RangeError('Incomplete Monaco lexical highlight')
      fullHighlight = { engine: 'Monarch TypeScript', elapsedMs, spans, lines: lines.length }
    },
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
      fullHighlight,
      largeFileOptimizations: false,
      tooLargeForTokenization: model.isTooLargeForTokenization?.() ?? null,
    }),
  }
}
