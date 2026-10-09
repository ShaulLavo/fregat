import { afterEach, describe, expect, it } from 'vitest'
import { commands } from 'vitest/browser'
import { Editor } from '../src/editor/Editor'
import type { InputSelectionController } from '../src/editor/inputSelectionController'
import { type EditorInputRoute, type VirtualizedTextView } from '../src/virtualization'
import { rowElementFromNode } from '../src/virtualization/virtualizedTextViewHelpers'
import { offsetFromDomBoundary } from '../src/virtualization/virtualizedTextViewGeometry'
import '../src/style.css'

declare module 'vitest/browser' {
  interface BrowserCommands {
    proofType: (text: string) => Promise<void>
  }
}

const frames = () =>
  new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  )

describe.each<EditorInputRoute>(['textarea', 'edit-context'])('%s input in an iframe', (route) => {
  let frame: HTMLIFrameElement | undefined
  let editor: Editor | undefined
  let hostElement: HTMLDivElement | undefined

  afterEach(() => {
    try {
      editor?.dispose()
    } finally {
      editor = undefined
      frame?.remove()
      frame = undefined
      hostElement?.remove()
      hostElement = undefined
      document.getSelection()?.removeAllRanges()
    }
  })

  function open(inFrame = true) {
    if (inFrame) {
      frame = document.createElement('iframe')
      frame.style.cssText = 'width:720px;height:400px'
      document.body.append(frame)
    }
    const nativeDocument = frame?.contentDocument ?? document
    if (inFrame) {
      const style = nativeDocument.createElement('style')
      style.textContent = Array.from(document.styleSheets)
        .flatMap((sheet) => Array.from(sheet.cssRules, (rule) => rule.cssText))
        .join('\n')
      nativeDocument.head.append(style)
    }
    const host = nativeDocument.createElement('div')
    hostElement = host
    host.style.cssText = 'width:700px;height:380px;display:flex;flex-direction:column'
    nativeDocument.body.append(host)
    editor = new Editor(host, {
      inputRoute: route,
      textMetrics: { rowHeight: 20, characterWidth: 8 },
      scrollPastEnd: false,
    })
    return { host, nativeDocument, instance: editor }
  }

  it('sets text and disposes without attaching EditContext to a textarea', () => {
    const { instance } = open()
    expect(instance.getInputElement().localName).toBe(route === 'textarea' ? 'textarea' : 'div')
    expect(() => instance.setText('alpha')).not.toThrow()
    expect(instance.materializeFullText()).toBe('alpha')
    expect(() => instance.dispose()).not.toThrow()
    editor = undefined
  })

  it('disposes after its iframe is removed', () => {
    const { instance } = open()
    instance.setText('alpha')
    frame!.remove()
    expect(() => instance.dispose()).not.toThrow()
    editor = undefined
  })

  it('synchronizes the input window and accepts native typing', async () => {
    const { instance, nativeDocument } = open()
    instance.setText('alpha')
    instance.focus()
    instance.setSelection(5, 5)
    await frames()
    const input = instance.getInputElement()
    expect(nativeDocument.activeElement).toBe(input)
    if (route === 'textarea') {
      const textarea = input as HTMLTextAreaElement
      expect(textarea.value).toBe('alpha')
      expect(textarea.selectionStart).toBe(5)
      expect(textarea.selectionEnd).toBe(5)
      expect(textarea.readOnly).toBe(false)
    }
    await commands.proofType('x')
    await frames()
    expect(instance.materializeFullText()).toBe('alphax')
  })

  it('finds mounted rows from iframe elements and text nodes', () => {
    const { instance, host } = open()
    instance.setText('alpha')
    const row = host.querySelector<HTMLDivElement>('[data-editor-virtual-row="0"]')!
    expect(rowElementFromNode(row, host)).toBe(row)
    expect(rowElementFromNode(row.firstChild!, host)).toBe(row)
    const view = Reflect.get(instance, 'view') as VirtualizedTextView
    expect(view.textOffsetFromDomBoundary(row, 0)).toBe(0)
    expect(view.textOffsetFromDomBoundary(row, row.childNodes.length)).toBe(5)
    expect(view.textOffsetFromDomBoundary(row.firstChild!, 2)).toBe(2)
  })

  it('keeps key presses in an embedded editable element', async () => {
    const { instance, host, nativeDocument } = open()
    instance.setText('alpha')
    const button = nativeDocument.createElement('button')
    host.querySelector('.editor-virtualized')!.append(button)
    button.focus()
    button.dispatchEvent(
      new nativeDocument.defaultView!.KeyboardEvent('keydown', { key: 'x', bubbles: true }),
    )
    await frames()
    expect(instance.materializeFullText()).toBe('alpha')
    expect(nativeDocument.activeElement).toBe(button)
  })

  it.each([false, true])('reconciles native selection with iframe=%s', (inFrame) => {
    const { instance, host, nativeDocument } = open(inFrame)
    instance.setText('alpha')
    const row = host.querySelector<HTMLDivElement>('[data-editor-virtual-row="0"]')!
    const range = nativeDocument.createRange()
    range.setStart(row.firstChild!, 1)
    range.setEnd(row.firstChild!, 3)
    const selection = nativeDocument.getSelection()!
    selection.removeAllRanges()
    selection.addRange(range)
    row.dispatchEvent(new nativeDocument.defaultView!.MouseEvent('mouseup', { bubbles: true }))
    const resolved = instance.getSelections()[0]!
    expect(resolved.startOffset).toBe(1)
    expect(resolved.endOffset).toBe(3)
  })

  it.each([false, true])('writes selection to its document with iframe=%s', (inFrame) => {
    const { instance, nativeDocument } = open(inFrame)
    instance.setText('alpha')
    instance.setSelection(1, 3)
    const inputSelection = Reflect.get(instance, 'inputSelection') as InputSelectionController
    inputSelection.syncDomSelection()
    expect(nativeDocument.getSelection()!.toString()).toBe('lp')
    if (inFrame) expect(document.getSelection()!.rangeCount).toBe(0)
  })

  it('resolves row and element boundaries after iframe removal', () => {
    const { instance, host } = open()
    instance.setText('alpha')
    const row = host.querySelector<HTMLDivElement>('[data-editor-virtual-row="0"]')!
    const text = row.firstChild!
    const view = Reflect.get(instance, 'view') as VirtualizedTextView
    frame!.remove()
    expect(host.ownerDocument.defaultView).toBeNull()
    expect(rowElementFromNode(row, host)).toBe(row)
    expect(rowElementFromNode(text, host)).toBe(row)
    expect(view.textOffsetFromDomBoundary(row, 0)).toBe(0)
    expect(view.textOffsetFromDomBoundary(row, row.childNodes.length)).toBe(5)
    expect(view.textOffsetFromDomBoundary(text, 2)).toBe(2)
  })

  it('resolves element geometry after iframe removal', () => {
    const { instance, host, nativeDocument } = open()
    instance.setText('alpha')
    const view = Reflect.get(instance, 'view') as VirtualizedTextView
    const mounted = view.getState().mountedRows[0]!
    const row = host.querySelector<HTMLDivElement>('[data-editor-virtual-row="0"]')!
    const svg = nativeDocument.createElementNS('http://www.w3.org/2000/svg', 'svg')
    row.append(svg)
    frame!.remove()
    expect(offsetFromDomBoundary(mounted, row, 0)).toBe(0)
    expect(offsetFromDomBoundary(mounted, row, row.childNodes.length)).toBe(5)
    expect(offsetFromDomBoundary(mounted, svg, 0)).toBeNull()
  })

  it('handles an auxiliary caret hit after iframe removal', () => {
    const { instance, host, nativeDocument } = open()
    instance.setText('אבג')
    const view = Reflect.get(instance, 'view') as VirtualizedTextView
    const scroll = host.querySelector<HTMLDivElement>('.editor-virtualized')!
    const row = host.querySelector<HTMLDivElement>('[data-editor-virtual-row="0"]')!
    const caret = host.querySelector<HTMLDivElement>('.editor-virtualized-caret')!
    const bounds = scroll.getBoundingClientRect()
    const rowBounds = row.getBoundingClientRect()
    scroll.getBoundingClientRect = () => bounds
    let hits = 0
    Object.defineProperty(nativeDocument, 'caretPositionFromPoint', {
      configurable: true,
      value: () => {
        hits += 1
        return hits === 1
          ? { offsetNode: caret, offset: 0 }
          : { offsetNode: row.firstChild!, offset: 1 }
      },
    })
    frame!.remove()
    expect(() => view.textPositionFromPoint(rowBounds.left + 8, rowBounds.top + 10)).not.toThrow()
    expect(hits).toBeGreaterThanOrEqual(2)
    expect(caret.style.visibility).toBe('')
  })

  it('handles retained key and drag callbacks after iframe removal', () => {
    const { instance, host, nativeDocument } = open()
    instance.setText('alpha')
    const nativeWindow = nativeDocument.defaultView!
    const inputSelection = Reflect.get(instance, 'inputSelection') as InputSelectionController
    const keyHandler = Reflect.get(inputSelection, 'handleKeyDown') as (
      event: KeyboardEvent,
    ) => void
    const leaveHandler = Reflect.get(inputSelection, 'handleDragLeave') as (
      event: DragEvent,
    ) => void
    const button = nativeDocument.createElement('button')
    const scroll = host.querySelector<HTMLDivElement>('.editor-virtualized')!
    scroll.append(button)
    const key = new nativeWindow.KeyboardEvent('keydown', {
      key: 'x',
      bubbles: true,
      cancelable: true,
    })
    const leave = new nativeWindow.DragEvent('dragleave', {
      relatedTarget: button,
      bubbles: true,
    })
    Object.defineProperty(key, 'target', { value: button })
    Object.defineProperty(key, 'composedPath', {
      value: () => [button, scroll, host, nativeDocument],
    })
    frame!.remove()
    // Removing the browsing context disables dispatch; exercise retained callbacks directly.
    expect(() => keyHandler(key)).not.toThrow()
    expect(() => leaveHandler(leave)).not.toThrow()
    expect(key.defaultPrevented).toBe(false)
    expect(instance.materializeFullText()).toBe('alpha')
  })

  it('commits a composition over the selected input range', async () => {
    const { instance } = open()
    instance.setText('alpha')
    instance.focus()
    instance.setSelection(0, 5)
    await frames()
    await commands.proofImeComposition('に')
    await commands.proofInsertText('日本')
    await frames()
    expect(instance.materializeFullText()).toBe('日本')
  })
})
