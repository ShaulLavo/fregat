import { detectPlatform } from '@tanstack/hotkeys'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { Editor } from '../src/editor/Editor'
import {
  defaultEditorKeyBindings,
  editorCommandPackForCommand,
  editorKeymapLayerForCommandPack,
} from '../src/editor/keymap'
import { EDITOR_OPTION_DESCRIPTORS } from '../src/editor/optionDescriptors'
import { resetEditorInstanceCount, setHighlightRegistry } from '../src/public/testing'
import { editorElement } from './editorElement'

/**
 * Tab is the only key a page has for walking between its controls, and this editor binds it. Every
 * assertion here is about the way back out: the key reaching the editor and not being consumed, so
 * that the browser does with it what it would have done if nothing had been listening.
 *
 * `defaultPrevented` is what stands in for focus actually moving — happy-dom has no focus order to
 * traverse, and consuming the key is the only thing that could stop a browser that does.
 */

const highlightsMap = new Map<string, unknown>()
const mockRegistry = {
  delete: (name: string) => highlightsMap.delete(name),
  set: (name: string, highlight: unknown) => {
    highlightsMap.set(name, highlight)
  },
}

class MockHighlight extends Set<Range> {}

describe('tab-focus mode', () => {
  let container: HTMLElement
  let editor: Editor

  beforeEach(() => {
    highlightsMap.clear()
    // @ts-expect-error — happy-dom has no Highlight constructor
    globalThis.Highlight = MockHighlight
    setHighlightRegistry(mockRegistry)
    resetEditorInstanceCount()
    container = document.createElement('div')
    document.body.appendChild(container)
    editor = new Editor(container)
  })

  afterEach(() => {
    editor.dispose()
    container.remove()
    setHighlightRegistry(undefined)
  })

  it('keeps Tab for indentation until someone asks otherwise', () => {
    open('alpha', 0)

    const event = pressKey('Tab')

    expect(editor.materializeFullText()).toMatch(/^[ \t]+alpha$/)
    expect(event.defaultPrevented).toBe(true)
    expect(editor.isTabMovesFocusEnabled()).toBe(false)
  })

  it('leaves the key alone once the reader has asked for it', () => {
    open('alpha', 0)
    editor.setTabMovesFocus(true)

    const event = pressKey('Tab')

    expect(editor.materializeFullText()).toBe('alpha')
    expect(event.defaultPrevented).toBe(false)
  })

  it('leaves shift+Tab alone as well, which outdents just as far into the document', () => {
    open('\talpha', 1)
    editor.setTabMovesFocus(true)

    const event = pressKey('Tab', { shiftKey: true })

    expect(editor.materializeFullText()).toBe('\talpha')
    expect(event.defaultPrevented).toBe(false)
  })

  it('starts in whichever state the host mounted it in', () => {
    const hosted = new Editor(container, { tabMovesFocus: true })

    expect(hosted.isTabMovesFocusEnabled()).toBe(true)
    expect(editor.isTabMovesFocusEnabled()).toBe(false)

    hosted.dispose()
  })

  it('reports the state the setter left it in', () => {
    expect(editor.setTabMovesFocus(true)).toBe(true)
    expect(editor.isTabMovesFocusEnabled()).toBe(true)

    expect(editor.setTabMovesFocus(false)).toBe(false)
    expect(editor.isTabMovesFocusEnabled()).toBe(false)
  })

  it('lets nothing the editor is in the middle of keep the key', () => {
    open('con', 3)
    editor.setInlineSuggestion({ from: 0, to: 3, text: 'const answer' })
    editor.setTabMovesFocus(true)

    const event = pressKey('Tab')

    // Taking the suggestion would be a perfectly good use of Tab, and is exactly the kind of state
    // that leaves a reader with no key left to leave by.
    expect(editor.materializeFullText()).toBe('con')
    expect(event.defaultPrevented).toBe(false)
  })

  it('is turned on and off by its own chord, from the keyboard', () => {
    open('alpha', 0)

    pressDefaultChord('editor.action.toggleTabFocusMode')
    expect(editor.isTabMovesFocusEnabled()).toBe(true)

    pressDefaultChord('editor.action.toggleTabFocusMode')
    expect(editor.isTabMovesFocusEnabled()).toBe(false)
  })

  it('says what the key now does, for the reader who cannot see it change', () => {
    open('alpha', 0)

    expect(editor.dispatchCommand('editor.action.toggleTabFocusMode')).toBe(true)
    expect(alertTexts()).toContain('Tab moves focus out of the editor')

    editor.dispatchCommand('editor.action.toggleTabFocusMode')
    expect(alertTexts()).toContain('Tab inserts indentation')
  })

  it('interrupts with it rather than waiting for a gap', () => {
    open('alpha', 0)

    editor.dispatchCommand('editor.action.toggleTabFocusMode')

    expect(container.querySelectorAll('[role="alert"]')).toHaveLength(2)
    expect(statusTexts().join('')).toBe('')
  })

  it('takes a chord on every platform, and one the platform has left', () => {
    for (const platform of ['mac', 'windows', 'linux'] as const) {
      const hotkey = defaultEditorKeyBindings(platform).find(
        (binding) => binding.command === 'editor.action.toggleTabFocusMode',
      )?.chord[0]
      expect(hotkey, platform).toEqual({
        key: 'M',
        ctrl: true,
        ...(platform === 'mac' ? { shift: true } : {}),
      })
    }
  })

  it('travels in the same pack as the key it hands back', () => {
    expect(editorCommandPackForCommand('editor.action.toggleTabFocusMode')).toBe('text-editing')

    // A host that offers Tab offers the way out of it in the same breath, and one that offers
    // neither cannot end up shipping only the trap.
    const commands = editorKeymapLayerForCommandPack('text-editing').bindings.map(
      (binding) => binding.command,
    )
    expect(commands).toContain('indentSelection')
    expect(commands).toContain('editor.action.toggleTabFocusMode')
  })

  it('is in the registry a host binding drives options through', () => {
    // A framework binding never names an option; it walks this list. A setter with no entry beside
    // it is reachable from a call and from nothing a host writes down.
    const descriptor = EDITOR_OPTION_DESCRIPTORS.find((entry) => entry.name === 'tabMovesFocus')
    if (!descriptor) throw new Error('tabMovesFocus is not in the option registry')

    descriptor.applyTo(editor, descriptor.validate(true))
    expect(editor.isTabMovesFocusEnabled()).toBe(true)

    // Anything that is not a state gets no state: a prop arriving as a string is a host that has
    // not said which way it wants this, not a request to turn it off.
    descriptor.applyTo(editor, descriptor.validate('false'))
    expect(editor.isTabMovesFocusEnabled()).toBe(true)
  })

  function open(text: string, caret: number): void {
    editor.openDocument({ documentId: 'main.ts', text })
    editor.setSelection(caret, caret)
  }

  function pressKey(key: string, init: KeyboardEventInit = {}): KeyboardEvent {
    const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key, ...init })
    // The scroll element is where the input handlers are bound. It is private on Editor and no
    // testing seam exposes it, and its class is shared with every other virtualized view a host may
    // mount, so a DOM query could answer with the wrong one.
    editorElement(editor).dispatchEvent(event)
    return event
  }

  /**
   * Presses whatever the default keymap ships for a command on the platform under test. Reaching
   * the command any other way would pass just as well on a platform that binds nothing to it.
   */
  function pressDefaultChord(command: 'editor.action.toggleTabFocusMode'): KeyboardEvent {
    const platform = detectPlatform()
    const hotkey = defaultEditorKeyBindings(platform).find((binding) => binding.command === command)
      ?.chord[0]
    if (hotkey === undefined || typeof hotkey === 'string' || hotkey.key === undefined) {
      throw new Error(`${command} has no default chord on ${platform}`)
    }

    return pressKey(hotkey.key, {
      altKey: hotkey.alt === true,
      ctrlKey: hotkey.ctrl === true || (hotkey.mod === true && platform !== 'mac'),
      metaKey: hotkey.meta === true || (hotkey.mod === true && platform === 'mac'),
      shiftKey: hotkey.shift === true,
    })
  }

  function alertTexts(): (string | null)[] {
    return regionTexts('alert')
  }

  function statusTexts(): (string | null)[] {
    return regionTexts('status')
  }

  function regionTexts(role: 'alert' | 'status'): (string | null)[] {
    return [...container.querySelectorAll(`[role="${role}"]`)].map((region) => region.textContent)
  }
})
