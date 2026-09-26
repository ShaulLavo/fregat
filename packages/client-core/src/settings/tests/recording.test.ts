import { describe, expect, it } from 'vitest'
import { recordedStroke } from '../recording'

const press = (key: string, modifiers: { ctrl?: boolean; meta?: boolean; alt?: boolean } = {}) => ({
  key,
  altKey: modifiers.alt ?? false,
  ctrlKey: modifiers.ctrl ?? false,
  metaKey: modifiers.meta ?? false,
  shiftKey: false,
})

describe('recordedStroke', () => {
  it('records Cmd as Mod and Control as Control on macOS', () => {
    expect(recordedStroke(press('k', { meta: true }), 'mac')).toBe('Mod+K')
    expect(recordedStroke(press('1', { ctrl: true }), 'mac')).toBe('Control+1')
  })

  it('records Ctrl as Mod and Super as Meta elsewhere', () => {
    expect(recordedStroke(press('k', { ctrl: true }), 'linux')).toBe('Mod+K')
    expect(recordedStroke(press('k', { meta: true }), 'linux')).toBe('Meta+K')
    expect(recordedStroke(press('k', { ctrl: true, alt: true }), 'windows')).toBe('Mod+Alt+K')
  })
})
