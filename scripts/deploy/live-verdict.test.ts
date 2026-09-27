import { expect, test } from 'vitest'
import { liveVerdict } from './live-verdict.mjs'

test('shared log noise cannot fail a healthy candidate when a group crosses its daily budget', () => {
  expect(
    liveVerdict(
      {
        failures: [],
        logNoise: { failures: ['log noise: warn environments machine.events -'] },
      },
      [],
    ),
  ).toEqual({ status: 'passed', fresh: [] })
})

test('a failed candidate check remains visible alongside shared diagnostics', () => {
  expect(
    liveVerdict(
      {
        failures: ['no successful /health response', 'known failure'],
        logNoise: { failures: ['log noise: warn environments machine.events -'] },
      },
      ['known failure'],
    ),
  ).toEqual({ status: 'failed', fresh: ['no successful /health response'] })
})
