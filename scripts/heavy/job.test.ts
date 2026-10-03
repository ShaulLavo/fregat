import { existsSync, readdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { expect, test } from 'vitest'

import { reaperSandbox } from './reaper-sandbox'

import { isHost, localCommand, PI_LAUNCHER, piCommand, reapSlice, SCOPE_SHIM } from './job'

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

const locks = process.platform === 'linux' ? await import('./lock').catch(() => null) : null

function assertReleased(box: ReturnType<typeof reaperSandbox>) {
  expect(box.managerChildren()).toEqual([])
  const { state } = box
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
    assertReleased(box)
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
      assertReleased(box)
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
      assertReleased(box)
    } finally {
      await box.cleanup()
    }
  },
)

test('the reaper refuses a slice outside its root before contacting the manager', () => {
  expect(() =>
    reapSlice('heavytmine', 'heavy-0123abcd.slice', new AbortController().signal),
  ).toThrow('outside the slice root heavytmine')
})

test('one stop budget bounds reconciliation across multiple stalled orphans', async (context) => {
  if (!locks) context.skip('Requires Bun FFI and a libc flock implementation')
  const box = reaperSandbox('kill')
  box.addSlice('aaaaaaaaaaaa')
  box.addSlice('bbbbbbbbbbbb')
  try {
    const job = box.start(false)
    await expect.poll(() => box.lifecycle().length, { timeout: 1500 }).toBe(1)
    const locked = locks!.tryLock(path.join(box.state, 'admission.lock'))
    if (locked !== null) locks!.unlock(locked)
    expect(locked).toBeNull()
    await expect
      .poll(() => job.stderr(), { timeout: 5500 })
      .toContain('orphan reconciliation was interrupted')
    expect(box.lifecycle().map((call) => call.operation)).toEqual(['kill'])
    expect(box.managerChildren()).toEqual([])
    const available = locks!.tryLock(path.join(box.state, 'admission.lock'))
    if (available !== null) locks!.unlock(available)
    expect(available).not.toBeNull()
    job.child.kill('SIGTERM')
    await expect.poll(() => job.child.exitCode, { timeout: 1500 }).toBe(143)
    expect(await job.done).toBe(143)
    assertReleased(box)
  } finally {
    await box.cleanup()
  }
}, 10_000)

test('a locked owner keeps its slice while a neighboring orphan is reaped', async (context) => {
  if (!locks) context.skip('Requires Bun FFI and a libc flock implementation')
  const queue = await import('./queue')
  const box = reaperSandbox()
  const owner = box.addSlice('aaaaaaaaaaaa')
  const orphan = box.addSlice('bbbbbbbbbbbb')
  const held = queue.promote(
    box.state,
    queue.enqueue(box.state, {
      id: 'aaaaaaaaaaaa',
      label: 'fixture',
      jobClass: 'light',
      estimateBytes: 1048576,
      sliceRoot: box.sliceRoot,
      quiet: false,
      server: false,
      cwd: box.root,
      pid: process.pid,
      since: new Date().toISOString(),
    }),
  )
  writeFileSync(path.join(box.state, 'drain.request'), `pid=${process.pid} holder=fixture`)
  try {
    const job = box.start()
    await expect.poll(() => job.child.exitCode, { timeout: 4500 }).toBe(75)
    expect(await job.done).toBe(75)
    expect(box.lifecycle().map((call) => call.slice)).toEqual([orphan, orphan, orphan])
    expect(box.lifecycle().some((call) => call.slice === owner)).toBe(false)
    expect(existsSync(held.file)).toBe(true)
    assertReleased(box)
  } finally {
    queue.release(held)
    await box.cleanup()
  }
}, 10_000)

test.for(['show', 'stop'])(
  'quiet admission bounds a stalled deadline service %s',
  { timeout: 10_000 },
  async (operation, context) => {
    if (!locks) context.skip('Requires Bun FFI and a libc flock implementation')
    const box = reaperSandbox(operation, operation === 'stop')
    const orphan = box.addSlice('aaaaaaaaaaaa')
    const watchdog = `${orphan.slice(0, -'.slice'.length)}_deadline.service`
    writeFileSync(path.join(box.state, 'drain.request'), `pid=${process.pid} holder=fixture`)
    try {
      const job = box.start()
      await expect
        .poll(
          () =>
            box
              .managerCalls()
              .some((call) => call.operation === operation && call.slice === watchdog),
          { timeout: 1500 },
        )
        .toBe(true)
      await expect.poll(() => job.child.exitCode, { timeout: 4500 }).toBe(75)
      expect(await job.done).toBe(75)
      expect(job.stderr()).toContain('wait reached its 2 s limit')
      expect(box.lifecycle().map((call) => call.operation)).toEqual(['kill'])
      assertReleased(box)
    } finally {
      await box.cleanup()
    }
  },
)

test.for(['show', 'stop'])(
  'cancellation drains a stalled deadline service %s before releasing admission',
  { timeout: 10_000 },
  async (operation, context) => {
    if (!locks) context.skip('Requires Bun FFI and a libc flock implementation')
    const box = reaperSandbox(operation, operation === 'stop')
    const orphan = box.addSlice('aaaaaaaaaaaa')
    const watchdog = `${orphan.slice(0, -'.slice'.length)}_deadline.service`
    try {
      const job = box.start(false)
      await expect
        .poll(
          () =>
            box
              .managerCalls()
              .some((call) => call.operation === operation && call.slice === watchdog),
          { timeout: 1500 },
        )
        .toBe(true)
      job.child.kill('SIGTERM')
      await expect.poll(() => job.child.exitCode, { timeout: 1500 }).toBe(143)
      expect(await job.done).toBe(143)
      expect(box.lifecycle().map((call) => call.operation)).toEqual(['kill'])
      assertReleased(box)
    } finally {
      await box.cleanup()
    }
  },
)
