import { existsSync } from 'node:fs'
import { expect, test } from 'vitest'

import { isHost, launchCommand, PI_LAUNCHER } from './job'

const launch = { unit: 'heavy-1.scope', accountingFile: '/run/a', command: ['bun', 'x y'] }

test('a pi job runs through the Pi launcher with its unit, accounting file and ceiling', () => {
  expect(isHost('pi')).toBe(true)
  expect(existsSync(PI_LAUNCHER)).toBe(true)
  expect(launchCommand('pi', { ...launch, maxWallSec: 120 })).toEqual([
    process.execPath,
    PI_LAUNCHER,
    'heavy-1.scope',
    '/run/a',
    '120',
    'bun',
    'x y',
  ])
  expect(launchCommand('pi', launch)[4]).toBe('3600')
})
