import { describe, expect, it } from 'vitest'
import {
  createKeyInput,
  keyInputFromKeyboardEvent,
  matchesKeyInput,
  matchesKeyboardEvent,
  normalizeHotkeyFromKeyInput,
  parseKeyInput,
} from '../src'
import type { Hotkey, KeyboardEventLike } from '../src'

function keyboardEvent(
  init: Partial<KeyboardEventLike> & { altGraph?: boolean },
): KeyboardEventLike {
  const { altGraph = false, ...rest } = init
  return {
    type: 'keydown',
    key: '',
    code: '',
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    metaKey: false,
    repeat: false,
    isComposing: false,
    getModifierState: (modifier) => modifier === 'AltGraph' && altGraph,
    ...rest,
  }
}

describe('createKeyInput', () => {
  it('normalizes key names and defaults every field', () => {
    expect(createKeyInput({ key: 'esc' })).toEqual({
      type: 'keydown',
      key: 'Escape',
      code: '',
      modifiers: { ctrl: false, shift: false, alt: false, meta: false, altGraph: false },
      repeat: false,
      composing: false,
    })
  })

  it('treats Process and Unidentified keys as composition', () => {
    expect(createKeyInput({ key: 'Process', code: 'KeyA' }).composing).toBe(true)
    expect(createKeyInput({ key: 'Unidentified' }).composing).toBe(true)
  })

  it('composes decomposed Unicode so it compares with typed bindings', () => {
    expect(createKeyInput({ key: 'é' }).key).toBe(createKeyInput({ key: 'é' }).key)
  })
})

describe('keyInputFromKeyboardEvent', () => {
  it('copies type, key, code, modifiers, repeat and composition', () => {
    const input = keyInputFromKeyboardEvent(
      keyboardEvent({ type: 'keyup', key: 'k', code: 'KeyK', ctrlKey: true, repeat: true }),
      'linux',
    )
    expect(input).toEqual({
      type: 'keyup',
      key: 'K',
      code: 'KeyK',
      modifiers: { ctrl: true, shift: false, alt: false, meta: false, altGraph: false },
      repeat: true,
      composing: false,
    })
  })

  it('reads AltGraph off mac and ignores it on mac, where it reports Option', () => {
    const event = keyboardEvent({
      key: '@',
      code: 'KeyQ',
      ctrlKey: true,
      altKey: true,
      altGraph: true,
    })
    expect(keyInputFromKeyboardEvent(event, 'windows').modifiers.altGraph).toBe(true)
    expect(keyInputFromKeyboardEvent(event, 'mac').modifiers.altGraph).toBe(false)
  })

  it('survives getModifierState throwing', () => {
    const event = keyboardEvent({
      key: 'a',
      getModifierState: () => {
        throw new Error('unsupported')
      },
    })
    expect(keyInputFromKeyboardEvent(event, 'linux').modifiers.altGraph).toBe(false)
  })

  it('marks isComposing events as composing', () => {
    expect(
      keyInputFromKeyboardEvent(keyboardEvent({ key: 'a', isComposing: true }), 'linux').composing,
    ).toBe(true)
  })
})

describe('matching a KeyInput', () => {
  it('matches the same bindings as the KeyboardEvent it came from', () => {
    const cases: Array<[KeyboardEventLike, Hotkey]> = [
      [keyboardEvent({ key: 's', code: 'KeyS', ctrlKey: true }), 'Mod+S'],
      [keyboardEvent({ key: 'ы', code: 'KeyS', ctrlKey: true }), 'Mod+S'],
      [keyboardEvent({ key: '?', code: 'Slash', shiftKey: true }), '?'],
      [keyboardEvent({ key: 's', code: 'KeyS', ctrlKey: true }), 'Mod+[KeyS]'],
      [
        keyboardEvent({ key: '@', code: 'KeyQ', ctrlKey: true, altKey: true, altGraph: true }),
        'Control+Alt+Q',
      ],
    ]
    for (const [event, hotkey] of cases) {
      const input = keyInputFromKeyboardEvent(event, 'linux')
      expect(matchesKeyInput(input, hotkey, 'linux')).toBe(
        matchesKeyboardEvent(event as KeyboardEvent, hotkey, 'linux'),
      )
    }
  })

  it('matches terminal-style input with no code by key alone', () => {
    const input = createKeyInput({ key: 'c', modifiers: { ctrl: true } })
    expect(matchesKeyInput(input, 'Control+C', 'linux')).toBe(true)
    expect(matchesKeyInput(input, 'Control+[KeyC]', 'linux')).toBe(false)
  })

  it('never matches printable bindings while composing', () => {
    const input = createKeyInput({ key: 'a', code: 'KeyA', composing: true })
    expect(matchesKeyInput(input, 'A', 'linux')).toBe(false)
  })

  it('parses and normalizes an input as a hotkey', () => {
    const input = createKeyInput({ key: 's', code: 'KeyS', modifiers: { meta: true, shift: true } })
    expect(parseKeyInput(input)).toMatchObject({ key: 'S', meta: true, shift: true, ctrl: false })
    expect(normalizeHotkeyFromKeyInput(input, 'mac')).toBe('Mod+Shift+S')
  })

  it('drops the synthetic Control+Alt of AltGraph when parsing', () => {
    const input = createKeyInput({ key: '@', modifiers: { ctrl: true, alt: true, altGraph: true } })
    expect(parseKeyInput(input)).toMatchObject({ key: '@', ctrl: false, alt: false })
  })
})
