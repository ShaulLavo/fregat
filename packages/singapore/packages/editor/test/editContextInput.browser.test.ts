import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { commands } from 'vitest/browser'
import '../src/style.css'
import { Editor } from '../src/editor/Editor'
import type { EditorInputRoute } from '../src/virtualization'

declare module 'vitest/browser' {
  interface BrowserCommands {
    proofKeyPress: (key: string) => Promise<void>
    proofKeyDown: (key: string) => Promise<void>
    proofKeyUp: (key: string) => Promise<void>
    proofType: (text: string) => Promise<void>
    proofImeComposition: (
      text: string,
      replacement?: readonly [number, number] | null,
    ) => Promise<void>
    proofInsertText: (text: string) => Promise<void>
  }
}

const frames = () =>
  new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  )

// Each case runs on both routes: the textarea is the control the EditContext route must match.
describe.each<EditorInputRoute>(['edit-context', 'textarea'])('%s input route', (route) => {
  let host: HTMLDivElement
  let editor: Editor

  async function open(text: string, caret: number) {
    editor = new Editor(host, { defaultText: text, inputRoute: route })
    await frames()
    editor.focus()
    editor.setSelection(caret, caret)
    await frames()
  }

  beforeEach(() => {
    host = document.createElement('div')
    host.style.cssText = 'width: 600px; height: 200px; display: flex'
    document.body.append(host)
  })

  afterEach(() => {
    editor.dispose()
    host.remove()
  })

  it('mounts the element the route names', async () => {
    await open('hello world', 5)
    const input = editor.getInputElement()
    expect(input.tagName).toBe(route === 'edit-context' ? 'DIV' : 'TEXTAREA')
    expect(document.activeElement).toBe(input)
  })

  it('types, deletes and breaks lines', async () => {
    await open('hello world', 5)
    await commands.proofType('ab')
    await commands.proofKeyPress('Backspace')
    await commands.proofKeyPress('Enter')
    await frames()
    expect(editor.materializeFullText()).toBe('helloa\n world')
  })

  it('commits a composition once, as its final candidate', async () => {
    await open('hello world', 5)
    await commands.proofImeComposition('に')
    await commands.proofImeComposition('にほ')
    await frames()
    expect(editor.materializeFullText()).toBe('hello world')
    await commands.proofInsertText('日本')
    await frames()
    expect(editor.materializeFullText()).toBe('hello日本 world')
    await commands.proofType('x')
    await frames()
    expect(editor.materializeFullText()).toBe('hello日本x world')
  })

  it('leaves the document alone when a composition is abandoned', async () => {
    await open('hello world', 5)
    await commands.proofImeComposition('か')
    await commands.proofImeComposition('')
    await frames()
    expect(editor.materializeFullText()).toBe('hello world')
  })

  it('replaces the word a correction reaches back over', async () => {
    await open('hello world', 5)
    await commands.proofImeComposition('Hello', [0, 5])
    await commands.proofInsertText('Hello')
    await frames()
    expect(editor.materializeFullText()).toBe('Hello world')
  })

  it('draws the candidate of a composition started over a selection', async () => {
    await open('hello world', 0)
    editor.setSelection(0, 5)
    await frames()
    await commands.proofImeComposition('k')
    await frames()
    const preedit = host.querySelector('.editor-virtualized-composition')?.textContent
    await commands.proofInsertText('K')
    await frames()
    expect({ preedit, text: editor.materializeFullText() }).toEqual({
      preedit: 'k',
      text: 'K world',
    })
  })

  it('keeps the selection and the input in step when a composition over it is abandoned', async () => {
    await open('hello world', 0)
    editor.setSelection(0, 5)
    await frames()
    await commands.proofImeComposition('か')
    await commands.proofImeComposition('')
    await frames()
    const abandoned = editor.materializeFullText()
    await commands.proofType('x')
    await frames()
    expect({ abandoned, typed: editor.materializeFullText() }).toEqual({
      abandoned: 'hello world',
      typed: 'x world',
    })
  })

  it('closes a typed bracket but not a composed one', async () => {
    // Auto-close fires before whitespace, as in VS Code.
    await open('a b', 1)
    await commands.proofType('(')
    await frames()
    const typed = editor.materializeFullText()
    await commands.proofKeyPress('Delete')
    await commands.proofKeyPress('Backspace')
    await commands.proofImeComposition('(')
    await commands.proofInsertText('(')
    await frames()
    expect({ typed, composed: editor.materializeFullText() }).toEqual({
      typed: 'a() b',
      composed: 'a( b',
    })
  })

  it('inserts text that arrives with no key behind it', async () => {
    await open('hello world', 5)
    await commands.proofInsertText(' there')
    await frames()
    expect(editor.materializeFullText()).toBe('hello there world')
  })
})

describe('what a screen reader reads on the EditContext route', () => {
  let host: HTMLDivElement
  let editor: Editor

  beforeEach(async () => {
    host = document.createElement('div')
    host.style.cssText = 'width: 600px; height: 200px; display: flex'
    document.body.append(host)
    editor = new Editor(host, {
      defaultText: 'first line\nsecond line',
      inputRoute: 'edit-context',
    })
    await frames()
    editor.focus()
  })

  afterEach(() => {
    editor.dispose()
    host.remove()
  })

  function readerView() {
    const input = editor.getInputElement()
    const selection = document.getSelection()!
    return {
      text: input.textContent,
      inside: selection.anchorNode === input.firstChild && selection.focusNode === input.firstChild,
      anchor: selection.anchorOffset,
      focus: selection.focusOffset,
    }
  }

  it('holds the lines around the caret and the caret inside them', async () => {
    editor.setSelection(13, 13)
    await frames()
    expect(readerView()).toEqual({
      text: 'first line\nsecond line',
      inside: true,
      anchor: 13,
      focus: 13,
    })
  })

  it('keeps a backward selection backward', async () => {
    editor.setSelection(9, 2)
    await frames()
    expect(readerView()).toMatchObject({ inside: true, anchor: 9, focus: 2 })
  })

  it('follows the text as it is typed', async () => {
    editor.setSelection(5, 5)
    await frames()
    await commands.proofType('!')
    await frames()
    expect(readerView()).toEqual({
      text: 'first! line\nsecond line',
      inside: true,
      anchor: 6,
      focus: 6,
    })
  })

  it('leaves mouse and keyboard selection to the editor', async () => {
    const row = host.querySelector<HTMLElement>('.editor-virtualized-row')!
    const text = Array.from(row.childNodes).find((node) => node.nodeType === Node.TEXT_NODE)!
    const range = document.createRange()
    range.setStart(text, 0)
    range.setEnd(text, 1)
    const start = range.getBoundingClientRect()
    range.setStart(text, 5)
    range.setEnd(text, 6)
    const end = range.getBoundingClientRect()
    const y = start.top + start.height / 2
    row.dispatchEvent(
      new MouseEvent('mousedown', {
        bubbles: true,
        clientX: start.left + 1,
        clientY: y,
        detail: 1,
      }),
    )
    document.dispatchEvent(
      new MouseEvent('mousemove', { bubbles: true, clientX: end.left + 1, clientY: y, buttons: 1 }),
    )
    document.dispatchEvent(
      new MouseEvent('mouseup', { bubbles: true, clientX: end.left + 1, clientY: y }),
    )
    await frames()
    // The window starts at the document's start here, so its offsets are the editor's.
    expect(readerView()).toMatchObject({ inside: true, anchor: 0, focus: 5 })

    await commands.proofKeyDown('Shift')
    await commands.proofKeyPress('ArrowRight')
    await commands.proofKeyUp('Shift')
    await frames()
    expect(readerView()).toMatchObject({ inside: true, anchor: 0, focus: 6 })
  })
})
