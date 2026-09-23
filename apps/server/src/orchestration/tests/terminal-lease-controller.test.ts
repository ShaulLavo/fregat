import * as v from 'valibot'
import { worktreeIdSchema, type OrchestrationCommand } from '@workspace/contracts'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { TerminalLeaseController } from '../terminal-lease-controller'
import { WorktreeExecutionGate } from '../worktree-execution-gate'
import type { OrchestrationReadModel } from '../read-model'
import { orchestrationErrors } from '../../observability/structured-errors'

const worktreeId = v.parse(worktreeIdSchema, '20000000-0000-4000-8000-000000000001')

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

// The store is the boundary: a full disk rejects every write the same way.
function controller(fails: (command: OrchestrationCommand) => boolean) {
  const gate = new WorktreeExecutionGate()
  const sent: string[] = []
  const leases = new TerminalLeaseController({
    gate,
    dispatch: async (command) => {
      sent.push(command.type)
      if (fails(command)) throw new Error('SQLITE_FULL: database or disk is full')
    },
    getReadModel: () => ({ terminalLeases: new Map() }) as unknown as OrchestrationReadModel,
  })
  return { gate, leases, sent }
}

it('reports a store that never accepts the lease instead of retrying forever', async () => {
  const { leases, sent } = controller(() => true)

  const begun = leases.begin(worktreeId)
  const settled = expect(begun).rejects.toMatchObject({
    code: 'orchestration.TERMINAL_LEASE_UNPERSISTED',
    message: 'terminal.lease.request was not persisted after 5 attempts',
  })
  await vi.runAllTimersAsync()
  await settled

  expect(sent).toEqual(Array(5).fill('terminal.lease.request'))
})

it('rides out a transient store failure', async () => {
  let failures = 2
  const { leases } = controller((command) => {
    if (command.type !== 'terminal.lease.request' || failures === 0) return false
    failures -= 1
    return true
  })

  const begun = leases.begin(worktreeId)
  await vi.runAllTimersAsync()

  await expect(begun).resolves.toMatchObject({ runtimeEpoch: leases.runtimeEpoch })
})

it('releases the worktree when ending the lease cannot be persisted', async () => {
  const { gate, leases } = controller((command) => command.type === 'terminal.lease.end')
  const lease = await leases.begin(worktreeId)
  expect(gate.tryAcquireExclusive(worktreeId)).toMatchObject({ acquired: false })

  const ended = lease.end()
  const settled = expect(ended).rejects.toMatchObject({
    code: 'orchestration.TERMINAL_LEASE_UNPERSISTED',
  })
  await vi.runAllTimersAsync()
  await settled

  expect(gate.tryAcquireExclusive(worktreeId)).toMatchObject({ acquired: true })
})

it('writes a failed end again when the terminal retries it', async () => {
  let storeDown = true
  const { leases, sent } = controller(
    (command) => storeDown && command.type === 'terminal.lease.end',
  )
  const lease = await leases.begin(worktreeId)

  const first = lease.end()
  const settled = expect(first).rejects.toMatchObject({
    code: 'orchestration.TERMINAL_LEASE_UNPERSISTED',
  })
  await vi.runAllTimersAsync()
  await settled
  storeDown = false

  await expect(lease.end()).resolves.toBeUndefined()
  expect(sent.filter((type) => type === 'terminal.lease.end')).toHaveLength(6)
})

it('reports the claim failure, not the cleanup that could not be persisted either', async () => {
  const claimRejected = orchestrationErrors.COMMAND_PREVIOUSLY_REJECTED({ commandId: 'claim' })
  const gate = new WorktreeExecutionGate()
  const leases = new TerminalLeaseController({
    gate,
    dispatch: async (command) => {
      if (command.type === 'terminal.lease.claim') throw claimRejected
      if (command.type === 'terminal.lease.end') throw new Error('SQLITE_FULL')
    },
    getReadModel: () => ({ terminalLeases: new Map() }) as unknown as OrchestrationReadModel,
  })

  const begun = leases.begin(worktreeId)
  const settled = expect(begun).rejects.toBe(claimRejected)
  await vi.runAllTimersAsync()
  await settled
  expect(gate.tryAcquireExclusive(worktreeId)).toMatchObject({ acquired: true })
})
