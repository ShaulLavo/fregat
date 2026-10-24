// Key cases from apps/tui/src/commands/tests/keymap.test.ts, as OpenTUI parses them.
import { describe, expect, it, vi } from 'vitest'
import {
  createDispatcher,
  keyInputFromTerminalKey,
  matchesKeyInput,
  terminalKeyEffects,
} from '../src'
import type { TerminalKeyLike } from '../src'

function key(name: string, init: Partial<TerminalKeyLike> = {}): TerminalKeyLike {
  return {
    name,
    ctrl: false,
    shift: false,
    meta: false,
    option: false,
    eventType: 'press',
    ...init,
  }
}

describe('keyInputFromTerminalKey', () => {
  it('maps terminal key names to key names', () => {
    expect(keyInputFromTerminalKey(key('up')).key).toBe('ArrowUp')
    expect(keyInputFromTerminalKey(key('return')).key).toBe('Enter')
    expect(keyInputFromTerminalKey(key('escape')).key).toBe('Escape')
    expect(keyInputFromTerminalKey(key('space')).key).toBe('Space')
    expect(keyInputFromTerminalKey(key('f2')).key).toBe('F2')
    expect(keyInputFromTerminalKey(key('k')).key).toBe('K')
  })

  it('reads Control+K (0x0b) as Control+K', () => {
    const input = keyInputFromTerminalKey(key('k', { ctrl: true }))
    expect(matchesKeyInput(input, 'Control+K', 'linux')).toBe(true)
    expect(input.code).toBe('')
  })

  it('reads legacy Alt (ESC s) as Alt, never as the desktop Meta key', () => {
    const input = keyInputFromTerminalKey(key('s', { meta: true }))
    expect(input.modifiers).toMatchObject({ alt: true, meta: false })
    expect(matchesKeyInput(input, 'Alt+S', 'linux')).toBe(true)
    expect(keyInputFromTerminalKey(key('s', { option: true })).modifiers.alt).toBe(true)
    expect(keyInputFromTerminalKey(key('s', { super: true })).modifiers.meta).toBe(true)
  })

  it('matches Kitty shifted punctuation like the legacy printed character', () => {
    const legacy = keyInputFromTerminalKey(key('?'))
    const kitty = keyInputFromTerminalKey(key('?', { shift: true }))
    expect(kitty).toEqual(legacy)
    expect(matchesKeyInput(kitty, '?', 'linux')).toBe(true)
  })

  it('keeps Shift on letters and modified symbols', () => {
    expect(keyInputFromTerminalKey(key('a', { shift: true })).modifiers.shift).toBe(true)
    expect(keyInputFromTerminalKey(key('/', { shift: true, ctrl: true })).modifiers.shift).toBe(
      true,
    )
  })

  it('reads Kitty release and repeat events', () => {
    expect(keyInputFromTerminalKey(key('s', { eventType: 'release' })).type).toBe('keyup')
    expect(keyInputFromTerminalKey(key('s', { eventType: 'repeat' })).repeat).toBe(true)
    expect(keyInputFromTerminalKey(key('s', { repeated: true })).repeat).toBe(true)
  })
})

describe('a terminal host on the dispatcher', () => {
  it('runs a chord, swallows its strokes and ignores the release', () => {
    const calls: string[] = []
    const dispatcher = createDispatcher<TerminalKeyLike>({
      platform: 'linux',
      effects: terminalKeyEffects,
      keymap: [{ keys: 'Control+K S', command: 'settings.open' }],
    })
    dispatcher
      .createNode({ commands: { 'settings.open': () => void calls.push('settings') } })
      .focus()
    const feed = (event: TerminalKeyLike) =>
      dispatcher.handleKey(keyInputFromTerminalKey(event), event)
    const prefix = key('k', { ctrl: true, preventDefault: vi.fn() })
    expect(feed(prefix)).toBe(true)
    expect(prefix.preventDefault).toHaveBeenCalled()
    expect(feed(key('s'))).toBe(true)
    expect(feed(key('s', { eventType: 'release' }))).toBe(true)
    expect(calls).toEqual(['settings'])
    expect(feed(key('q'))).toBe(false)
  })

  it('replays a mismatched prefix so the shell still receives it', () => {
    const shell: string[] = []
    const dispatcher = createDispatcher<TerminalKeyLike>({
      platform: 'linux',
      effects: terminalKeyEffects,
      keymap: [{ keys: 'Control+K S', command: 'settings.open' }],
      replay: (input) => shell.push(`${input.modifiers.ctrl ? 'C-' : ''}${input.key}`),
    })
    dispatcher.createNode().focus()
    dispatcher.handleKey(keyInputFromTerminalKey(key('k', { ctrl: true })), key('k'))
    expect(dispatcher.handleKey(keyInputFromTerminalKey(key('x')), key('x'))).toBe(false)
    expect(shell).toEqual(['C-K'])
  })
})
