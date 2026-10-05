import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, test, vi } from 'vitest'

import { live } from './queue'
import { quietFailureReceipt, quietLauncherReceipt } from './quiet-receipts'
import { alive, removeSandboxes, sandbox, start, until, userScopes, writeMachine } from './sandbox'

const uptime = vi.hoisted(() => ({ unavailable: false }))

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return {
    ...actual,
    readFileSync: (...args: Parameters<typeof actual.readFileSync>) => {
      if (args[0] === '/proc/uptime' && uptime.unavailable) return actual.readFileSync(-1, args[1])
      return actual.readFileSync(...args)
    },
  }
})

afterEach(() => {
  uptime.unavailable = false
  return removeSandboxes()
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
