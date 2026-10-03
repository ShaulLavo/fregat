import { existsSync } from 'node:fs'
import { expect, test } from 'vitest'

import { isHost, localCommand, PI_LAUNCHER, piCommand, SCOPE_SHIM } from './job'

const launch = { unit: 'heavy-1.scope', accountingFile: '/run/a', command: ['bun', 'x y'] }

test('a pi job runs through the Pi launcher with its unit, accounting file and ceiling', () => {
  expect(isHost('pi')).toBe(true)
  expect(existsSync(PI_LAUNCHER)).toBe(true)
  expect(piCommand({ ...launch, maxWallSec: 120 })).toEqual([
    process.execPath,
    PI_LAUNCHER,
    'heavy-1.scope',
    '/run/a',
    '120',
    'bun',
    'x y',
  ])
  expect(piCommand(launch)[4]).toBe('3600')
})

test('a local job runs in its slice, and the shim accounts for the whole slice', () => {
  expect(localCommand({ ...launch, graceSeconds: 7, slice: 'heavy-1.slice' })).toEqual([
    'systemd-run',
    '--user',
    '--scope',
    '--quiet',
    '--unit=heavy-1.scope',
    '--slice=heavy-1.slice',
    '--expand-environment=no',
    '-p',
    'OOMPolicy=continue',
    'bash',
    '-p',
    SCOPE_SHIM,
    '--slice',
    '--grace',
    '7',
    '/run/a',
    'bun',
    'x y',
  ])
})

test('a finite local job gives the shim its whole-slice runtime budget', () => {
  const command = localCommand({
    ...launch,
    graceSeconds: 1,
    runtimeLimitSeconds: 9,
    slice: 'heavy-1.slice',
  })
  expect(command).toContain('RuntimeMaxSec=9s')
  const runtime = command.indexOf('--runtime')
  expect(runtime).toBeGreaterThan(command.indexOf(SCOPE_SHIM))
  expect(command.slice(runtime, runtime + 2)).toEqual(['--runtime', '9'])
})

test('a quiet job passes its immutable boot-time deadline to the in-scope guard', () => {
  const command = localCommand({
    ...launch,
    graceSeconds: 1,
    runtimeLimitSeconds: 9,
    runtimeDeadline: 123.45,
    slice: 'heavy-1.slice',
  })
  const deadline = command.indexOf('--deadline')
  expect(deadline).toBeGreaterThan(command.indexOf(SCOPE_SHIM))
  expect(command.slice(deadline, deadline + 2)).toEqual(['--deadline', '12345'])
})
