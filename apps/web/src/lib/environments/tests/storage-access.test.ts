import { afterEach, beforeEach, vi } from 'vitest'
import { expect, test } from '../../../../test/fixtures'
import { memoryLocalStorage } from '../../../../test/factories/local-storage'
import { testScopedStorage } from '../../../../test/factories/scoped-storage'
import { globalChromeStorage } from '@/lib/environments/state/scoped-storage'

beforeEach(() => vi.stubGlobal('localStorage', memoryLocalStorage()))
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

test('missing browser storage returns empty reads and an unavailable write', () => {
  vi.stubGlobal('localStorage', undefined)
  expect(globalChromeStorage.getItem('entry')).toBeNull()
  expect(globalChromeStorage.keys('')).toEqual([])
  expect(globalChromeStorage.setItem('entry', 'value')).toBe('unavailable')
  expect(() => globalChromeStorage.removeItem('entry')).not.toThrow()
})

test('a blocked localStorage getter cannot escape any accessor', () => {
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    get() {
      throw new DOMException('Storage access blocked', 'SecurityError')
    },
  })
  expect(globalChromeStorage.getItem('entry')).toBeNull()
  expect(globalChromeStorage.keys('')).toEqual([])
  expect(globalChromeStorage.setItem('entry', 'value')).toBe('storage-failed')
  expect(() => globalChromeStorage.removeItem('entry')).not.toThrow()
})

test('blocked methods return empty answers and preserve scoped write failure', () => {
  const blocked = () => {
    throw new DOMException('Storage access blocked', 'SecurityError')
  }
  vi.spyOn(localStorage, 'getItem').mockImplementation(blocked)
  vi.spyOn(localStorage, 'setItem').mockImplementation(blocked)
  vi.spyOn(localStorage, 'removeItem').mockImplementation(blocked)
  vi.spyOn(localStorage, 'length', 'get').mockImplementation(blocked)

  expect(testScopedStorage.getItem('entry')).toBeNull()
  expect(testScopedStorage.keys('')).toEqual([])
  expect(testScopedStorage.setItem('entry', 'value')).toBe('storage-failed')
  expect(() => testScopedStorage.removeItem('entry')).not.toThrow()
})

test('enumeration only exposes matching keys within the selected environment', () => {
  expect(testScopedStorage.setItem('cache.entry', 'kept')).toBe('written')
  globalChromeStorage.setItem('cache.global', 'outside')
  globalChromeStorage.setItem('env:another|cache.entry', 'outside')
  expect(testScopedStorage.keys('cache.')).toEqual(['cache.entry'])
})
