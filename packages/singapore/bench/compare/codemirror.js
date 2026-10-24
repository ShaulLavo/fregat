import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { basicSetup } from 'codemirror'
import { highlightTree, classHighlighter } from '@lezer/highlight'
import { javascript } from '@codemirror/lang-javascript'

export function mount(host, text, highlighted) {
  const view = new EditorView({
    parent: host,
    state: EditorState.create({
      doc: text,
      extensions: (highlighted ? [basicSetup] : []).concat(
        highlighted ? [javascript({ typescript: true })] : [],
        [
          EditorView.theme({
            '&': { fontSize: '14px' },
            '.cm-scroller': { fontFamily: 'monospace', lineHeight: '20px' },
            '.cm-gutters': { display: 'none' },
          }),
        ],
      ),
    }),
  })
  let fullHighlight
  return {
    fullHighlight() {
      const start = performance.now()
      const tree = javascript({ typescript: true }).language.parser.parse(text)
      const parseMs = performance.now() - start
      let spans = 0
      const queryStart = performance.now()
      highlightTree(tree, classHighlighter, () => spans++)
      if (tree.length !== text.length || spans === 0)
        throw new RangeError('Incomplete Lezer highlight')
      fullHighlight = {
        engine: 'Lezer TypeScript',
        parseMs,
        highlightMs: performance.now() - queryStart,
        spans,
        length: tree.length,
      }
    },
    slice: (from, to) => view.state.doc.sliceString(from, to),
    length: () => view.state.doc.length,
    position(offset) {
      view.dispatch({
        selection: { anchor: offset },
        effects: EditorView.scrollIntoView(offset, { y: 'center' }),
      })
      view.focus()
    },
    scroll(top) {
      view.scrollDOM.scrollTop = top
    },
    scrollTop: () => view.scrollDOM.scrollTop,
    highlighted: () => !!host.querySelector('.cm-line span[class]'),
    viewport: () => view.scrollDOM,
    rowCount: () => host.querySelectorAll('.cm-line').length,
    facts: () => ({
      language: highlighted ? 'Lezer TypeScript' : 'plain',
      basicSetup: highlighted,
      fullHighlight,
    }),
  }
}
