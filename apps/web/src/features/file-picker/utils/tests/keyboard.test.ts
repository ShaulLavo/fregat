import { expect, test } from '../../../../../test/fixtures'

import {
  listCountLabel,
  isPrintablePickerKey,
  type PickerKeyboardEvent,
} from '@/features/file-picker/utils/keyboard'

test('counts items, or results while searching', () => {
  expect(listCountLabel(1, false)).toBe('1 item')
  expect(listCountLabel(12, false)).toBe('12 items')
  expect(listCountLabel(3, true)).toBe('3 results')
})

test('forwards only unmodified printable keys into search', () => {
  expect(isPrintablePickerKey(keyEvent('g'))).toBe(true)
  expect(isPrintablePickerKey(keyEvent(' ', { shiftKey: true }))).toBe(true)
  expect(isPrintablePickerKey(keyEvent('g', { metaKey: true }))).toBe(false)
  expect(isPrintablePickerKey(keyEvent('ArrowDown'))).toBe(false)
})

function keyEvent(key: string, overrides: Partial<PickerKeyboardEvent> = {}): PickerKeyboardEvent {
  return {
    altKey: false,
    ctrlKey: false,
    key,
    metaKey: false,
    shiftKey: false,
    ...overrides,
  }
}
