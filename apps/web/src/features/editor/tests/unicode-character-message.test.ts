import { test, expect } from '../../../../test/fixtures'
import { unicodeCharacterMessage } from '@/features/editor/utils/unicode-character-message'

test('explains an en dash using the actual ASCII comparison', () => {
  expect(unicodeCharacterMessage(0x2013, 'ambiguous')).toContain('`U+002D` `-`')
})

test('explains a lookalike letter and a supplementary-plane character', () => {
  expect(unicodeCharacterMessage(0x430, 'ambiguous')).toContain('`U+0061` `a`')
  expect(unicodeCharacterMessage(0x1d41a, 'ambiguous')).toContain('`U+1D41A`')
})

test('identifies invisible controls without rendering them into the tooltip', () => {
  const message = unicodeCharacterMessage(0x202e, 'invisible')
  expect(message).toBe('The character `U+202E` is invisible.')
  expect(message).not.toContain('\u202e')
})
