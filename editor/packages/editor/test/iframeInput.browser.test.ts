import { afterEach, describe, expect, it } from 'vitest'
import { commands } from 'vitest/browser'
import { Editor } from '../src/editor/Editor'
import { type EditorInputRoute, type VirtualizedTextView } from '../src/virtualization'
import { rowElementFromNode } from '../src/virtualization/virtualizedTextViewHelpers'
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

  afterEach(() => {
    try {
      editor?.dispose()
    } finally {
      editor = undefined
      frame?.remove()
      frame = undefined
    }
  })

  function open() {
    frame = document.createElement('iframe')
    frame.style.cssText = 'width:720px;height:400px'
    document.body.append(frame)
    const nativeDocument = frame.contentDocument!
    const style = nativeDocument.createElement('style')
    style.textContent = Array.from(document.styleSheets)
      .flatMap((sheet) => Array.from(sheet.cssRules, (rule) => rule.cssText))
      .join('\n')
    nativeDocument.head.append(style)
    const host = nativeDocument.createElement('div')
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
