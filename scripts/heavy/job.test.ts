import { existsSync, readdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { expect, test } from 'vitest'

import { reaperSandbox } from './reaper-sandbox'

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

const locks = process.platform === 'linux' ? await import('./lock').catch(() => null) : null

function assertReleased(state: string) {
  expect(readdirSync(path.join(state, 'queue')).filter((name) => name.endsWith('.json'))).toEqual(
    [],
  )
  for (const file of ['admission.lock', 'slot1.lock', 'slot2.lock', 'slot3.lock']) {
    const fd = locks!.tryLock(path.join(state, file))
    expect(fd).not.toBeNull()
    if (fd !== null) locks!.unlock(fd)
  }
}

test('a responsive private manager reaps one orphan exactly once and leaves other roots alone', async (context) => {
  if (!locks) context.skip('Requires Bun FFI and a libc flock implementation')
  const box = reaperSandbox()
  const orphan = box.addSlice('aaaaaaaaaaaa')
  box.addSlice('bbbbbbbbbbbb', `${box.sliceRoot}other`)
  writeFileSync(path.join(box.state, 'drain.request'), `pid=${process.pid} holder=fixture`)
  try {
    const job = box.start()
    await expect
      .poll(() => box.lifecycle().map((call) => call.operation), { timeout: 1500 })
      .toEqual(['kill', 'stop', 'revert'])
    await expect.poll(() => job.child.exitCode, { timeout: 4500 }).toBe(75)
    expect(await job.done).toBe(75)
    expect(box.lifecycle().map((call) => call.slice)).toEqual([orphan, orphan, orphan])
    assertReleased(box.state)
  } finally {
    await box.cleanup()
  }
}, 10_000)

test.for(['kill', 'stop', 'revert'])(
  'quiet admission expires while the private manager holds %s',
  { timeout: 10_000 },
  async (operation, context) => {
    if (!locks) context.skip('Requires Bun FFI and a libc flock implementation')
    const box = reaperSandbox(operation)
    box.addSlice('aaaaaaaaaaaa')
    writeFileSync(path.join(box.state, 'drain.request'), `pid=${process.pid} holder=fixture`)
    try {
      const job = box.start()
      await expect
        .poll(() => box.lifecycle().some((call) => call.operation === operation), { timeout: 1500 })
        .toBe(true)
      await expect.poll(() => job.child.exitCode, { timeout: 4500 }).toBe(75)
      expect(await job.done).toBe(75)
      expect(job.stderr()).toContain('wait reached its 2 s limit')
      expect(box.lifecycle().map((call) => call.operation)).toEqual(
        ['kill', 'stop', 'revert'].slice(0, ['kill', 'stop', 'revert'].indexOf(operation) + 1),
      )
      assertReleased(box.state)
    } finally {
      await box.cleanup()
    }
  },
)

test.for(['kill', 'stop'])(
  'cancellation drains the held private %s child before releasing admission',
  { timeout: 10_000 },
  async (operation, context) => {
    if (!locks) context.skip('Requires Bun FFI and a libc flock implementation')
    const box = reaperSandbox(operation)
    box.addSlice('aaaaaaaaaaaa')
    try {
      const job = box.start(false)
      await expect
        .poll(() => box.lifecycle().some((call) => call.operation === operation), { timeout: 1500 })
        .toBe(true)
      job.child.kill('SIGTERM')
      await expect.poll(() => job.child.exitCode, { timeout: 1500 }).toBe(143)
      expect(await job.done).toBe(143)
      assertReleased(box.state)
    } finally {
      await box.cleanup()
    }
  },
)
