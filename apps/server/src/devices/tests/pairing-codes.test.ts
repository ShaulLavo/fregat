import { expect, test } from 'vitest'

import { PairingCodes } from '../pairing-codes'

test('a code works once, and not after five minutes', () => {
  const codes = new PairingCodes()
  const first = codes.issue(0)
  const late = codes.issue(0)

  expect(first.code).toMatch(/^[A-HJ-NP-Z2-9]{12}$/)
  expect(codes.claim(first.code, 1_000)).toBe('accepted')
  expect(codes.claim(first.code, 1_000)).toBe('invalid')
  expect(codes.claim(late.code, 5 * 60_000 + 1)).toBe('invalid')
})

test('ten wrong codes in a minute stop every claim until the minute passes', () => {
  const codes = new PairingCodes()
  const real = codes.issue(0)
  for (let attempt = 0; attempt < 10; attempt += 1) codes.claim('AAAAAAAAAAAA', 1_000)

  expect(codes.claim(real.code, 2_000)).toBe('rate-limited')
  expect(codes.claim(real.code, 62_000)).toBe('accepted')
})
