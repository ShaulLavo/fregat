import { existsSync } from 'node:fs'
import { expect, test } from 'vitest'

import { isHost, launchCommand, PI_LAUNCHER } from './job'

test('a pi job runs through the Pi launcher with its unit and accounting file', () => {
  expect(isHost('pi')).toBe(true)
  expect(existsSync(PI_LAUNCHER)).toBe(true)
  expect(
    launchCommand('pi', {
      unit: 'heavy-1.scope',
      accountingFile: '/run/a',
      command: ['bun', 'x y'],
    }),
  ).toEqual([process.execPath, PI_LAUNCHER, 'heavy-1.scope', '/run/a', 'bun', 'x y'])
})
