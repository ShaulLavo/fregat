import { describe, expect, it } from 'vitest'

import { recordingStep } from '@/features/settings/utils/shortcut-recording'

const key = (value: string, modifiers: { ctrl?: boolean; shift?: boolean } = {}) => ({
  key: value,
  altKey: false,
  ctrlKey: modifiers.ctrl ?? false,
  metaKey: false,
  shiftKey: modifiers.shift ?? false,
})

describe('recordingStep', () => {
  it('saves on Enter only once something is recorded', () => {
    expect(recordingStep([], key('Enter'), 'linux')).toEqual({ kind: 'ignore' })
    expect(recordingStep(['Mod+K'], key('Enter'), 'linux')).toEqual({ kind: 'save' })
  })

  it('clears on the first Escape and closes on the second', () => {
    expect(recordingStep(['Mod+K'], key('Escape'), 'linux')).toEqual({ kind: 'clear' })
    expect(recordingStep([], key('Escape'), 'linux')).toEqual({ kind: 'close' })
  })

  it('records Backspace as a key', () => {
    expect(recordingStep([], key('Backspace'), 'linux')).toEqual({
      kind: 'record',
      strokes: ['Backspace'],
    })
  })

  it('adds a second stroke only after a Ctrl or Cmd first stroke, and starts over on a third', () => {
    expect(recordingStep(['Mod+K'], key('s', { ctrl: true }), 'linux')).toEqual({
      kind: 'record',
      strokes: ['Mod+K', 'Mod+S'],
    })
    expect(recordingStep(['F2'], key('s', { ctrl: true }), 'linux')).toEqual({
      kind: 'record',
      strokes: ['Mod+S'],
    })
    expect(recordingStep(['Mod+K', 'Mod+S'], key('j', { ctrl: true }), 'linux')).toEqual({
      kind: 'record',
      strokes: ['Mod+J'],
    })
  })

  it('ignores a modifier pressed on its own', () => {
    expect(recordingStep([], key('Control', { ctrl: true }), 'linux')).toEqual({ kind: 'ignore' })
  })
})
