import { expect, test } from 'vitest'

import { defaultOutput } from './output'

const now = new Date('2026-10-01T10:50:51.123Z')

test('writes under the evidence root the environment names', () => {
  expect(defaultOutput(now, '/home/pi/fregat-lane/runs/x')).toBe(
    '/home/pi/fregat-lane/runs/x/20261001T105051123Z-large-files',
  )
})

test('keeps the local evidence directory when none is named', () => {
  expect(defaultOutput(now, undefined)).toBe(
    '/work/tmp/fregat-evidence/20261001T105051123Z-large-files',
  )
})
