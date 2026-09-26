import type { EditorAnyCommandId } from '@singapore-editor/core/editor'
import type { EditorCommandHandler } from '@singapore-editor/core/extensions'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { connectedEditor, flushPromises } from './connectedEditor'

// The completion list and the signature hint answer the keymap through context keys and commands,
// so which one a key reaches is the bindings' order, not the order their listeners were added in.
describe('keys for the completion list and the signature hint', () => {
  afterEach(() => {
    vi.useRealTimers()
    document.body.replaceChildren()
  })

  it('closes the list with the first Escape and the hint with the second', async () => {
    const editor = await openHintAndList()

    expect(editor.pressKey('Escape').defaultPrevented).toBe(true)
    expect(visibleCompletion()).toBe(false)
    expect(visibleSignature()).toBe(true)

    expect(editor.pressKey('Escape').defaultPrevented).toBe(true)
    expect(visibleSignature()).toBe(false)
  })

  it('takes an Escape that closes the hint away from every other Escape binding', async () => {
    const clearSecondarySelections = vi.fn<EditorCommandHandler>(() => true)
    const editor = await connectedEditor('call', 4, {
      commands: new Map<EditorAnyCommandId, EditorCommandHandler>([
        ['clearSecondarySelections', clearSecondarySelections],
      ]),
    })
    await openHint(editor)

    editor.pressKey('Escape')

    expect(visibleSignature()).toBe(false)
    expect(clearSecondarySelections).not.toHaveBeenCalled()
    editor.pressKey('Escape')
    expect(clearSecondarySelections).toHaveBeenCalledTimes(1)
  })

  it('moves through the list, not the overloads, while both are open', async () => {
    const editor = await openHintAndList()
    const overload = signatureLabel()

    editor.pressKey('ArrowDown')

    expect(editor.focusedCompletionLabel()).toBe('second')
    expect(signatureLabel()).toBe(overload)
  })

  it('cycles the overloads with the arrows once the list is closed', async () => {
    const editor = await openHintAndList()
    editor.pressKey('Escape')
    const overload = signatureLabel()

    expect(editor.pressKey('ArrowDown').defaultPrevented).toBe(true)

    expect(signatureLabel()).not.toBe(overload)
  })

  it('lets Enter through when the list has nothing to accept', async () => {
    const editor = await connectedEditor('call', 4)

    expect(editor.pressKey('Enter').defaultPrevented).toBe(false)
  })
})

async function openHint(editor: Awaited<ReturnType<typeof connectedEditor>>) {
  editor.type('(')
  // The signature surface loads on the first '(' of a session, so the request follows its import.
  await editor.awaitRequest('textDocument/signatureHelp')
  editor.answerSignatureHelp({
    signatures: [{ label: 'call(a: number)' }, { label: 'call(a: string, b: string)' }],
  })
  await flushPromises()
  expect(visibleSignature()).toBe(true)
}

async function openHintAndList() {
  const editor = await connectedEditor('call', 4)
  await openHint(editor)
  editor.pressKey(' ', { ctrlKey: true })
  await editor.awaitRequest('textDocument/completion')
  editor.answerCompletion([{ label: 'first' }, { label: 'second' }])
  await flushPromises()
  expect(visibleCompletion()).toBe(true)
  return editor
}

function visibleCompletion(): boolean {
  const widget = document.querySelector<HTMLElement>('.editor-test-lsp-completion')
  return widget !== null && !widget.hidden
}

function visibleSignature(): boolean {
  return signatureLabel() !== null
}

function signatureLabel(): string | null {
  const tooltip = [...document.querySelectorAll<HTMLElement>('[data-editor-popup]')].find(
    (element) => !element.hidden && element.textContent?.includes('call('),
  )
  return tooltip?.textContent ?? null
}
