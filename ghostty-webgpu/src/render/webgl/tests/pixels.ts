import { expect } from 'vitest'

export function expectPixelsEqual(actual: Uint8Array, expected: Uint8Array): void {
  expect(actual).toEqual(expected)
}
