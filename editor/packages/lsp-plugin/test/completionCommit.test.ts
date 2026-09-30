import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as lsp from 'vscode-languageserver-protocol'

import {
  COMPLETION_ACCEPT_TIMING_NAME,
  connectedEditor,
  flushPromises,
  type ConnectedEditor,
} from './connectedEditor'

describe('committing a completion on a typed character', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    document.body.replaceChildren()
  })

  // The character is the reason the item was accepted, so losing it turns `value` + `.` into `value`
  // and the user has to type the period again. One applyEdits call is one transaction and one undo
  // entry, which is what puts the character and the acceptance on the same Ctrl+Z.
  it('keeps before affinity while repositioning past the commit character', async () => {
    const editor = await connectedEditor('const va', 8, {
      acceptOnCommitCharacter: true,
      affinity: 'before',
    })
    await openList(editor, [{ label: 'value', commitCharacters: ['.'] }])

    const event = editor.pressKey('.')

    expect(editor.applyEdits).toHaveBeenCalledTimes(1)
    expect(editor.applyEdits).toHaveBeenCalledWith(
      [{ from: 6, to: 9, text: 'value.' }],
      COMPLETION_ACCEPT_TIMING_NAME,
      { anchor: 12, head: 12, affinity: 'before' },
    )
    // The editor must not type the character a second time on top of the one in the edit.
    expect(event.defaultPrevented).toBe(true)
    expect(editor.completionElement().hidden).toBe(true)
  })

  it('leaves a committed snippet on its first placeholder, with the character past the end', async () => {
    const editor = await connectedEditor('const va', 8, {
      acceptOnCommitCharacter: true,
      affinity: 'before',
    })
    await openList(editor, [
      {
        label: 'value',
        insertText: 'value(${1:x})',
        insertTextFormat: 2,
        commitCharacters: ['.'],
      },
    ])

    editor.pressKey('.')

    expect(editor.applyEdits).toHaveBeenCalledWith(
      [{ from: 6, to: 9, text: 'value(x).' }],
      COMPLETION_ACCEPT_TIMING_NAME,
      { anchor: 12, head: 13, affinity: 'before' },
    )
  })

  it('ignores a character the focused item does not commit on', async () => {
    const editor = await connectedEditor('const va', 8, { acceptOnCommitCharacter: true })
    await openList(editor, [{ label: 'value', commitCharacters: ['.'] }])

    const event = editor.pressKey(',')

    expect(editor.applyEdits).not.toHaveBeenCalled()
    expect(event.defaultPrevented).toBe(false)
    expect(editor.completionElement().hidden).toBe(false)
  })

  it('leaves the character to be typed when the item cannot be applied', async () => {
    const editor = await connectedEditor('const va', 8, { acceptOnCommitCharacter: true })
    await openList(editor, [{ label: 'value', commitCharacters: ['.'] }])
    editor.breakAcceptance()

    const event = editor.pressKey('.')

    // The acceptance never happened, so the reader is still owed what they pressed.
    expect(editor.applyEdits).not.toHaveBeenCalled()
    expect(event.defaultPrevented).toBe(false)
  })

  // The set belongs to the focused item and to no other, so moving the focus has to move the set with
  // it — otherwise the arrow keys leave an item on screen that commits on somebody else's characters.
  it('follows the focus to the next item and its own characters', async () => {
    const editor = await connectedEditor('const va', 8, { acceptOnCommitCharacter: true })
    await openList(editor, [
      { label: 'value', commitCharacters: ['.'] },
      { label: 'valueOf', commitCharacters: ['('] },
    ])
    expect(editor.completionLabels()).toEqual(['value', 'valueOf'])

    editor.pressKey('ArrowDown')
    editor.pressKey('.')
    expect(editor.applyEdits).not.toHaveBeenCalled()

    editor.pressKey('(')

    expect(editor.applyEdits).toHaveBeenCalledWith(
      [{ from: 6, to: 9, text: 'valueOf(' }],
      COMPLETION_ACCEPT_TIMING_NAME,
      { anchor: 14, head: 14, affinity: 'after' },
    )
  })

  it('types the character instead of committing when the option is off', async () => {
    const editor = await connectedEditor('const va', 8)
    await openList(editor, [{ label: 'value', commitCharacters: ['.'] }])

    const event = editor.pressKey('.')

    expect(editor.applyEdits).not.toHaveBeenCalled()
    expect(event.defaultPrevented).toBe(false)
  })

  // `Ctrl+.` is a binding a host is free to use; a commit character is something the user typed.
  it('does not commit on a chord that happens to end in a commit character', async () => {
    const editor = await connectedEditor('const va', 8, { acceptOnCommitCharacter: true })
    await openList(editor, [{ label: 'value', commitCharacters: ['.'] }])

    const event = editor.pressKey('.', { ctrlKey: true })

    expect(editor.applyEdits).not.toHaveBeenCalled()
    expect(event.defaultPrevented).toBe(false)
  })
})

/**
 * A keystroke, the debounced request it schedules, and the server's answer: a list on screen with a
 * focused item is the state a commit character has to arrive into.
 */
async function openList(
  editor: ConnectedEditor,
  items: readonly lsp.CompletionItem[],
): Promise<void> {
  editor.type('l')
  await vi.advanceTimersByTimeAsync(90)
  editor.answerCompletion(items)
  await flushPromises()
}
