import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { commands } from 'vitest/browser'
import { createDocumentSession } from '../src/documentSession'
import { Editor } from '../src/editor/Editor'
import '../src/style.css'

declare module 'vitest/browser' {
  interface BrowserCommands {
    proofNativeInsertText: (text: string) => Promise<void>
    proofKeyPress: (key: string) => Promise<void>
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

describe('platform selections in the bounded textarea', () => {
  let host: HTMLDivElement
  let editor: Editor
  let native: HTMLTextAreaElement | undefined

  beforeEach(() => {
    host = document.createElement('div')
    host.style.cssText = 'width:600px;height:200px;display:flex'
    document.body.append(host)
    editor = new Editor(host, { defaultText: 'alpha bravo charlie', inputRoute: 'textarea' })
  })

  afterEach(() => {
    editor.dispose()
    host.remove()
    native?.remove()
    native = undefined
  })

  async function inputAt(caret = 0) {
    await frames()
    editor.focus()
    editor.setSelection(caret, caret)
    await frames()
    return editor.getInputElement() as HTMLTextAreaElement
  }

  it.each(['forward', 'backward'] as const)(
    'replaces a native %s selection like a textarea',
    async (direction) => {
      native = document.createElement('textarea')
      native.value = 'alpha bravo charlie'
      document.body.append(native)
      native.focus()
      native.setSelectionRange(6, 11, direction)
      await commands.proofNativeInsertText('DELTA')
      expect(native.value).toBe('alpha DELTA charlie')

      const input = await inputAt()
      input.setSelectionRange(6, 11, direction)
      await commands.proofNativeInsertText('DELTA')
      expect(editor.materializeFullText()).toBe(native.value)
    },
  )

  it('reads the native selection when beforeinput arrives without a selection event', async () => {
    const input = await inputAt()
    input.setSelectionRange(6, 11)
    input.dispatchEvent(
      new InputEvent('beforeinput', {
        bubbles: true,
        cancelable: true,
        inputType: 'insertText',
        data: 'DELTA',
      }),
    )
    expect(editor.materializeFullText()).toBe('alpha DELTA charlie')
  })

  it('publishes a backward native selection before an edit', async () => {
    const input = await inputAt()
    input.setSelectionRange(6, 11, 'backward')
    await frames()
    expect(editor.getSelections()[0]).toMatchObject({ anchorOffset: 11, headOffset: 6 })
    expect(input.selectionDirection).toBe('backward')
  })

  it('inserts at a caret moved directly by the platform', async () => {
    const input = await inputAt()
    input.setSelectionRange(6, 6)
    input.dispatchEvent(
      new InputEvent('beforeinput', {
        bubbles: true,
        cancelable: true,
        inputType: 'insertText',
        data: 'new ',
      }),
    )
    expect(editor.materializeFullText()).toBe('alpha new bravo charlie')
  })

  it('deletes a selection moved directly by the platform', async () => {
    const input = await inputAt()
    input.setSelectionRange(6, 11)
    await commands.proofKeyPress('Backspace')
    expect(editor.materializeFullText()).toBe('alpha  charlie')
  })

  it('maps a moved native caret out of a nonzero bounded window', async () => {
    const prefix = 'x'.repeat(20000) + '\n'
    editor.setText(prefix + 'alpha bravo charlie')
    const input = await inputAt(prefix.length)
    const start = input.value.indexOf('bravo')
    expect(start).toBeGreaterThanOrEqual(0)
    input.setSelectionRange(start, start + 5)
    await commands.proofNativeInsertText('DELTA')
    expect(editor.materializeFullText()).toBe(prefix + 'alpha DELTA charlie')
  })

  it('edits a native selection in the visible tail of a shortened selection', async () => {
    const text = 'a'.repeat(2000) + 'bravo charlie'
    editor.setText(text)
    const input = await inputAt()
    editor.setSelection(0, text.length)
    const start = input.value.indexOf('bravo')
    expect(start).toBeGreaterThanOrEqual(0)
    input.setSelectionRange(start, start + 5)
    await commands.proofNativeInsertText('DELTA')
    expect(editor.materializeFullText()).toBe('a'.repeat(2000) + 'DELTA charlie')
  })

  it('edits a native selection after a page gap in a shortened selection', async () => {
    const prefix = Array.from({ length: 35 }, (_, i) => `row${i}\n`).join('')
    const text = prefix + 'alpha bravo charlie'
    editor.setText(text)
    const input = await inputAt()
    editor.setSelection(0, text.length)
    const start = input.value.indexOf('bravo')
    expect(start).toBeGreaterThanOrEqual(0)
    input.setSelectionRange(start, start + 5)
    await commands.proofNativeInsertText('DELTA')
    expect(editor.materializeFullText()).toBe(prefix + 'alpha DELTA charlie')
  })

  it.each(['typing', 'composition'] as const)(
    'keeps editor-driven multiple selections when the native selection is unchanged (%s)',
    async (route) => {
      await inputAt()
      const session = createDocumentSession('alpha bravo charlie')
      editor.attachSession(session)
      session.setSelections([
        { anchor: 0, head: 5 },
        { anchor: 6, head: 11 },
      ])
      await frames()
      if (route === 'typing') {
        await commands.proofNativeInsertText('X')
      } else {
        const input = editor.getInputElement() as HTMLTextAreaElement
        input.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
        input.setRangeText('X', input.selectionStart, input.selectionEnd, 'end')
        input.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: 'X' }))
      }
      expect(editor.materializeFullText()).toBe('X X charlie')
    },
  )

  it.skipIf(!navigator.userAgent.includes('Chrome'))(
    'commits an engine IME replacement over a native selection',
    async () => {
      const input = await inputAt()
      input.setSelectionRange(6, 11)
      await commands.proofImeComposition('日本')
      expect(editor.materializeFullText()).toBe('alpha bravo charlie')
      await commands.proofInsertText('日本')
      expect(editor.materializeFullText()).toBe('alpha 日本 charlie')
      await commands.proofNativeInsertText('!')
      expect(editor.materializeFullText()).toBe('alpha 日本! charlie')
    },
  )

  it.each([
    { omission: 'character trim', route: 'beforeinput' },
    { omission: 'character trim', route: 'compositionend' },
    { omission: 'page gap', route: 'beforeinput' },
    { omission: 'page gap', route: 'compositionend' },
  ])(
    'preserves omitted text when composition starts immediately ($omission, $route)',
    async ({ omission, route }) => {
      const prefix =
        omission === 'character trim'
          ? 'a'.repeat(2000)
          : Array.from({ length: 35 }, (_, i) => `row${i}\n`).join('') + 'alpha '
      const text = prefix + 'bravo charlie'
      editor.setText(text)
      const input = await inputAt()
      editor.setSelection(0, text.length)
      const start = input.value.indexOf('bravo')
      expect(start).toBeGreaterThanOrEqual(0)
      expect(input.value).toContain('…')
      input.setSelectionRange(start, start + 5)
      // Start composition before the queued select event can publish the native selection.
      input.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
      input.setRangeText('日本', start, start + 5, 'end')
      if (route === 'beforeinput') {
        input.dispatchEvent(
          new InputEvent('beforeinput', {
            bubbles: true,
            cancelable: true,
            inputType: 'insertFromComposition',
            data: '日本',
          }),
        )
      }
      input.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '日本' }))
      expect(editor.materializeFullText()).toBe(prefix + '日本 charlie')
      await commands.proofNativeInsertText('!')
      expect(editor.materializeFullText()).toBe(prefix + '日本! charlie')
    },
  )

  it('commits a composition beforeinput over the original native selection once', async () => {
    const input = await inputAt()
    input.setSelectionRange(6, 11)
    input.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
    input.setRangeText('日本', 6, 11, 'end')
    input.dispatchEvent(
      new InputEvent('beforeinput', {
        bubbles: true,
        cancelable: true,
        inputType: 'insertFromComposition',
        data: '日本',
      }),
    )
    input.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '日本' }))
    expect(editor.materializeFullText()).toBe('alpha 日本 charlie')
  })

  it('commits composition over the native selection captured at compositionstart', async () => {
    const input = await inputAt()
    input.setSelectionRange(6, 11)
    input.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
    input.setRangeText('日本', 6, 11, 'end')
    input.dispatchEvent(new CompositionEvent('compositionupdate', { bubbles: true, data: '日本' }))
    input.dispatchEvent(
      new InputEvent('input', {
        bubbles: true,
        inputType: 'insertCompositionText',
        data: '日本',
        isComposing: true,
      }),
    )
    input.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '日本' }))
    expect(editor.materializeFullText()).toBe('alpha 日本 charlie')
    await commands.proofNativeInsertText('!')
    expect(editor.materializeFullText()).toBe('alpha 日本! charlie')
  })
})
