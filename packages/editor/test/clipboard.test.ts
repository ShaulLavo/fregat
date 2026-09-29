import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Editor } from '../src/editor'
import { createDocumentSession } from '../src/public/document'
import { setHighlightRegistry } from '../src/public/testing'
import { resolveSelection } from '../src/selections'

// The clipboard is reached through events the browser fires, never through the editor's own API,
// so every case here dispatches copy/cut/paste at the element the keystroke would land on.

// happy-dom doesn't provide the Highlight constructor, so we polyfill it.
class MockHighlight extends Set<Range> {}

const mockRegistry = {
  set: () => undefined,
  delete: () => true,
}

describe('clipboard', () => {
  let container: HTMLElement
  let editor: Editor

  beforeEach(() => {
    // @ts-expect-error — see MockHighlight above.
    globalThis.Highlight = MockHighlight
    setHighlightRegistry(mockRegistry)
    container = document.createElement('div')
    document.body.appendChild(container)
    editor = new Editor(container, { defaultText: '' })
    editor.focus()
  })

  afterEach(() => {
    editor.dispose()
    container.remove()
    setHighlightRegistry(undefined)
  })

  describe('cut', () => {
    it('takes the selection out of the document and onto the clipboard', () => {
      const clipboard = createClipboard()
      editor.setText('alpha beta')
      editor.setSelection(6, 10)

      clipboard.cut()

      expect(clipboard.text()).toBe('beta')
      expect(editor.materializeFullText()).toBe('alpha ')
      // No browser offers the gesture over an element it considers unwritable, so the handler
      // above would never be reached if the focused input were left read-only.
      expect(editorInput().readOnly).toBe(false)
    })

    it('takes the whole line when nothing is selected', () => {
      const clipboard = createClipboard()
      editor.setText('one\ntwo\nthree')
      editor.setSelection(5, 5)

      clipboard.cut()

      expect(clipboard.text()).toBe('two\n')
      expect(editor.materializeFullText()).toBe('one\nthree')
    })

    it('takes nothing from a document that cannot be edited', () => {
      const clipboard = createClipboard()
      editor.setText('alpha beta')
      editor.setSelection(6, 10)
      editor.setEditability('readonly')

      clipboard.cut()

      // Handing the text out and then failing to remove it would be a copy the user asked to be
      // destructive, so the gesture has to stop before the clipboard is written, not after.
      expect(clipboard.text()).toBe('')
      expect(editor.materializeFullText()).toBe('alpha beta')
    })
  })

  describe('copy', () => {
    it('takes a line once for every caret standing on it', () => {
      const clipboard = createClipboard()
      const session = createDocumentSession('alpha beta')
      session.setSelections([
        { anchor: 2, head: 2 },
        { anchor: 7, head: 7 },
      ])
      editor.attachSession(session)

      clipboard.copy()

      expect(clipboard.text()).toBe('alpha beta\n')
    })
  })

  // Markup travels beside the text, never instead of it: a target with no use for it reads the
  // text/plain the cases above are about.
  describe('copy as html', () => {
    it('carries the copied range as the markup it was being read in', () => {
      const clipboard = createClipboard()
      editor.setText('const x = 1')
      editor.setTokens([{ start: 0, end: 5, style: { color: '#569cd6' } }])
      editor.setSelection(0, 7)

      clipboard.copy()

      expect(clipboard.html()).toContain('<span style="color: #569cd6;">const</span>')
      expect(clipboard.text()).toBe('const x')
    })

    it('takes the line a caret is standing on, without the terminator that would paste blank', () => {
      const clipboard = createClipboard()
      editor.setText('alpha\nbeta')
      editor.setTokens([{ start: 6, end: 10, style: { color: '#569cd6' } }])
      editor.setSelection(8, 8)

      clipboard.copy()

      expect(clipboard.html()).toContain('>beta</span>')
      expect(clipboard.html()).not.toContain('\n')
      expect(clipboard.text()).toBe('beta\n')
    })

    it('writes no markup for a document nothing has highlighted', () => {
      const clipboard = createClipboard()
      editor.setText('const x = 1')
      editor.setSelection(0, 7)

      clipboard.copy()

      expect(clipboard.html()).toBe('')
      expect(clipboard.text()).toBe('const x')
    })

    it('styles multiple selections with the same separators as plain text', () => {
      const clipboard = createClipboard()
      const session = createDocumentSession('const x = 1')
      session.setSelections([
        { anchor: 0, head: 5 },
        { anchor: 6, head: 7 },
      ])
      editor.attachSession(session)
      editor.setTokens([{ start: 0, end: 5, style: { color: '#569cd6' } }])

      clipboard.copy()

      expect(clipboard.html()).toContain('<span style="color: #569cd6;">const</span>\nx')
      expect(clipboard.text()).toBe('const\nx')
    })

    it('omits projected syntax until current-revision tokens arrive', () => {
      const clipboard = createClipboard()
      editor.setText('const x = 1\nconst y = 2')
      editor.setTokens([{ start: 0, end: 5, style: { color: '#569cd6' } }])
      editor.edit({ from: 0, to: 0, text: '/*' })
      editor.setSelection(2, 7)
      clipboard.copy()
      expect(clipboard.text()).toBe('const')
      expect(clipboard.html()).toBe('')
      editor.setTokens([{ start: 2, end: 7, style: { color: '#123456' } }])
      clipboard.copy()
      expect(clipboard.html()).toContain('color: #123456')
    })

    it('writes no markup for a payload past the size cap', () => {
      const clipboard = createClipboard()
      const text = 'x'.repeat(65537)
      editor.setText(text)
      editor.setTokens([{ start: 0, end: 5, style: { color: '#569cd6' } }])
      editor.setSelection(0, text.length)

      clipboard.copy()

      expect(clipboard.html()).toBe('')
      expect(clipboard.text()).toBe(text)
    })
  })

  describe('paste', () => {
    it('hands every cursor back the fragment it copied', () => {
      const clipboard = createClipboard()
      const session = createDocumentSession('one two three\nA B C')
      session.setSelections([
        { anchor: 0, head: 3 },
        { anchor: 4, head: 7 },
        { anchor: 8, head: 13 },
      ])
      editor.attachSession(session)
      clipboard.copy()
      session.setSelections([
        { anchor: 14, head: 15 },
        { anchor: 16, head: 17 },
        { anchor: 18, head: 19 },
      ])

      clipboard.paste()

      expect(editor.materializeFullText()).toBe('one two three\none two three')
      expect(selectionHeads(session)).toEqual([17, 21, 27])
    })

    it('recognizes its own payload when the clipboard keeps only the text', () => {
      const clipboard = createClipboard()
      const session = createDocumentSession('one two three\nA B C')
      session.setSelections([
        { anchor: 0, head: 3 },
        { anchor: 4, head: 7 },
        { anchor: 8, head: 13 },
      ])
      editor.attachSession(session)
      clipboard.copy()
      clipboard.stripEditorTypes()
      session.setSelections([
        { anchor: 14, head: 15 },
        { anchor: 16, head: 17 },
        { anchor: 18, head: 19 },
      ])

      clipboard.paste()

      expect(editor.materializeFullText()).toBe('one two three\none two three')
    })

    it('recognizes a payload this process has since copied over', () => {
      const carried = createClipboard()
      const later = createClipboard()
      const session = createDocumentSession('one two three\nA B C')
      session.setSelections([
        { anchor: 0, head: 3 },
        { anchor: 4, head: 7 },
        { anchor: 8, head: 13 },
      ])
      editor.attachSession(session)
      carried.copy()
      // What a second window does between the copy and the paste: the payload the process last put
      // out is no longer this one, so only what travels on the clipboard itself can identify it.
      session.setSelections([{ anchor: 14, head: 19 }])
      later.copy()
      session.setSelections([
        { anchor: 14, head: 15 },
        { anchor: 16, head: 17 },
        { anchor: 18, head: 19 },
      ])

      carried.paste()

      expect(editor.materializeFullText()).toBe('one two three\none two three')
    })

    it('ignores a payload another application left under the same type', () => {
      const clipboard = createClipboard()
      clipboard.write('text/plain', 'p\nq\nr')
      // Nothing stops another application from claiming the type, and what it writes there is its
      // own shape, so a payload that is not a list of fragments is not one.
      clipboard.write('application/x-editor-clipboard', JSON.stringify({ perSelection: [1, 2, 3] }))
      const session = createDocumentSession('A B C')
      session.setSelections([
        { anchor: 0, head: 1 },
        { anchor: 2, head: 3 },
        { anchor: 4, head: 5 },
      ])
      editor.attachSession(session)

      clipboard.paste()

      expect(editor.materializeFullText()).toBe('p\nq\nr p\nq\nr p\nq\nr')
    })

    it('gives every cursor the whole payload once their count no longer matches', () => {
      const clipboard = createClipboard()
      const session = createDocumentSession('one two three\nA B C')
      session.setSelections([
        { anchor: 0, head: 3 },
        { anchor: 4, head: 7 },
        { anchor: 8, head: 13 },
      ])
      editor.attachSession(session)
      clipboard.copy()
      session.setSelections([
        { anchor: 14, head: 15 },
        { anchor: 16, head: 17 },
      ])

      clipboard.paste()

      expect(editor.materializeFullText()).toBe('one two three\none\ntwo\nthree one\ntwo\nthree C')
    })

    it('lands a payload copied off a caret as a line of its own', () => {
      const clipboard = createClipboard()
      editor.setText('alpha\nbeta')
      editor.setSelection(8, 8)
      clipboard.copy()
      editor.setSelection(2, 2)

      clipboard.paste()

      expect(editor.materializeFullText()).toBe('beta\nalpha\nbeta')
      expect(editor.getState().cursor).toEqual({ row: 1, column: 0 })
    })

    // A payload taken off several carets is line-shaped and one fragment per caret at the same
    // time. Read as only the first of those, every caret takes the whole payload — which grows the
    // document by the square of the cursor count and puts each line back in several places.
    it('hands every caret back the line it copied', () => {
      const clipboard = createClipboard()
      const session = createDocumentSession('one\ntwo\nthree')
      session.setSelections([
        { anchor: 0, head: 0 },
        { anchor: 4, head: 4 },
      ])
      editor.attachSession(session)
      clipboard.copy()

      clipboard.paste()

      expect(editor.materializeFullText()).toBe('one\none\ntwo\ntwo\nthree')
      expect(selectionHeads(session)).toEqual([4, 12])
    })

    // The fragments were taken off whole lines, so they go back at line starts: spliced in where
    // the caret happens to stand, a line lands in the middle of the word the caret is in.
    it('lands each fragment at the start of its caret line rather than at the caret', () => {
      const clipboard = createClipboard()
      const session = createDocumentSession('one\ntwo\nthree')
      session.setSelections([
        { anchor: 1, head: 1 },
        { anchor: 5, head: 5 },
      ])
      editor.attachSession(session)
      clipboard.copy()

      clipboard.paste()

      expect(editor.materializeFullText()).toBe('one\none\ntwo\ntwo\nthree')
    })

    it('leaves every caret on its own line once the lines above it have grown', () => {
      const clipboard = createClipboard()
      const session = createDocumentSession('one\ntwo\nthree')
      session.setSelections([{ anchor: 0, head: 0 }])
      editor.attachSession(session)
      clipboard.copy()
      session.setSelections([
        { anchor: 4, head: 4 },
        { anchor: 8, head: 8 },
      ])

      clipboard.paste()

      expect(editor.materializeFullText()).toBe('one\none\ntwo\none\nthree')
      expect(selectionHeads(session)).toEqual([8, 16])
    })
  })
})

/**
 * A clipboard that outlives the events reading and writing it, so a copy and the paste that follows
 * see the same data — including the types the editor puts there for itself.
 */
function createClipboard(): {
  readonly copy: () => void
  readonly cut: () => void
  readonly html: () => string
  readonly paste: () => void
  readonly stripEditorTypes: () => void
  readonly text: () => string
  readonly write: (format: string, value: string) => void
} {
  const values = new Map<string, string>()
  const clipboardData = {
    getData: (format: string): string => values.get(format) ?? '',
    setData: (format: string, value: string): void => {
      values.set(format, value)
    },
  }

  const dispatch = (type: string): void => {
    const event = new Event(type, { bubbles: true, cancelable: true }) as ClipboardEvent
    Object.defineProperty(event, 'clipboardData', { configurable: true, value: clipboardData })
    editorInput().dispatchEvent(event)
  }

  return {
    copy: () => dispatch('copy'),
    cut: () => dispatch('cut'),
    paste: () => dispatch('paste'),
    // What a clipboard that sanitizes types it does not know leaves behind.
    stripEditorTypes: () => {
      const text = values.get('text/plain') ?? ''
      values.clear()
      values.set('text/plain', text)
    },
    html: () => values.get('text/html') ?? '',
    text: () => values.get('text/plain') ?? '',
    write: (format: string, value: string) => {
      values.set(format, value)
    },
  }
}

function selectionHeads(session: ReturnType<typeof createDocumentSession>): readonly number[] {
  return session
    .getSelections()
    .selections.map((selection) => resolveSelection(session.getSnapshot(), selection).headOffset)
}

function editorInput(): HTMLTextAreaElement {
  return document.querySelector('.editor-virtualized-input') as HTMLTextAreaElement
}
