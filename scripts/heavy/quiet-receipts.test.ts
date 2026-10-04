import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'

import { live } from './queue'
import { quietFailureReceipt } from './quiet-receipts'
import { removeSandboxes, sandbox, start, until, userScopes, writeMachine } from './sandbox'

afterEach(removeSandboxes)

describe.skipIf(!userScopes)('quiet failure receipts', () => {
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
