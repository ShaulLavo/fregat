import {
  isPasteAsTextShortcut,
  nextPastedTextFileName,
  pastedTextFolds,
  PASTED_TEXT_ATTACHMENT_THRESHOLD_BYTES,
} from '@/features/chat/utils/pasted-text'
import { expect, test } from '../../../../../test/fixtures'

test('text folds at the byte threshold unless pasted inline', () => {
  const large = 'x'.repeat(PASTED_TEXT_ATTACHMENT_THRESHOLD_BYTES)
  expect(pastedTextFolds(large, false)).toBe(true)
  expect(pastedTextFolds(large.slice(1), false)).toBe(false)
  expect(pastedTextFolds(large, true)).toBe(false)
  // Three bytes per character: a third of the characters already reaches the threshold.
  expect(pastedTextFolds('€'.repeat(PASTED_TEXT_ATTACHMENT_THRESHOLD_BYTES / 3 + 1), false)).toBe(
    true,
  )
})

test('Ctrl/Cmd+Shift+V pastes inline, other chords do not', () => {
  const chord = { altKey: false, ctrlKey: true, key: 'V', metaKey: false, shiftKey: true }
  expect(isPasteAsTextShortcut(chord)).toBe(true)
  expect(isPasteAsTextShortcut({ ...chord, ctrlKey: false, metaKey: true })).toBe(true)
  expect(isPasteAsTextShortcut({ ...chord, shiftKey: false })).toBe(false)
  expect(isPasteAsTextShortcut({ ...chord, altKey: true })).toBe(false)
})

test('folded pastes get readable names that do not collide', () => {
  expect(nextPastedTextFileName(new Set())).toBe('pasted-text.txt')
  expect(nextPastedTextFileName(new Set(['pasted-text.txt', 'pasted-text-2.txt']))).toBe(
    'pasted-text-3.txt',
  )
})
