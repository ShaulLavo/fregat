import { expect, test } from '../../../../../test/fixtures'

import {
  isBackShortcut,
  isForwardShortcut,
  isOpenShortcut,
  listCountLabel,
  isGoToFolderShortcut,
  isGoUpShortcut,
  isPrintablePickerKey,
  isToggleHiddenShortcut,
  type PickerKeyboardEvent,
} from '@/features/file-picker/utils/keyboard'

test('recognizes picker command shortcuts on macOS and non-macOS keyboards', () => {
  expect(isGoToFolderShortcut(keyEvent('g', { metaKey: true, shiftKey: true }))).toBe(true)
  expect(isToggleHiddenShortcut(keyEvent('.', { ctrlKey: true, shiftKey: true }))).toBe(true)
  expect(
    isToggleHiddenShortcut(keyEvent('>', { code: 'Period', metaKey: true, shiftKey: true })),
  ).toBe(true)
  expect(isGoUpShortcut(keyEvent('ArrowUp', { metaKey: true }))).toBe(true)
})

test('back, forward and open follow Finder, and plain keys stay with the list', () => {
  expect(isBackShortcut(keyEvent('[', { metaKey: true }))).toBe(true)
  expect(isBackShortcut(keyEvent('{', { code: 'BracketLeft', ctrlKey: true }))).toBe(true)
  expect(isForwardShortcut(keyEvent(']', { ctrlKey: true }))).toBe(true)
  expect(isOpenShortcut(keyEvent('ArrowDown', { metaKey: true }))).toBe(true)
  expect(isOpenShortcut(keyEvent('ArrowDown'))).toBe(false)
  expect(isOpenShortcut(keyEvent('ArrowDown', { metaKey: true, shiftKey: true }))).toBe(false)
  expect(isBackShortcut(keyEvent('['))).toBe(false)
})

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
