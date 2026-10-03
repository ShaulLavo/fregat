import { parseHotkey } from '@fregat/hotkeys'

import { expect, test } from '../../../test/fixtures'
import {
  chordKeys,
  chordStrokes,
  isBindableChord,
  MAX_CHORD_STROKES,
  normalizedChord,
  parsedChord,
} from '@workspace/client-core/commands/chord'

test.each(['Mod+K Mod+S', 'Ctrl+W V', 'Mod+K Escape', 'F1', 'Space', 'Mod+K Mod+,'])(
  'accepts %s',
  (keys) => {
    expect(isBindableChord(keys)).toBe(true)
  },
)

test.each([
  '',
  ' ',
  'Mod+K ',
  ' Mod+K',
  'Mod+K  Mod+S',
  'Mod+K\tMod+S',
  'Mod+K Mod+Nonsense',
  'Mod+K Mod+S Mod+X',
  'K Mod+S',
  'Alt+K S',
  'Shift+K S',
])('rejects %j', (keys) => {
  expect(isBindableChord(keys)).toBe(false)
})

test('keeps both strokes separate during parsing and normalization', () => {
  const keys = 'mod+k mod+s'
  const chord = parsedChord(keys, 'mac')
  expect(chord).toHaveLength(2)
  expect(chordKeys(chord, 'mac')).toBe('Mod+K Mod+S')
  expect(normalizedChord(keys, 'mac')).toBe('Mod+K Mod+S')
  expect(
    chordStrokes(chordKeys(chord, 'mac')).map((stroke) => parseHotkey(stroke, 'mac').key),
  ).toEqual(['K', 'S'])
})

test('normalizes string and raw object strokes using the requested platform', () => {
  expect(chordKeys(['Control+K', { ctrl: true, key: 's' }], 'linux')).toBe('Mod+K Mod+S')
  expect(chordKeys(['Control+K', { ctrl: true, key: 's' }], 'mac')).toBe('Control+K Control+S')
})

test('caps grammar at the shared depth limit', () => {
  expect(isBindableChord(Array(MAX_CHORD_STROKES).fill('Mod+K').join(' '))).toBe(true)
  expect(
    isBindableChord(
      Array(MAX_CHORD_STROKES + 1)
        .fill('Mod+K')
        .join(' '),
    ),
  ).toBe(false)
})
