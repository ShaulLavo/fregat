import { spawnSync } from 'node:child_process'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, test, vi } from 'vitest'

import { live } from './queue'
import {
  createQuietObserver,
  freezeQuietObserver,
  quietFailureReceipt,
  quietLauncherReceipt,
  quietRuntimeRecorder,
} from './quiet-receipts'
import {
  alive,
  recordOf,
  removeSandboxes,
  sandbox,
  start,
  until,
  userScopes,
  writeMachine,
} from './sandbox'

const uptime = vi.hoisted(() => ({ unavailable: false }))
const ioReads = vi.hoisted(() => {
  const files = new Set<number>()
  const bytes: number[] = []
  return { enabled: false, files, bytes }
})

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return {
    ...actual,
    openSync: (...args: Parameters<typeof actual.openSync>) => {
      const fd = actual.openSync(...args)
      if (
        ioReads.enabled &&
        typeof args[0] === 'string' &&
        /\/quiet-observer\/(events-\d+\.jsonl|counts-\d+\.json)$/.test(args[0])
      )
        ioReads.files.add(fd)
      return fd
    },
    readSync: (...args: Parameters<typeof actual.readSync>) => {
      const length = actual.readSync(...args)
      if (ioReads.enabled && ioReads.files.has(args[0])) ioReads.bytes.push(length)
      return length
    },
    closeSync: (...args: Parameters<typeof actual.closeSync>) => {
      const result = actual.closeSync(...args)
      ioReads.files.delete(args[0])
      return result
    },
    readFileSync: (...args: Parameters<typeof actual.readFileSync>) => {
      if (args[0] === '/proc/uptime' && uptime.unavailable) return actual.readFileSync(-1, args[1])
      return actual.readFileSync(...args)
    },
  }
})

if (process.platform === 'win32')
  console.info('Indirect files and Unix signal observation require a POSIX host.')
if (!userScopes) console.info('Real scope observation requires systemd user scopes.')
if (process.getuid?.() === 0)
  console.info('Mode-bit observer I/O denial requires an unprivileged user.')

test.skipIf(process.platform === 'win32')(
  'bounded observer refuses malformed, private and indirect records without exposing contents',
  () => {
    const box = sandbox()
    const observer = createQuietObserver(box)
    if (observer.kind !== 'ready') expect.fail(observer.reason)
    const privateText = 'private-content-λ'
    const target = path.join(box.root, 'private')
    writeFileSync(target, privateText)
    writeFileSync(
      path.join(observer.directory, 'events-1.jsonl'),
      JSON.stringify({
        kind: 'shell',
        at: 1,
        pid: 1,
        role: 'shim',
        phase: 'payload',
        status: 0,
        message: privateText,
      }) + '\n',
    )
    writeFileSync(
      path.join(observer.directory, 'events-5.jsonl'),
      '{"kind":"shell","at":1e309,"pid":1,"role":"shim","phase":"payload","status":0}\n',
    )
    writeFileSync(path.join(observer.directory, 'events-2.jsonl'), Buffer.from([0xff]))
    writeFileSync(path.join(observer.directory, 'events-3.jsonl'), privateText.repeat(400))
    symlinkSync(target, path.join(observer.directory, 'events-4.jsonl'))
    const snapshot = freezeQuietObserver(observer, 'failure')
    if (!('events' in snapshot)) expect.fail(snapshot.unavailable)
    expect(snapshot.events).toEqual([])
    expect(snapshot.refused).toBeGreaterThanOrEqual(3)
    expect(snapshot.unavailable).toBeGreaterThan(0)
    expect(JSON.stringify(snapshot)).not.toContain(privateText)
    expect(JSON.stringify(snapshot)).not.toContain(target)
  },
)

test('bounded observer freezes before cleanup, refuses replacement and caps real file input', () => {
  const box = sandbox()
  const observer = createQuietObserver(box)
  if (observer.kind !== 'ready') expect.fail(observer.reason)
  const record =
    JSON.stringify({
      kind: 'shell',
      at: 1,
      pid: 1,
      role: 'shim',
      phase: 'payload-return',
      status: 137,
    }) + '\n'
  const events = path.join(observer.directory, 'events-1.jsonl')
  writeFileSync(events, record.repeat(200))
  const failure = freezeQuietObserver(observer, 'failure')
  if (!('events' in failure)) expect.fail(failure.unavailable)
  expect(failure.persisted).toBe(true)
  expect(failure.truncated).toBe(true)
  expect(failure.events).toHaveLength(128)
  expect(failure.events[0]).toMatchObject({ status: 137 })
  const first = readFileSync(path.join(observer.directory, 'failure.json'), 'utf8')
  rmSync(events)
  const cleanup = freezeQuietObserver(observer, 'cleanup')
  expect(cleanup.stage).toBe('cleanup')
  expect(cleanup.persisted).toBe(true)
  const replacement = freezeQuietObserver(observer, 'failure')
  expect(replacement.persisted).toBe(false)
  expect(readFileSync(path.join(observer.directory, 'failure.json'), 'utf8')).toBe(first)
  expect(failure.events[0]).toMatchObject({ status: 137 })
  expect(Buffer.byteLength(JSON.stringify(failure))).toBeLessThan(131_072)
})

test('bounded observer reports byte overflow and setup or persistence refusal', () => {
  const box = sandbox()
  const observer = createQuietObserver(box)
  if (observer.kind !== 'ready') expect.fail(observer.reason)
  writeFileSync(path.join(observer.directory, 'events-1.jsonl'), Buffer.alloc(65_537, 65))
  mkdirSync(path.join(observer.directory, 'failure.json'))
  const failure = freezeQuietObserver(observer, 'failure')
  if (!('events' in failure)) expect.fail(failure.unavailable)
  expect(failure.truncated).toBe(true)
  expect(failure.refused).toBe(1)
  expect(failure.persisted).toBe(false)
  const unavailable = createQuietObserver(box)
  expect(unavailable.kind).toBe('unavailable')
  expect(freezeQuietObserver(unavailable, 'failure')).toMatchObject({ persisted: false })
})

test.skipIf(process.platform === 'win32')(
  'bounded observer captures a genuine child signal and preserves an I/O-failed primary exit',
  async () => {
    const box = sandbox()
    const observer = createQuietObserver(box)
    if (observer.kind !== 'ready') expect.fail(observer.reason)
    const child = Bun.spawn({
      cmd: [process.execPath, '-e', "console.log('ready'); setInterval(() => {}, 1000)"],
      stdout: 'pipe',
      stderr: 'ignore',
    })
    const reader = child.stdout.getReader()
    try {
      expect(new TextDecoder().decode((await reader.read()).value)).toContain('ready')
      reader.releaseLock()
      quietRuntimeRecorder(observer.directory).observe(child, `${box.sliceRoot}-000000000001.scope`)
      const returned = child.kill('SIGTERM')
      expect(returned).toBeUndefined()
      expect(await child.exited).toBe(143)
      const snapshot = freezeQuietObserver(observer, 'failure')
      if (!('events' in snapshot)) expect.fail(snapshot.unavailable)
      expect(snapshot.events).toContainEqual(
        expect.objectContaining({
          kind: 'boundary',
          operation: 'signal-attempt',
          pid: child.pid,
          signal: 'SIGTERM',
        }),
      )
      expect(snapshot.events).toContainEqual(
        expect.objectContaining({
          kind: 'boundary',
          operation: 'signal-return',
          pid: child.pid,
          result: 'returned-void',
        }),
      )
      expect(snapshot.events).toContainEqual(
        expect.objectContaining({
          kind: 'boundary',
          operation: 'supervisor-exit',
          status: 143,
          signal: 'SIGTERM',
        }),
      )
    } finally {
      if (child.exitCode === null) child.kill('SIGKILL')
      await child.exited
    }
    const failed = createQuietObserver({ ...box, root: path.join(box.root, 'missing') })
    expect(failed.kind).toBe('unavailable')
    const primary = Bun.spawn({
      cmd: [process.execPath, '-e', 'process.exit(7)'],
      stdout: 'ignore',
      stderr: 'ignore',
    })
    const io = path.join(box.root, 'io')
    mkdirSync(io)
    mkdirSync(path.join(io, `events-${process.pid}.jsonl`))
    quietRuntimeRecorder(io).observe(primary, `${box.sliceRoot}-000000000002.scope`)
    expect(await primary.exited).toBe(7)
    const ioFailure = freezeQuietObserver({ ...observer, directory: io }, 'failure')
    if (!('events' in ioFailure)) expect.fail(ioFailure.unavailable)
    expect(ioFailure.unavailable).toBeGreaterThan(0)
    expect(ioFailure.refused).toBeGreaterThan(0)
    let original: unknown
    try {
      readFileSync(path.join(box.root, 'absent-primary'))
    } catch (error) {
      original = error
    }
    try {
      throw original
    } catch (error) {
      freezeQuietObserver(failed, 'failure')
      expect(error).toBe(original)
    }
  },
)

describe.skipIf(!userScopes)('bounded observer real scope capture', () => {
  test('retains the real primary and watchdog process identities at a TERM boundary', async () => {
    const box = sandbox()
    writeMachine(box, { availableMiB: 65536 })
    const observer = createQuietObserver(box)
    if (observer.kind !== 'ready') expect.fail(observer.reason)
    const job = start(box, 'observer-term-identities', ['bash', '-c', 'echo $$; exec sleep 60'], {
      quiet: true,
      jobClass: 'light',
      machine: true,
      preload: observer.preload,
    })
    try {
      await expect.poll(job.stdout, { timeout: 5_000 }).toMatch(/^\d+\n$/)
      const primaryPid = Number(job.stdout().trim())
      expect(job.child.kill('SIGTERM')).toBe(true)
      expect((await job.done).code).toBe(143)
      const snapshot = freezeQuietObserver(observer, 'failure')
      if (!('events' in snapshot)) expect.fail(snapshot.unavailable)
      const attempt = snapshot.events.find(
        (event) => event.kind === 'boundary' && event.operation === 'signal-attempt',
      )
      if (attempt?.kind !== 'boundary') expect.fail('TERM boundary is unavailable')
      expect(attempt.scope.primaryPid).toBe(primaryPid)
      expect(attempt.scope.processes).toContainEqual(expect.objectContaining({ pid: primaryPid }))
      expect(attempt.scope.watchdog.length).toBeGreaterThan(0)
      expect(snapshot.events).toContainEqual(
        expect.objectContaining({ kind: 'shell', phase: 'payload-return', status: 143 }),
      )
    } finally {
      job.child.kill('SIGTERM')
      await job.done
    }
  }, 15_000)

  test.skipIf(process.getuid?.() === 0)(
    'denied observer writes preserve primary exit and watchdog readiness and cleanup',
    async () => {
      const box = sandbox()
      writeMachine(box, { availableMiB: 65536 })
      const observer = createQuietObserver(box)
      if (observer.kind !== 'ready') expect.fail(observer.reason)
      chmodSync(observer.directory, 0o555)
      try {
        const job = start(box, 'observer-denied-writes', ['bash', '-c', 'exit 7'], {
          quiet: true,
          jobClass: 'light',
          machine: true,
          preload: observer.preload,
        })
        expect((await job.done).code).toBe(7)
        expect(recordOf(box, 'observer-denied-writes')).toMatchObject({
          exitCode: 7,
          leftoverProcesses: 0,
          oomKills: 0,
        })
      } finally {
        chmodSync(observer.directory, 0o755)
      }
      const snapshot = freezeQuietObserver(observer, 'failure')
      if (!('events' in snapshot)) expect.fail(snapshot.unavailable)
      expect(snapshot.unavailable).toBeGreaterThan(0)
      expect(snapshot.events).toEqual([])
    },
    15_000,
  )

  test('captures actual primary rc, shim accounting and watchdog facts with quoted UTF8 paths', async () => {
    const box = sandbox()
    writeMachine(box, { availableMiB: 65536 })
    const root = path.join(box.root, "observer ' λ")
    mkdirSync(root)
    const observer = createQuietObserver({ ...box, root })
    if (observer.kind !== 'ready') expect.fail(observer.reason)
    const job = start(box, 'observer-primary-seven', ['bash', '-c', 'exit 7'], {
      quiet: true,
      jobClass: 'light',
      machine: true,
      preload: observer.preload,
    })
    expect((await job.done).code).toBe(7)
    const snapshot = freezeQuietObserver(observer, 'failure')
    if (!('events' in snapshot)) expect.fail(snapshot.unavailable)
    expect(snapshot.persisted).toBe(true)
    expect(snapshot.events).toContainEqual(
      expect.objectContaining({ kind: 'shell', role: 'shim', phase: 'payload-return', status: 7 }),
    )
    expect(snapshot.events).toContainEqual(
      expect.objectContaining({ kind: 'shell', role: 'shim', phase: 'accounting-start' }),
    )
    expect(snapshot.events).toContainEqual(
      expect.objectContaining({
        kind: 'shell',
        role: 'shim',
        phase: 'accounting-return',
        status: 0,
      }),
    )
    expect(snapshot.events).toContainEqual(
      expect.objectContaining({ kind: 'shell', role: 'watchdog', phase: 'watchdog-ready' }),
    )
    expect(snapshot.events).toContainEqual(
      expect.objectContaining({
        kind: 'boundary',
        operation: 'supervisor-exit',
        status: 7,
        signal: null,
      }),
    )
    expect(recordOf(box, 'observer-primary-seven')).toMatchObject({
      exitCode: 7,
      leftoverProcesses: 0,
      oomKills: 0,
    })
    expect(snapshot.refused).toBe(0)
    expect(snapshot.truncated).toBe(false)
    expect(snapshot.dropped).toBe(0)
  }, 15_000)
})

afterEach(() => {
  uptime.unavailable = false
  ioReads.enabled = false
  ioReads.files.clear()
  ioReads.bytes.length = 0
  return removeSandboxes()
})

test.each(['oversize', 'malformed UTF8', 'schema refusal'])(
  'cumulative observer read allowance includes %s input',
  (kind) => {
    const box = sandbox()
    const observer = createQuietObserver(box)
    if (observer.kind !== 'ready') expect.fail(observer.reason)
    const oversized = kind === 'oversize'
    const invalidRecord =
      JSON.stringify({
        kind: 'shell',
        at: 1,
        pid: 1,
        role: 'shim',
        phase: 'payload',
        status: 0,
        message: 'refused',
      }).padEnd(4_095, ' ') + '\n'
    const input =
      kind === 'schema refusal'
        ? Buffer.from(invalidRecord.repeat(2))
        : Buffer.alloc(oversized ? 65_537 : 8_192, 0xff)
    for (let index = 1; index <= (oversized ? 8 : 9); index++) {
      writeFileSync(path.join(observer.directory, `events-${index}.jsonl`), input)
    }
    ioReads.enabled = true
    const snapshot = freezeQuietObserver(observer, 'failure')
    ioReads.enabled = false
    if (!('events' in snapshot)) expect.fail(snapshot.unavailable)
    const actualBytes = ioReads.bytes.reduce((sum, bytes) => sum + bytes, 0)
    expect(actualBytes).toBeLessThanOrEqual(65_536)
    expect(actualBytes).toBe(oversized ? 0 : 65_536)
    expect(ioReads.bytes.length).toBe(oversized ? 0 : 8)
    expect(snapshot.events).toEqual([])
    expect(snapshot.truncated).toBe(true)
    expect(snapshot.persisted).toBe(true)
    expect(snapshot.unavailable).toBeGreaterThan(0)
    if (kind !== 'malformed UTF8') expect(snapshot.refused).toBe(oversized ? 8 : 16)
  },
)

test('cumulative observer preserves valid records, qualified counters and failure persistence', () => {
  const box = sandbox()
  const observer = createQuietObserver(box)
  if (observer.kind !== 'ready') expect.fail(observer.reason)
  const record =
    JSON.stringify({
      kind: 'shell',
      at: 1,
      pid: 1,
      role: 'shim',
      phase: 'payload-return',
      status: 7,
    }) + '\n'
  const counters = JSON.stringify({ dropped: 3, unavailable: 4 })
  writeFileSync(path.join(observer.directory, 'events-1.jsonl'), record)
  writeFileSync(path.join(observer.directory, 'counts-1.json'), counters)
  ioReads.enabled = true
  const snapshot = freezeQuietObserver(observer, 'failure')
  ioReads.enabled = false
  if (!('events' in snapshot)) expect.fail(snapshot.unavailable)
  expect(ioReads.bytes.reduce((sum, bytes) => sum + bytes, 0)).toBe(
    Buffer.byteLength(record + counters),
  )
  expect(snapshot.events).toHaveLength(1)
  expect(snapshot.events[0]).toMatchObject({ status: 7 })
  expect(snapshot.dropped).toBe(3)
  expect(snapshot.unavailable).toBe(4)
  expect(snapshot.truncated).toBe(false)
  expect(snapshot.persisted).toBe(true)
  const first = readFileSync(path.join(observer.directory, 'failure.json'), 'utf8')
  rmSync(path.join(observer.directory, 'events-1.jsonl'))
  rmSync(path.join(observer.directory, 'counts-1.json'))
  mkdirSync(path.join(observer.directory, 'cleanup.json'))
  let primary: unknown
  try {
    readFileSync(path.join(box.root, 'absent-primary'))
  } catch (error) {
    primary = error
  }
  try {
    throw primary
  } catch (error) {
    expect(freezeQuietObserver(observer, 'cleanup').persisted).toBe(false)
    expect(error).toBe(primary)
  }
  expect(readFileSync(path.join(observer.directory, 'failure.json'), 'utf8')).toBe(first)
})

test('cumulative observer accepts an exact-budget qualified counter without an overflow read', () => {
  const box = sandbox()
  const observer = createQuietObserver(box)
  if (observer.kind !== 'ready') expect.fail(observer.reason)
  writeFileSync(
    path.join(observer.directory, 'counts-1.json'),
    JSON.stringify({ dropped: 3, unavailable: 4 }).padEnd(65_536, ' '),
  )
  ioReads.enabled = true
  const snapshot = freezeQuietObserver(observer, 'failure')
  ioReads.enabled = false
  if (!('events' in snapshot)) expect.fail(snapshot.unavailable)
  expect(ioReads.bytes).toEqual([65_536])
  expect(snapshot.dropped).toBe(3)
  expect(snapshot.unavailable).toBe(5)
  expect(snapshot.refused).toBe(0)
  expect(snapshot.truncated).toBe(false)
  expect(snapshot.persisted).toBe(true)
})

test('unavailable uptime preserves launcher checkpoints, completion, and the primary outcome', () => {
  const box = sandbox()
  const resultFile = path.join(box.root, 'launcher.done')
  writeFileSync(resultFile, 'retained completion')
  const cached = quietLauncherReceipt(process.pid, 'waiting')
  uptime.unavailable = true
  try {
    for (const phase of ['waiting', 'expired-before-release', 'returned-before-exit-assertion']) {
      const checkpoint = quietLauncherReceipt(process.pid, phase)
      expect(checkpoint).toMatchObject({ pid: process.pid, phase })
      expect(checkpoint.bootSeconds).toHaveProperty('receiptError')
    }
    const uncreated = quietLauncherReceipt(undefined, 'not-created')
    expect(uncreated).toMatchObject({ created: false })
    expect(uncreated.bootSeconds).toHaveProperty('receiptError')
    const receipt = quietFailureReceipt({
      box,
      jobs: {},
      launcher: { pid: process.pid, resultFile, checkpoints: [cached] },
    })
    if ('receiptError' in receipt) expect.fail(receipt.receiptError)
    expect(receipt.bootSeconds).toHaveProperty('receiptError')
    expect(receipt.launcher?.current.bootSeconds).toHaveProperty('receiptError')
    expect(receipt.launcher?.checkpoints).toEqual([cached])
    expect(receipt.launcher?.result).toBe('retained completion')
    const primary = Symbol('primary outcome')
    let observed: unknown
    try {
      quietLauncherReceipt(process.pid, 'returned-before-exit-assertion')
      throw primary
    } catch (error) {
      JSON.stringify(receipt)
      observed = error
    }
    expect(observed).toBe(primary)
  } finally {
    uptime.unavailable = false
  }
})

describe.skipIf(!userScopes)('quiet failure receipts', () => {
  test('captures a suspended launcher entry descriptor before it returns and is reaped', async () => {
    const box = sandbox()
    writeMachine(box, { availableMiB: 65536 })
    const launcher = path.join(box.root, 'launcher.sh')
    const launcherFile = path.join(box.root, 'launcher.pid')
    const resultFile = path.join(box.root, 'launcher.done')
    const preload = path.join(box.root, 'launcher.ts')
    writeFileSync(
      launcher,
      `printf '%s' "$$" > ${launcherFile}\nkill -STOP "$$"\n"$@"\nrc=$?\nprintf '%s' "$rc" > ${resultFile}\nexit "$rc"\n`,
    )
    writeFileSync(
      preload,
      `const spawn = Bun.spawn.bind(Bun)
      Bun.spawn = (options) => spawn(options.cmd?.[0] === 'systemd-run'
        ? { ...options, cmd: ['bash', '-p', ${JSON.stringify(launcher)}, ...options.cmd] }
        : options)
      `,
    )
    const job = start(box, 'launcher-receipt', ['true'], {
      machine: true,
      jobClass: 'light',
      preload,
    })
    let pid: number | undefined
    try {
      await expect.poll(() => existsSync(launcherFile), { timeout: 5_000 }).toBe(true)
      pid = Number(readFileSync(launcherFile, 'utf8'))
      await expect
        .poll(() => readFileSync(`/proc/${pid}/status`, 'utf8'), { timeout: 5_000 })
        .toMatch(/^State:\s+T/m)
      const owner = live(box.state, 'jobs').find((entry) => entry.label === 'launcher-receipt')!
      expect(owner).toBeDefined()
      const waiting = quietLauncherReceipt(pid, 'waiting')
      expect(waiting).toMatchObject({
        pid,
        phase: 'waiting',
        fd6: path.join(box.state, 'jobs', `${owner.id}.json`),
      })
      expect('status' in waiting && waiting.status).toMatch(/^State:\s+T/m)
      expect('cgroup' in waiting && waiting.cgroup).toMatch(/^0::\//)
      expect('fd6Info' in waiting && waiting.fd6Info).toMatch(
        /lock:\s+\d+: FLOCK\s+ADVISORY\s+WRITE/,
      )
      process.kill(pid, 'SIGCONT')
      expect((await job.done).code).toBe(0)
      const returned = quietLauncherReceipt(pid, 'returned')
      expect('fd6' in returned && returned.fd6).toHaveProperty('receiptError')
      const receipt = quietFailureReceipt({
        box,
        jobs: { job },
        launcher: { pid, resultFile, checkpoints: [waiting, returned] },
      })
      if ('receiptError' in receipt) expect.fail(receipt.receiptError)
      expect(receipt.launcher?.checkpoints).toEqual([waiting, returned])
      expect(receipt.launcher?.result).toBe('0')
      expect(receipt.clientVersion.status).toBe(0)
      expect(receipt.clientVersion.stdout).toMatch(/^systemd \d+/)
      expect(receipt.managerVersion.status).toBe(0)
      expect(receipt.managerVersion.stdout).toMatch(/^Version=.+/m)
      expect(quietLauncherReceipt(undefined, 'not-created')).toMatchObject({ created: false })
    } finally {
      job.child.kill('SIGCONT')
      job.child.kill('SIGTERM')
      if (pid && alive(pid)) process.kill(pid, 'SIGCONT')
      await job.done
    }
  }, 15_000)

  test('retains a manager failure and private ownership before cleanup, then reads a settled child', async () => {
    const box = sandbox()
    const release = path.join(box.root, 'release')
    writeMachine(box, { availableMiB: 65536 })
    const job = start(
      box,
      'receipt-control',
      ['bash', '-c', `echo calibrated; echo calibrated-stderr >&2; ${until(release)}`],
      { machine: true, jobClass: 'light' },
    )
    try {
      await expect.poll(job.stdout, { timeout: 5_000 }).toContain('calibrated')
      const owner = live(box.state, 'jobs').find((entry) => entry.label === 'receipt-control')!
      expect(owner).toBeDefined()
      const ownerFile = path.join(box.state, 'jobs', `${owner.id}.json`)
      const originalOwner = readFileSync(ownerFile, 'utf8')
      const missingScope = `${box.sliceRoot}-missing.scope`
      const manager = spawnSync('systemctl', ['--user', 'stop', missingScope])
      expect(manager.status).toBe(5)
      const receipt = quietFailureReceipt({
        box,
        jobs: { job, notCreated: undefined },
        manager,
        units: [missingScope, 'default.target'],
      })
      if ('receiptError' in receipt) expect.fail(receipt.receiptError)
      expect(receipt.managerCommand?.status).toBe(5)
      expect(receipt.managerCommand?.stderr).toMatch(/not loaded|not found/)
      expect(receipt.jobs[0]?.pid).toBe(job.child.pid)
      expect(receipt.jobs[0]?.stderr).toContain('calibrated-stderr')
      expect(receipt.jobs[1]).toEqual({ name: 'notCreated', created: false })
      const owners = receipt.state.jobs
      if ('receiptError' in owners) expect.fail(owners.receiptError)
      expect(owners).toContainEqual({
        name: `${owner.id}.json`,
        receipt: { text: originalOwner, owned: true },
      })
      expect(receipt.managerUnits.command).not.toContain('default.target')
      expect(receipt.managerUnits.stdout).toContain(`Id=${missingScope}`)
      expect(existsSync(box.root)).toBe(true)
      expect(readFileSync(ownerFile, 'utf8')).toBe(originalOwner)
      writeFileSync(release, '')
      expect((await job.done).code).toBe(0)
      const settled = quietFailureReceipt({ box, jobs: { job } })
      if ('receiptError' in settled) expect.fail(settled.receiptError)
      expect(settled.jobs[0]?.exitCode).toBe(0)
      expect(settled.jobs[0]?.status).toHaveProperty('receiptError')
      const records = settled.records
      if ('receiptError' in records) expect.fail(records.receiptError)
      expect(
        records.some(
          (entry) => typeof entry.receipt === 'string' && entry.receipt.includes('receipt-control'),
        ),
      ).toBe(true)
    } finally {
      writeFileSync(release, '')
      job.child.kill('SIGTERM')
      await job.done
    }
  }, 15_000)
})
