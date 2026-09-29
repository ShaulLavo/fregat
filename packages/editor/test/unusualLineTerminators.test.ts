import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createDocumentSession } from '../src/documentSession'
import { createDocumentTextSnapshot } from '../src/documentTextSnapshot'
import { Editor } from '../src/editor'
import { setHighlightRegistry } from '../src/public/testing'
import { VirtualizedTextView } from '../src/virtualization'
import { createVisibleEditor } from './factories/visibleEditor'

// Every assertion here is one claim seen from a different layer: the row count
// the model believes in has to be the row count the browser will paint. See
// normalizeLineEndings in pieceTable/lineEndings.ts for why they can differ.

const LINE_SEPARATOR = String.fromCharCode(0x2028)
const PARAGRAPH_SEPARATOR = String.fromCharCode(0x2029)

const ROW_HEIGHT = 20
const VIEWPORT_ROWS = 4
const REVEAL_DOCUMENT = Array.from({ length: 16 }, (_value, index) => `line ${index}`).join('\n')
// The row the payload lands on sits inside the viewport and away from its
// bottom edge, which is the only arrangement where an 'end' reveal moves the
// viewport and a 'nearest' reveal leaves it alone.
const REVEAL_ROW = 8
const REVEAL_SCROLL_TOP = (REVEAL_ROW - 1) * ROW_HEIGHT

// happy-dom doesn't provide the Highlight constructor, so we polyfill it.
class MockHighlight extends Set<Range> {}

const mockRegistry = {
  set: () => undefined,
  delete: () => true,
}

describe('unusual line terminators', () => {
  let container: HTMLElement
  let originalResizeObserver: typeof globalThis.ResizeObserver

  beforeEach(() => {
    // @ts-expect-error — see MockHighlight above.
    globalThis.Highlight = MockHighlight
    setHighlightRegistry(mockRegistry)
    originalResizeObserver = globalThis.ResizeObserver
    globalThis.ResizeObserver = MockResizeObserver
    MockResizeObserver.instances = []
    container = document.createElement('div')
    document.body.appendChild(container)
  })

  afterEach(() => {
    container.remove()
    setHighlightRegistry(undefined)
    globalThis.ResizeObserver = originalResizeObserver
  })

  describe('view rows', () => {
    let view: VirtualizedTextView

    beforeEach(() => {
      view = new VirtualizedTextView(container, {
        rowHeight: ROW_HEIGHT,
        overscan: 2,
        highlightRegistry: mockRegistry,
        selectionHighlightName: 'test-selection',
      })
    })

    afterEach(() => {
      view.dispose()
    })

    // The view's row scan looks for '\n' and for nothing else, so it is the fold
    // at ingestion that makes its row count match what CSS paints. These drive
    // the real view over a real ingested snapshot to keep the two halves met.
    it('gives an ingested line separator its own row', () => {
      const session = createDocumentSession(`ab${LINE_SEPARATOR}cd`)
      const snapshot = createDocumentTextSnapshot(session.getSnapshot())

      view.setText(snapshot)

      expect(view.getLineStarts()).toEqual([0, 3])
      expect(view.getLineCount()).toBe(2)
    })

    it('gives every ingested paragraph separator its own row', () => {
      const session = createDocumentSession(
        `one${PARAGRAPH_SEPARATOR}two${PARAGRAPH_SEPARATOR}three`,
      )
      const snapshot = createDocumentTextSnapshot(session.getSnapshot())

      view.setText(snapshot)

      expect(view.getLineStarts()).toEqual([0, 4, 8])
      expect(view.getLineCount()).toBe(3)
    })
  })

  describe('paste', () => {
    let editor: Editor

    beforeEach(() => {
      editor = new Editor(container, { defaultText: '', lineHeight: ROW_HEIGHT })
    })

    afterEach(() => {
      editor.dispose()
    })

    it('stores a pasted line separator as a line feed', () => {
      editor.focus()

      editorInput().dispatchEvent(createPasteEvent(`ab${LINE_SEPARATOR}cd`))

      expect(editor.materializeFullText()).toBe('ab\ncd')
      // The caret has to land on the row the browser paints it on.
      expect(editor.getState().cursor).toEqual({ row: 1, column: 2 })
    })

    it('stores a pasted paragraph separator as a line feed', () => {
      editor.focus()

      editorInput().dispatchEvent(createPasteEvent(`para${PARAGRAPH_SEPARATOR}graph`))

      expect(editor.materializeFullText()).toBe('para\ngraph')
    })

    // The reveal block is read off the clipboard payload rather than off the
    // document it produced, so it is the one paste effect that sees terminators
    // as they arrived: a payload that adds rows is revealed at the viewport end,
    // a payload that does not is left wherever the caret already was.
    it('reveals a pasted line separator as the row break it becomes', async () => {
      const separatorTop = await scrollTopAfterPaste(editor, `ab${LINE_SEPARATOR}cd`)

      expect(separatorTop).toBe(await scrollTopAfterPaste(editor, 'ab\ncd'))
      expect(separatorTop).not.toBe(await scrollTopAfterPaste(editor, 'abXcd'))
    })
  })

  describe('drop', () => {
    let editor: Editor

    beforeEach(() => {
      editor = createVisibleEditor(container, { defaultText: 'abcd', lineHeight: ROW_HEIGHT })
    })

    afterEach(() => {
      editor.dispose()
    })

    it('stores a dropped line separator as a line feed', () => {
      mockEditorViewport(editorRoot(), 120, 40)
      const restoreCaretRangeFromPoint = installCaretRangeFromPoint(rowTextNode(0), 2)

      try {
        editorRoot().dispatchEvent(
          createDropEvent(`x${LINE_SEPARATOR}y`, { clientX: 20, clientY: 10 }),
        )
      } finally {
        restoreCaretRangeFromPoint()
      }

      expect(editor.materializeFullText()).toBe('abx\nycd')
      expect(editor.getState().cursor).toEqual({ row: 1, column: 1 })
    })

    it('reveals a dropped paragraph separator as the row break it becomes', async () => {
      const separatorTop = await scrollTopAfterDrop(editor, `x${PARAGRAPH_SEPARATOR}y`)

      expect(separatorTop).toBe(await scrollTopAfterDrop(editor, 'x\ny'))
      expect(separatorTop).not.toBe(await scrollTopAfterDrop(editor, 'xXy'))
    })
  })
})

async function scrollTopAfterPaste(editor: Editor, payload: string): Promise<number> {
  await prepareReveal(editor)

  editorInput().dispatchEvent(createPasteEvent(payload))

  return editor.getScrollPosition().top
}

async function scrollTopAfterDrop(editor: Editor, payload: string): Promise<number> {
  await prepareReveal(editor)
  const restoreCaretRangeFromPoint = installCaretRangeFromPoint(rowTextNode(REVEAL_ROW), 0)

  try {
    editorRoot().dispatchEvent(createDropEvent(payload, { clientX: 20, clientY: 10 }))
  } finally {
    restoreCaretRangeFromPoint()
  }

  return editor.getScrollPosition().top
}

// Parks the caret on REVEAL_ROW with a viewport that extends well past it, so a
// payload landing there is already visible.
async function prepareReveal(editor: Editor): Promise<void> {
  const root = editorRoot()
  editor.setText(REVEAL_DOCUMENT)
  editor.focus()
  const observer = MockResizeObserver.instances.find((candidate) => candidate.observed.has(root))!
  observer.emit(root, ROW_HEIGHT * VIEWPORT_ROWS, 200)
  // The virtualizer adopts an observed size on the next frame, and every offset
  // it reveals against is measured from that size.
  await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)))
  const caret = REVEAL_DOCUMENT.indexOf(`line ${REVEAL_ROW}`)
  editor.setSelection(caret, caret, { reveal: false })
  editor.setScrollPosition({ top: REVEAL_SCROLL_TOP })
}

function editorRoot(): HTMLElement {
  return document.querySelector('.editor-virtualized') as HTMLElement
}

function editorInput(): HTMLTextAreaElement {
  return document.querySelector('.editor-virtualized-input') as HTMLTextAreaElement
}

function rowTextNode(row: number): Text {
  const element = document.querySelector(`[data-editor-virtual-row="${row}"]`)
  const walker = document.createTreeWalker(element!, NodeFilter.SHOW_TEXT)
  return walker.nextNode() as Text
}

// happy-dom gives every element a zero-sized box, so the hit test has no row
// geometry to resolve a drop point against until one is stubbed in.
function mockEditorViewport(element: HTMLElement, width: number, height: number): void {
  Object.defineProperty(element, 'clientHeight', { configurable: true, value: height })
  Object.defineProperty(element, 'scrollHeight', { configurable: true, value: 200 })
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

  emit(target: Element, height: number, width: number): void {
    const box = { blockSize: height, inlineSize: width }
    this.callback(
      [
        {
          target,
          contentRect: {
            bottom: height,
            height,
            left: 0,
            right: width,
            top: 0,
            width,
            x: 0,
            y: 0,
            toJSON: () => ({}),
          },
          contentBoxSize: [box],
          borderBoxSize: [box],
          devicePixelContentBoxSize: [box],
        },
      ],
      this,
    )
  }
}

function installCaretRangeFromPoint(textNode: Text, offset: number): () => void {
  const doc = document as Document & {
    caretRangeFromPoint?: (x: number, y: number) => Range | null
  }
  const originalCaretRangeFromPoint = doc.caretRangeFromPoint
  Object.defineProperty(document, 'caretRangeFromPoint', {
    configurable: true,
    value: () => {
      const range = document.createRange()
      range.setStart(textNode, offset)
      range.setEnd(textNode, offset)
      return range
    },
  })

  return () => {
    if (originalCaretRangeFromPoint) {
      Object.defineProperty(document, 'caretRangeFromPoint', {
        configurable: true,
        value: originalCaretRangeFromPoint,
      })
      return
    }

    Reflect.deleteProperty(document, 'caretRangeFromPoint')
  }
}

function createPasteEvent(text: string): ClipboardEvent {
  const clipboardData = {
    getData: (format: string): string => (format === 'text/plain' ? text : ''),
    setData: () => undefined,
  }
  const event = new Event('paste', { bubbles: true, cancelable: true }) as ClipboardEvent
  Object.defineProperty(event, 'clipboardData', { configurable: true, value: clipboardData })
  return event
}

function createDropEvent(text: string, init: MouseEventInit = {}): DragEvent {
  const dataTransfer = {
    getData: (format: string): string => (format === 'text/plain' ? text : ''),
  }
  const event = new MouseEvent('drop', { bubbles: true, cancelable: true, ...init }) as DragEvent
  Object.defineProperty(event, 'dataTransfer', { configurable: true, value: dataTransfer })
  return event
}
