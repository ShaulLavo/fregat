import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { createLineGutterPlugin } from '../../gutters/src/index.ts'
import { Editor } from '../src/editor/Editor'
import { createDocumentSession } from '../src/public/document'
import { resetEditorInstanceCount, setHighlightRegistry } from '../src/public/testing'

/**
 * Composing text with an IME, driven through the listeners the editor installs rather than the view
 * calls behind them.
 *
 * Two things have to be true for a reader typing Japanese, Korean, Chinese or Vietnamese: the
 * characters they are still choosing between have to be on screen, and the list they choose from has
 * to open under them. The OS decides where to open it from the box of the element being typed into,
 * so the hidden input's position is the whole of the second half.
 */

const highlightsMap = new Map<string, unknown>()
const mockRegistry = {
  delete: (name: string) => highlightsMap.delete(name),
  set: (name: string, highlight: unknown) => {
    highlightsMap.set(name, highlight)
  },
}

class MockHighlight extends Set<Range> {}

/** happy-dom lays nothing out, so the viewport the virtualizer works from arrives through here. */
class MockResizeObserver implements ResizeObserver {
  static instances: MockResizeObserver[] = []

  readonly callback: ResizeObserverCallback
  readonly observed = new Set<Element>()

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback
    MockResizeObserver.instances.push(this)
  }

  observe(target: Element): void {
    this.observed.add(target)
  }

  unobserve(target: Element): void {
    this.observed.delete(target)
  }

  disconnect(): void {
    this.observed.clear()
  }

  emit(target: Element, width: number, height: number): void {
    this.callback(
      [
        {
          target,
          contentRect: {
            width,
            height,
            x: 0,
            y: 0,
            top: 0,
            left: 0,
            right: width,
            bottom: height,
            toJSON: () => ({}),
          },
          contentBoxSize: [{ inlineSize: width, blockSize: height }],
          borderBoxSize: [{ inlineSize: width, blockSize: height }],
          devicePixelContentBoxSize: [{ inlineSize: width, blockSize: height }],
        },
      ],
      this,
    )
  }
}

const ROW_HEIGHT = 20
const LINES = Array.from({ length: 30 }, (_value, index) => `const line${index} = ${index}`)
const TEXT = LINES.join('\n')

function editorRoot(): HTMLElement {
  return document.querySelector('.editor-virtualized') as HTMLElement
}

function editorInput(): HTMLTextAreaElement {
  return document.querySelector('.editor-virtualized-input') as HTMLTextAreaElement
}

function preedit(): HTMLElement | null {
  return document.querySelector('.editor-virtualized-composition')
}

/** Where the editor is drawing the caret, which is where both the preedit and the input belong. */
function caretTransform(): string {
  return (document.querySelector('.editor-virtualized-caret') as HTMLElement).style.transform
}

function inputCorner(): string {
  return editorInput().style.transform
}

/** What the browser leaves in the element when it writes into it: new text, and a caret past it. */
function writeIntoInput(
  input: HTMLTextAreaElement,
  start: number,
  end: number,
  text: string,
): void {
  input.value = `${input.value.slice(0, start)}${text}${input.value.slice(end)}`
  input.setSelectionRange(start + text.length, start + text.length)
}

function compositionEvent(type: string, data = ''): CompositionEvent {
  const event = new Event(type, { bubbles: true }) as CompositionEvent
  Object.defineProperty(event, 'data', { configurable: true, value: data })
  return event
}

describe('IME composition', () => {
  let container: HTMLElement
  let editor: Editor
  let resizeObserver: typeof globalThis.ResizeObserver

  beforeEach(async () => {
    highlightsMap.clear()
    // @ts-expect-error — happy-dom has no Highlight constructor
    globalThis.Highlight = MockHighlight
    setHighlightRegistry(mockRegistry)
    resetEditorInstanceCount()
    resizeObserver = globalThis.ResizeObserver
    globalThis.ResizeObserver = MockResizeObserver
    MockResizeObserver.instances = []
    container = document.createElement('div')
    document.body.appendChild(container)
    editor = new Editor(container, { lineHeight: ROW_HEIGHT })

    const root = editorRoot()
    MockResizeObserver.instances
      .find((observer) => observer.observed.has(root))!
      .emit(root, 300, 100)
    await new Promise((resolve) => setTimeout(resolve, 0))

    editor.attachSession(createDocumentSession(TEXT))
    editor.focus()
    editor.setScrollPosition({ left: 0, top: 0 })
  })

  afterEach(() => {
    editor.dispose()
    container.remove()
    globalThis.ResizeObserver = resizeObserver
    setHighlightRegistry(undefined)
  })

  it('draws the candidate a composition is assembling over the row it will land in', () => {
    editor.setSelection(6, 6, { reveal: false })

    editorInput().dispatchEvent(compositionEvent('compositionstart'))
    editorInput().dispatchEvent(compositionEvent('compositionupdate', 'にほん'))

    expect(preedit()?.textContent).toBe('にほん')
    expect(preedit()?.style.transform).toBe(caretTransform())
    expect(preedit()?.style.height).toBe(`${ROW_HEIGHT}px`)
    // The hidden input carries the same characters, and that is the copy a screen reader follows.
    expect(preedit()?.getAttribute('aria-hidden')).toBe('true')
  })

  it('redraws one preedit as the reader moves through the candidates', () => {
    const offset = TEXT.indexOf('line3')
    editor.setSelection(offset, offset, { reveal: false })

    editorInput().dispatchEvent(compositionEvent('compositionstart'))
    editorInput().dispatchEvent(compositionEvent('compositionupdate', 'にほん'))
    editorInput().dispatchEvent(compositionEvent('compositionupdate', '日本'))

    expect(document.querySelectorAll('.editor-virtualized-composition')).toHaveLength(1)
    expect(preedit()?.textContent).toBe('日本')
    expect(preedit()?.style.transform).toBe(caretTransform())
  })

  it('takes the preedit down once the composition reaches the document', () => {
    editor.setSelection(6, 6, { reveal: false })

    editorInput().dispatchEvent(compositionEvent('compositionstart'))
    editorInput().dispatchEvent(compositionEvent('compositionupdate', '日本'))
    editorInput().dispatchEvent(compositionEvent('compositionend', '日本'))

    expect(editor.materializeFullText().startsWith('const 日本line0')).toBe(true)
    expect(preedit()).toBeNull()
  })

  it('takes the preedit down when a beforeinput commits the composition', () => {
    editor.setSelection(6, 6, { reveal: false })

    editorInput().dispatchEvent(compositionEvent('compositionstart'))
    editorInput().dispatchEvent(compositionEvent('compositionupdate', '日本'))
    // WebKit commits through beforeinput and ends the composition afterwards, so the end returns
    // with nothing to apply — the take-down cannot ride along with the text reaching the document.
    editorInput().dispatchEvent(
      new InputEvent('beforeinput', {
        bubbles: true,
        cancelable: true,
        data: '日本',
        inputType: 'insertFromComposition',
      }),
    )
    editorInput().dispatchEvent(compositionEvent('compositionend', '日本'))

    expect(editor.materializeFullText().startsWith('const 日本line0')).toBe(true)
    expect(preedit()).toBeNull()
  })

  // Every refresh between compositionstart and compositionend returns rather than write over the
  // candidate the reader is assembling, so a composition committed through beforeinput leaves the
  // editor's copy of the element a whole composition behind — and the next edit it cannot name is
  // read as the difference between text the browser stopped holding and text it does.
  it('takes the hidden input back to the document when a beforeinput commits the composition', () => {
    editor.setSelection(6, 6, { reveal: false })
    const input = editorInput()
    const caret = input.selectionStart

    input.dispatchEvent(compositionEvent('compositionstart'))
    input.dispatchEvent(compositionEvent('compositionupdate', '日本'))
    // The candidate is in the element itself the whole time: that is where the reader is typing it.
    writeIntoInput(input, caret, caret, '日本')
    input.dispatchEvent(
      new InputEvent('beforeinput', {
        bubbles: true,
        cancelable: true,
        data: '日本',
        inputType: 'insertFromComposition',
      }),
    )
    input.dispatchEvent(compositionEvent('compositionend', '日本'))

    // An autocorrection, a dead key, a dictated phrase: an input event with nothing readable on it,
    // answered by diffing the element against the copy the editor holds.
    writeIntoInput(input, input.selectionStart, input.selectionEnd, 'x')
    input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }))

    expect(editor.materializeFullText().startsWith('const 日本xline0')).toBe(true)
  })

  // Backspace, the arrows and Enter all mean something to the input method while a candidate is
  // being assembled, and the editor binds every one of them. A chord that fires anyway edits text
  // the reader is not looking at, and then the candidate commits into whatever it left behind.
  it('leaves the keys a composition owns to the input method', () => {
    editor.setSelection(6, 6, { reveal: false })
    editorInput().dispatchEvent(compositionEvent('compositionstart'))
    editorInput().dispatchEvent(compositionEvent('compositionupdate', 'にほん'))

    const backspace = new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: 'Backspace',
    })
    editorInput().dispatchEvent(backspace)

    expect(editor.materializeFullText()).toBe(TEXT)
    expect(backspace.defaultPrevented).toBe(false)

    editorInput().dispatchEvent(compositionEvent('compositionend', 'にほん'))

    expect(editor.materializeFullText().startsWith('const にほんline0')).toBe(true)
  })

  // The element is where the candidate lives, so anything written into it mid-composition is
  // written over the reader's half-finished word — or moves the caret the IME is about to commit at.
  it('leaves the candidate in the input when the selection moves under it', () => {
    editor.setSelection(6, 6, { reveal: false })
    editorInput().dispatchEvent(compositionEvent('compositionstart'))
    editorInput().dispatchEvent(compositionEvent('compositionupdate', 'にほん'))

    const input = editorInput()
    const composed = `${TEXT.slice(0, 6)}にほん${TEXT.slice(6)}`
    input.value = composed
    input.setSelectionRange(9, 9)

    editor.setSelection(0, 0, { reveal: false })

    expect(input.value).toBe(composed)
    expect(input.selectionStart).toBe(9)
  })

  it('takes the preedit down when the reader deletes their way out of a composition', () => {
    editor.setSelection(6, 6, { reveal: false })

    editorInput().dispatchEvent(compositionEvent('compositionstart'))
    editorInput().dispatchEvent(compositionEvent('compositionupdate', 'に'))
    editorInput().dispatchEvent(compositionEvent('compositionupdate', ''))

    expect(preedit()).toBeNull()
    expect(editor.materializeFullText()).toBe(TEXT)
  })

  it('holds the preedit back while the row it belongs to is scrolled away', () => {
    editor.setSelection(6, 6, { reveal: false })
    editorInput().dispatchEvent(compositionEvent('compositionstart'))
    editorInput().dispatchEvent(compositionEvent('compositionupdate', 'に'))

    editor.setScrollPosition({ top: 400 })
    editorInput().dispatchEvent(compositionEvent('compositionupdate', 'にほ'))

    expect(preedit()?.hidden).toBe(true)

    editor.setScrollPosition({ top: 0 })
    editorInput().dispatchEvent(compositionEvent('compositionupdate', 'にほん'))

    expect(preedit()?.hidden).toBe(false)
    expect(preedit()?.style.transform).toBe(caretTransform())
  })

  it('puts the hidden input on the caret, which is where the candidate window opens', () => {
    editor.setSelection(6, 6, { reveal: false })

    expect(inputCorner()).toBe(caretTransform())
  })

  it('moves the hidden input as the caret moves', () => {
    editor.setSelection(6, 6, { reveal: false })
    const first = inputCorner()

    const offset = TEXT.indexOf('line3')
    editor.setSelection(offset, offset, { reveal: false })

    expect(inputCorner()).not.toBe(first)
    expect(inputCorner()).toBe(caretTransform())
  })

  it('parks the hidden input when the caret is off the right edge of a long line', () => {
    editor.setText(`${'x'.repeat(400)}\n${TEXT}`)
    editor.setSelection(100, 100, { reveal: false })

    expect(caretTransform()).toBe('translate(800px, 0px)')
    expect(inputCorner()).toBe('translate(0px, 0px)')
  })

  it('parks the hidden input when the caret is scrolled in behind the gutter', async () => {
    editor.dispose()
    editor = new Editor(container, {
      lineHeight: ROW_HEIGHT,
      plugins: [createLineGutterPlugin()],
    })
    const root = editorRoot()
    MockResizeObserver.instances
      .find((observer) => observer.observed.has(root))!
      .emit(root, 300, 100)
    await new Promise((resolve) => setTimeout(resolve, 0))
    editor.attachSession(createDocumentSession(`${'x'.repeat(400)}\n${TEXT}`))
    editor.focus()

    // Scrolled far enough right that the second column is behind the gutter, but not so far that it
    // is off the left of the scroll window — a caret under the gutter is a caret nobody can see.
    // Scrolling a line sideways moves no row, so nothing repaints and the input is left where the
    // caret used to be; being focused again is what asks the question a second time.
    editor.setSelection(1, 1, { reveal: false })
    editor.setScrollPosition({ left: 16 })
    editor.focus()

    const gutter = Number.parseFloat(root.style.getPropertyValue('--editor-gutter-width'))
    expect(gutter).toBeGreaterThan(8)
    expect(caretTransform()).toBe(`translate(${gutter + 8}px, 0px)`)
    expect(inputCorner()).toBe('translate(16px, 0px)')
  })

  it('keeps the input on the caret in a document too tall for the browser to scroll', async () => {
    // Past the browser's own scroll ceiling the rows are drawn at a shifted origin, and the input
    // hangs off the scroll element rather than the shifted layer — so it has to carry the shift.
    editor.dispose()
    editor = new Editor(container, { lineHeight: 5000 })
    const root = editorRoot()
    MockResizeObserver.instances
      .find((observer) => observer.observed.has(root))!
      .emit(root, 300, 100)
    await new Promise((resolve) => setTimeout(resolve, 0))
    const lines = Array.from({ length: 4000 }, (_value, index) => `line${index}`)
    editor.attachSession(createDocumentSession(lines.join('\n')))
    editor.focus()

    editor.setScrollPosition({ top: 10_000_000 })
    const offset = lines.slice(0, 2000).join('\n').length + 1
    editor.setSelection(offset, offset, { reveal: false })

    const spacer = container.querySelector('.editor-virtualized-spacer') as HTMLElement
    const shift = Number.parseFloat(spacer.style.transform.replace(/[^-\d.]/g, ''))
    const caretTop = Number.parseFloat(caretTransform().split(', ')[1]!)
    expect(shift).not.toBe(0)
    const inputTop = Number.parseFloat(inputCorner().split(', ')[1]!)
    expect(inputTop).toBeCloseTo(caretTop + shift, 3)
  })

  it('parks the hidden input in the viewport corner when the caret is scrolled out of view', () => {
    editor.setSelection(6, 6, { reveal: false })
    expect(inputCorner()).toBe(caretTransform())

    editor.setScrollPosition({ top: 400 })

    // Where the reader is looking, not where the caret is: an input left behind off screen is one
    // the browser can scroll back into view under them.
    expect(inputCorner()).toBe('translate(0px, 400px)')
    expect(caretTransform()).toBe('translate(48px, 0px)')
  })
})
