import { expect, test } from 'vitest'
import { isSettingAvailable } from '../utils/availability'

test('an opaque native Mac window can enable window transparency', () => {
  expect(
    isSettingAvailable('window.transparency', {
      platform: 'darwin',
      backdrop: 'app',
      nativeTransparency: false,
    }),
  ).toBe(true)
})

test('an ordinary browser keeps the host transparency setting unavailable', () => {
  expect(
    isSettingAvailable('window.transparency', {
      backdrop: 'app',
      nativeTransparency: false,
    }),
  ).toBe(false)
})
