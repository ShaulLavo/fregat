import { expect, test } from 'vitest'
import { readCredits } from './usage-feed'
import * as creditLeaf from './usage-feed'

test.each([
  [undefined, undefined],
  [{}, undefined],
  [{ 'X-Codex-Credits-Has-Credits': 'false', 'X-Codex-Credits-Unlimited': '0' }, null],
  [
    {
      'X-Codex-Credits-Has-Credits': ' TRUE ',
      'x-codex-credits-unlimited': 'false',
      'X-Codex-Credits-Balance': ' 62.5 ',
    },
    { balance: 62.5, unlimited: false },
  ],
  [
    {
      'x-codex-credits-has-credits': '0',
      'x-codex-credits-unlimited': '1',
      'x-codex-credits-balance': '0',
    },
    { balance: 0, unlimited: true },
  ],
  [
    {
      'x-codex-credits-has-credits': 'true',
      'x-codex-credits-unlimited': 'false',
      'x-codex-credits-balance': '-1',
    },
    undefined,
  ],
  [
    {
      'x-codex-credits-has-credits': 'true',
      'x-codex-credits-unlimited': 'false',
      'x-codex-credits-balance': '1e3',
    },
    undefined,
  ],
  [
    {
      'x-codex-credits-has-credits': 'unknown',
      'x-codex-credits-unlimited': 'false',
      'x-codex-credits-balance': '1',
    },
    undefined,
  ],
] as const)(
  'credits retain absent, unknown and observed distinctions for %j',
  (signals, expected) => {
    expect(readCredits(signals)).toEqual(expected)
  },
)

test('retained usage-feed leaf exports only readCredits', () => {
  expect(Object.keys(creditLeaf)).toEqual(['readCredits'])
})
