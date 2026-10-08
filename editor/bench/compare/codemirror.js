import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { basicSetup } from 'codemirror'
import { javascript } from '@codemirror/lang-javascript'

export function mount(host, text, highlighted) {
  const view = new EditorView({
    parent: host,
    state: EditorState.create({
      doc: text,
      extensions: [
        ...(highlighted ? [basicSetup] : []),
        ...(highlighted ? [javascript({ typescript: true })] : []),
        EditorView.theme({
          '&': { fontSize: '14px' },
          '.cm-scroller': { fontFamily: 'monospace', lineHeight: '20px' },
          '.cm-gutters': { display: 'none' },
        }),
      ],
    }),
  })
  return {
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
    }),
  }
}
