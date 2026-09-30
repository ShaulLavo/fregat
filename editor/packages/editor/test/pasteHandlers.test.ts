import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { Editor } from '../src/editor'
import { createDocumentSession } from '../src/public/document'
import {
  EDITOR_PASTE_HANDLER,
  type EditorLanguageFeatureSelector,
  type EditorPasteContext,
  type EditorPasteHandler,
  type EditorPlugin,
  type EditorSelectionRange,
} from '../src/plugins'
import { setHighlightRegistry } from '../src/public/testing'
import { createVisibleEditor } from './factories/visibleEditor'

/**
 * A paste reaching something other than the text/plain path: a handler registers for the types it
 * can read, and the transfer the browser delivered is what it gets asked about. Everything here
 * goes in through a real paste event on the element the keystroke lands on, because a handler no
 * gesture can reach is the failure this is guarding against.
 */

class MockHighlight extends Set<Range> {}

/** An attached editor, reachable the two ways every case below needs it. */
type Opened = {
  readonly select: (...ranges: readonly EditorSelectionRange[]) => void
  readonly text: () => string
}

const mockRegistry = {
  delete: () => true,
  set: () => undefined,
}

let container: HTMLElement
let editor: Editor | null = null

beforeEach(() => {
  // @ts-expect-error — happy-dom has no Highlight constructor.
  globalThis.Highlight = MockHighlight
  setHighlightRegistry(mockRegistry)
  container = document.createElement('div')
  document.body.appendChild(container)
})

afterEach(() => {
  editor?.dispose()
  editor = null
  container.remove()
  setHighlightRegistry(undefined)
})

function open(text: string, languageId: string, plugins: readonly EditorPlugin[] = []): Opened {
  const created = createVisibleEditor(container, { plugins })
  editor = created
  const session = createDocumentSession(text)
  created.attachSession(session, { documentId: `doc.${languageId}`, languageId })
  created.focus()

  return {
    select: (...ranges) => session.setSelections(ranges),
    text: () => created.materializeFullText(),
  }
}

describe('paste handlers', () => {
  it('hands a claimed paste to the handler that named the type it arrived under', () => {
    const opened = open('abc', 'typescript', [
      pasteHandlerPlugin({
        handlePaste: (context) =>
          context.targets.map(() => `<${context.dataTransfer.getData('text/uri-list')}>`),
        mimeTypes: ['text/uri-list'],
      }),
    ])
    opened.select({ anchor: 0, head: 0 })

    paste({ 'text/plain': 'https://example.com', 'text/uri-list': 'https://example.com' })

    expect(opened.text()).toBe('<https://example.com>abc')
  })

  it('never asks a handler about a transfer carrying none of its types', () => {
    const asked: string[] = []
    const opened = open('abc', 'typescript', [
      pasteHandlerPlugin({
        handlePaste: (context) => {
          asked.push(context.text)
          return context.targets.map(() => 'CLAIMED')
        },
        mimeTypes: ['image/png'],
      }),
    ])
    opened.select({ anchor: 0, head: 0 })

    paste({ 'text/plain': 'plain' })

    expect(asked).toEqual([])
    expect(opened.text()).toBe('plainabc')
  })

  it('asks the handler that named the language before one that took every document', () => {
    const opened = open('abc', 'markdown', [
      pasteHandlerPlugin(constantHandler('WILDCARD'), { language: '*' }),
      pasteHandlerPlugin(constantHandler('LANGUAGE'), { language: 'markdown' }),
    ])
    opened.select({ anchor: 0, head: 0 })

    paste({ 'text/plain': 'x' })

    expect(opened.text()).toBe('LANGUAGEabc')
  })

  it('gives every caret the fragment the handler wrote for it', () => {
    const opened = open('a b', 'typescript', [
      pasteHandlerPlugin({
        handlePaste: (context) => context.targets.map((target, index) => `${index}${target.text}`),
        mimeTypes: ['text/plain'],
      }),
    ])
    opened.select({ anchor: 0, head: 1 }, { anchor: 2, head: 3 })

    paste({ 'text/plain': 'x' })

    expect(opened.text()).toBe('0a 1b')
  })

  // The same reading a carried multi-cursor payload is refused for: a list that does not describe
  // these carets would be scattered across them rather than distributed.
  it('declines a list that does not have one fragment per caret', () => {
    const opened = open('a b', 'typescript', [
      pasteHandlerPlugin({
        handlePaste: () => ['only-one'],
        mimeTypes: ['text/plain'],
      }),
    ])
    opened.select({ anchor: 0, head: 1 }, { anchor: 2, head: 3 })

    paste({ 'text/plain': 'x' })

    expect(opened.text()).toBe('x x')
  })

  it('describes the transfer to the handler rather than the text it flattens to', () => {
    let seen: EditorPasteContext | null = null
    const opened = open('alpha beta', 'typescript', [
      pasteHandlerPlugin({
        handlePaste: (context) => {
          seen = context
          return null
        },
        mimeTypes: ['text/html'],
      }),
    ])
    opened.select({ anchor: 0, head: 5 })

    paste({ 'text/html': '<b>x</b>', 'text/plain': 'x' })

    const context = seen as EditorPasteContext | null
    expect(context?.types).toContain('text/html')
    expect(context?.text).toBe('x')
    expect(context?.languageId).toBe('typescript')
    expect(context?.internal).toBe(false)
    expect(context?.targets).toEqual([{ end: 5, start: 0, text: 'alpha' }])
  })

  it('tells a handler when the payload came out of an editor in this process', () => {
    const internal: boolean[] = []
    const opened = open('alpha beta', 'typescript', [
      pasteHandlerPlugin({
        handlePaste: (context) => {
          internal.push(context.internal)
          return null
        },
        mimeTypes: ['text/plain'],
      }),
    ])
    const clipboard = createClipboard()
    opened.select({ anchor: 0, head: 5 })
    clipboard.copy()
    opened.select({ anchor: 6, head: 10 })

    clipboard.paste()

    expect(internal).toEqual([true])
  })

  it('inserts nothing for a payload nobody claims and no text to fall back to', () => {
    const opened = open('abc', 'typescript')
    opened.select({ anchor: 0, head: 0 })

    paste({}, [imageFile('shot.png')])

    expect(opened.text()).toBe('abc')
  })
})

describe('built-in paste handlers', () => {
  it('turns a URL landing on a word into a link', () => {
    const opened = open('see docs here', 'markdown')
    opened.select({ anchor: 4, head: 8 })

    paste({ 'text/plain': 'https://example.com/a' })

    expect(opened.text()).toBe('see [docs](https://example.com/a) here')
  })

  it("writes the link the way the document's own language does", () => {
    const opened = open('see docs here', 'html')
    opened.select({ anchor: 4, head: 8 })

    paste({ 'text/plain': 'https://example.com/a' })

    expect(opened.text()).toBe('see <a href="https://example.com/a">docs</a> here')
  })

  // A caret is not a label to hang a link on, and the payload copied off one is a whole line:
  // claiming it here would splice that line into the middle of the word the caret is standing in.
  it('leaves a URL landing on a caret to the paste it would otherwise have been', () => {
    const clipboard = createClipboard()
    const opened = open('alpha\nhttps://example.com/a', 'markdown')
    opened.select({ anchor: 8, head: 8 })
    clipboard.copy()
    opened.select({ anchor: 2, head: 2 })

    clipboard.paste()

    expect(opened.text()).toBe('https://example.com/a\nalpha\nhttps://example.com/a')
  })

  it('leaves a language with no syntax for a link to paste the URL as text', () => {
    const opened = open('see docs here', 'typescript')
    opened.select({ anchor: 4, head: 8 })

    paste({ 'text/plain': 'https://example.com/a' })

    expect(opened.text()).toBe('see https://example.com/a here')
  })

  it('leaves text that is not a URL alone', () => {
    const opened = open('see docs here', 'markdown')
    opened.select({ anchor: 4, head: 8 })

    paste({ 'text/plain': 'notes' })

    expect(opened.text()).toBe('see notes here')
  })

  it('names a pasted image where the document has a way to refer to one', () => {
    const opened = open('', 'markdown')
    opened.select({ anchor: 0, head: 0 })

    paste({}, [imageFile('shot.png')])

    expect(opened.text()).toBe('![shot.png](shot.png)')
  })

  it('leaves a transfer that also carries text to the text the user was looking at', () => {
    const opened = open('', 'markdown')
    opened.select({ anchor: 0, head: 0 })

    paste({ 'text/plain': '/assets/shot.png' }, [imageFile('shot.png')])

    expect(opened.text()).toBe('/assets/shot.png')
  })

  it('links rather than embeds a file that is not an image', () => {
    const opened = open('', 'markdown')
    opened.select({ anchor: 0, head: 0 })

    paste({}, [new File([new Uint8Array([0])], 'notes.pdf', { type: 'application/pdf' })])

    expect(opened.text()).toBe('[notes.pdf](notes.pdf)')
  })

  it('lets a host get in front of what the editor ships', () => {
    const opened = open('', 'markdown', [
      pasteHandlerPlugin(constantHandler('![](uploads/shot.png)'), { language: '*' }),
    ])
    opened.select({ anchor: 0, head: 0 })

    paste({}, [imageFile('shot.png')])

    expect(opened.text()).toBe('![](uploads/shot.png)')
  })
})

/**
 * The other gesture that arrives as a transfer, and the one whose caret has to be taken back down
 * by hand: the element a drop lands on is the one element a browser never fires dragleave at.
 */
describe('drop', () => {
  it('takes its aiming caret back down when the transfer carries nothing to insert', () => {
    const opened = open('alpha bravo', 'typescript')
    mockEditorViewport(editorRoot(), 200, 200)
    opened.select({ anchor: 0, head: 0 })

    editorRoot().dispatchEvent(dragEvent('dragover', transferDouble(new Map(), []), 56))

    expect(caretTransform()).toBe('translate(56px, 0px)')

    // An image dragged in from the desktop, which nothing here has registered to read.
    editorRoot().dispatchEvent(
      dragEvent('drop', transferDouble(new Map(), [imageFile('shot.png')]), 56),
    )

    expect(opened.text()).toBe('alpha bravo')
    // Back on the selection, which is the only cursor the document actually has.
    expect(caretTransform()).toBe('translate(0px, 0px)')
  })

  it('leaves the caret on the text a drop it accepted inserted', () => {
    const opened = open('alpha bravo', 'typescript')
    mockEditorViewport(editorRoot(), 200, 200)
    opened.select({ anchor: 0, head: 0 })

    editorRoot().dispatchEvent(dragEvent('dragover', transferDouble(new Map(), []), 56))
    editorRoot().dispatchEvent(
      dragEvent('drop', transferDouble(new Map([['text/plain', 'X']]), []), 56),
    )

    expect(opened.text()).toBe('alpha bXravo')
    expect(caretTransform()).toBe('translate(64px, 0px)')
  })

  it('asks the paste handlers what a drop means, at the caret the drop placed', () => {
    const asked: { source: string; targets: readonly { start: number; end: number }[] }[] = []
    const opened = open('alpha bravo', 'typescript', [
      pasteHandlerPlugin({
        handlePaste: (context) => {
          asked.push({ source: context.source, targets: context.targets })
          return context.targets.map(() => `@${context.text}`)
        },
        mimeTypes: ['text/plain'],
      }),
    ])
    mockEditorViewport(editorRoot(), 200, 200)
    opened.select({ anchor: 0, head: 0 })

    editorRoot().dispatchEvent(
      dragEvent('drop', transferDouble(new Map([['text/plain', 'src/a.ts']]), []), 56),
    )

    expect(asked).toEqual([{ source: 'drop', targets: [{ end: 7, start: 7, text: '' }] }])
    expect(opened.text()).toBe('alpha b@src/a.tsravo')
  })

  it('hands a handler a dropped file that carries no text', () => {
    const opened = open('alpha', 'typescript', [pasteHandlerPlugin(constantHandler('[file]'))])
    mockEditorViewport(editorRoot(), 200, 200)
    opened.select({ anchor: 0, head: 0 })

    editorRoot().dispatchEvent(
      dragEvent('drop', transferDouble(new Map(), [imageFile('shot.png')]), 0),
    )

    expect(opened.text()).toBe('[file]alpha')
  })
})

function constantHandler(text: string): EditorPasteHandler {
  return {
    handlePaste: (context) => context.targets.map(() => text),
    mimeTypes: ['text/plain', 'Files'],
  }
}

function pasteHandlerPlugin(
  handler: EditorPasteHandler,
  selector: EditorLanguageFeatureSelector = { language: '*' },
): EditorPlugin {
  return {
    name: `test.pasteHandler.${selector.language}`,
    activate: (context) =>
      context.registerCapabilityContribution({
        createContribution: (contributed) =>
          contributed.registerProvider(EDITOR_PASTE_HANDLER, selector, handler),
      }),
  }
}

function imageFile(name: string): File {
  return new File([new Uint8Array([0])], name, { type: 'image/png' })
}

function paste(entries: Record<string, string>, files: readonly File[] = []): void {
  dispatch('paste', transferDouble(new Map(Object.entries(entries)), files))
}

/** A clipboard outliving both events, so a paste sees everything the copy before it wrote. */
function createClipboard(): { readonly copy: () => void; readonly paste: () => void } {
  const transfer = transferDouble(new Map(), [])

  return {
    copy: () => dispatch('copy', transfer),
    paste: () => dispatch('paste', transfer),
  }
}

/** Everything the handlers read off a transfer, without a DataTransfer to construct one from. */
function transferDouble(values: Map<string, string>, files: readonly File[]): DataTransfer {
  return {
    files,
    getData: (format: string): string => values.get(format) ?? '',
    setData: (format: string, value: string): void => {
      values.set(format, value)
    },
    // The capitalised entry is the one a browser adds for the files beside the MIME types.
    get types(): readonly string[] {
      return [...values.keys(), ...(files.length > 0 ? ['Files'] : [])]
    },
  } as unknown as DataTransfer
}

function dispatch(type: string, clipboardData: DataTransfer): void {
  const event = new Event(type, { bubbles: true, cancelable: true }) as ClipboardEvent
  Object.defineProperty(event, 'clipboardData', { configurable: true, value: clipboardData })
  editorInput().dispatchEvent(event)
}

function dragEvent(type: string, dataTransfer: DataTransfer, clientX: number): DragEvent {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX,
    clientY: 10,
  }) as DragEvent
  Object.defineProperty(event, 'dataTransfer', { configurable: true, value: dataTransfer })
  return event
}

function editorInput(): HTMLTextAreaElement {
  return document.querySelector('.editor-virtualized-input') as HTMLTextAreaElement
}

function editorRoot(): HTMLElement {
  return document.querySelector('.editor-virtualized') as HTMLElement
}

/** Where the editor is drawing the caret, which is how a drop target shows itself. */
function caretTransform(): string {
  return (document.querySelector('.editor-virtualized-caret') as HTMLElement).style.transform
}

/** happy-dom lays nothing out, so the box a pointer is hit-tested against arrives through here. */
function mockEditorViewport(element: HTMLElement, width: number, height: number): void {
  Object.defineProperty(element, 'clientHeight', { configurable: true, value: height })
  Object.defineProperty(element, 'scrollHeight', { configurable: true, value: height })
  Object.defineProperty(element, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({
      bottom: height,
      height,
      left: 0,
      right: width,
      top: 0,
      width,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }),
  })
}
