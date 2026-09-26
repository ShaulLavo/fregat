import { afterEach, expect, it } from 'vitest'
import { createOrchestrationFixture } from '../../../test/factories/orchestration'
import { requireWorktree } from '../read-model'
import { TerminalLeaseController } from '../terminal-lease-controller'
import { WorktreeExecutionGate } from '../worktree-execution-gate'

const fixtures: Awaited<ReturnType<typeof createOrchestrationFixture>>[] = []
afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((fixture) => fixture.close()))
})

it('adopts only the latest lease for a live key and releases every cleanup hold', async () => {
  const fixture = await createOrchestrationFixture()
  fixtures.push(fixture)
  const { worktreeId } = (await fixture.register()).result!
  for (const [index, epoch] of ['old', 'new'].entries()) {
    const shared = {
      worktreeId,
      terminalLeaseId: `30000000-0000-4000-8000-00000000010${index}`,
      runtimeEpoch: epoch,
    }
    await fixture.command({
      ...shared,
      type: 'terminal.lease.request',
      commandId: `request-${epoch}`,
      key: 'duplicate',
    })
    await fixture.command({ ...shared, type: 'terminal.lease.claim', commandId: `claim-${epoch}` })
    await fixture.command({
      ...shared,
      type: 'terminal.lease.activate',
      commandId: `active-${epoch}`,
    })
    if (epoch === 'old')
      await fixture.command({
        ...shared,
        type: 'terminal.lease.mark-unknown',
        commandId: 'unknown-old',
      })
  }
  let model = await fixture.engine.readModelSnapshot()
  const gate = new WorktreeExecutionGate()
  const recovery = new TerminalLeaseController({
    gate,
    getReadModel: () => model,
    queryHostSessions: async () => [
      {
        key: 'duplicate',
        session: 1,
        pid: 100,
        startedAt: new Date().toISOString(),
        offset: 0,
        exited: false,
      },
    ],
    dispatch: async (command) => {
      await fixture.command(command)
      model = await fixture.engine.readModelSnapshot()
    },
  })
  await recovery.recover()
  expect([...model.terminalLeases.values()].map((lease) => lease.state)).toEqual([
    'ended',
    'active',
  ])
  const active = [...model.terminalLeases.values()].find((lease) => lease.state === 'active')!
  await recovery.attachAdopted(worktreeId, active.terminalLeaseId).end()
  expect(requireWorktree(model, worktreeId).activeTerminalCount).toBe(0)
  expect(gate.tryAcquireExclusive(worktreeId).acquired).toBe(true)
})

it('ends unclaimed requests and preserves unknown ownership for every claimed stale epoch', async () => {
  const fixture = await createOrchestrationFixture()
  fixtures.push(fixture)
  const result = (await fixture.register()).result
  if (!result) throw new TypeError('Missing registered worktree')
  const worktreeId = result.worktreeId
  const states = ['requested', 'claimed', 'active', 'termination-requested'] as const
  for (const [index, state] of states.entries()) {
    const terminalLeaseId = `10000000-0000-4000-8000-00000000000${index + 1}`
    const shared = { worktreeId, terminalLeaseId, runtimeEpoch: 'stale-runtime' }
    await fixture.command({
      ...shared,
      type: 'terminal.lease.request',
      commandId: `request-${index}`,
    })
    if (state === 'requested') continue
    await fixture.command({ ...shared, type: 'terminal.lease.claim', commandId: `claim-${index}` })
    if (state === 'claimed') continue
    await fixture.command({
      ...shared,
      type: 'terminal.lease.activate',
      commandId: `active-${index}`,
    })
    if (state === 'active') continue
    await fixture.command({
      ...shared,
      type: 'terminal.lease.terminate',
      commandId: `terminate-${index}`,
    })
  }
  const restarted = await fixture.restart()
  const model = await restarted.readModelSnapshot()
  expect([...model.terminalLeases.values()].map((lease) => lease.state)).toEqual([
    'ended',
    'ownership-unknown',
    'ownership-unknown',
    'ownership-unknown',
  ])
  expect(requireWorktree(model, worktreeId)).toMatchObject({
    activeTerminalCount: 0,
    terminalOwnershipUnknown: true,
  })
  await fixture.restart()
  expect(
    requireWorktree(await fixture.engine.readModelSnapshot(), worktreeId).terminalOwnershipUnknown,
  ).toBe(true)
})

it('adopts a lease from claimed, active or termination-requested, moving it to the new epoch', async () => {
  const fixture = await createOrchestrationFixture()
  fixtures.push(fixture)
  const result = (await fixture.register()).result
  if (!result) throw new TypeError('Missing registered worktree')
  const worktreeId = result.worktreeId
  const states = ['claimed', 'active', 'termination-requested'] as const
  for (const [index, state] of states.entries()) {
    const terminalLeaseId = `30000000-0000-4000-8000-00000000000${index + 1}`
    const shared = { worktreeId, terminalLeaseId, runtimeEpoch: 'stale-runtime' }
    await fixture.command({
      ...shared,
      type: 'terminal.lease.request',
      commandId: `request-${index}`,
    })
    await fixture.command({ ...shared, type: 'terminal.lease.claim', commandId: `claim-${index}` })
    if (state === 'claimed') continue
    await fixture.command({
      ...shared,
      type: 'terminal.lease.activate',
      commandId: `active-${index}`,
    })
    if (state === 'active') continue
    await fixture.command({
      ...shared,
      type: 'terminal.lease.terminate',
      commandId: `terminate-${index}`,
    })
  }
  for (const [index] of states.entries()) {
    const terminalLeaseId = `30000000-0000-4000-8000-00000000000${index + 1}`
    await fixture.command({
      type: 'terminal.lease.adopt',
      commandId: `adopt-${index}`,
      worktreeId,
      terminalLeaseId,
      runtimeEpoch: 'new-runtime',
      fromRuntimeEpoch: 'stale-runtime',
    })
  }
  const model = await fixture.engine.readModelSnapshot()
  for (const [index] of states.entries()) {
    const terminalLeaseId = `30000000-0000-4000-8000-00000000000${index + 1}`
    expect(model.terminalLeases.get(terminalLeaseId)).toMatchObject({
      state: 'active',
      runtimeEpoch: 'new-runtime',
    })
  }
})

it('adopts a lease already marked ownership-unknown', async () => {
  const fixture = await createOrchestrationFixture()
  fixtures.push(fixture)
  const result = (await fixture.register()).result
  if (!result) throw new TypeError('Missing registered worktree')
  const worktreeId = result.worktreeId
  const terminalLeaseId = '30000000-0000-4000-8000-000000000010'
  const shared = { worktreeId, terminalLeaseId, runtimeEpoch: 'stale-runtime' }
  await fixture.command({ ...shared, type: 'terminal.lease.request', commandId: 'request' })
  await fixture.command({ ...shared, type: 'terminal.lease.claim', commandId: 'claim' })
  await fixture.command({ ...shared, type: 'terminal.lease.activate', commandId: 'activate' })
  await fixture.command({
    ...shared,
    type: 'terminal.lease.mark-unknown',
    commandId: 'mark-unknown',
  })
  await fixture.command({
    type: 'terminal.lease.adopt',
    commandId: 'adopt',
    worktreeId,
    terminalLeaseId,
    runtimeEpoch: 'new-runtime',
    fromRuntimeEpoch: 'stale-runtime',
  })
  const model = await fixture.engine.readModelSnapshot()
  expect(model.terminalLeases.get(terminalLeaseId)).toMatchObject({
    state: 'active',
    runtimeEpoch: 'new-runtime',
  })
})

it('refuses to adopt a lease that is only requested, already ended, or from the wrong epoch', async () => {
  const fixture = await createOrchestrationFixture()
  fixtures.push(fixture)
  const result = (await fixture.register()).result
  if (!result) throw new TypeError('Missing registered worktree')
  const worktreeId = result.worktreeId

  const requestedId = '30000000-0000-4000-8000-000000000020'
  await fixture.command({
    type: 'terminal.lease.request',
    commandId: 'req-requested',
    worktreeId,
    terminalLeaseId: requestedId,
    runtimeEpoch: 'stale-runtime',
  })
  await expect(
    fixture.command({
      type: 'terminal.lease.adopt',
      commandId: 'adopt-requested',
      worktreeId,
      terminalLeaseId: requestedId,
      runtimeEpoch: 'new-runtime',
      fromRuntimeEpoch: 'stale-runtime',
    }),
  ).rejects.toMatchObject({ code: 'worktree.STALE_RESULT' })

  const endedId = '30000000-0000-4000-8000-000000000021'
  await fixture.command({
    type: 'terminal.lease.request',
    commandId: 'req-ended',
    worktreeId,
    terminalLeaseId: endedId,
    runtimeEpoch: 'stale-runtime',
  })
  await fixture.command({
    type: 'terminal.lease.end',
    commandId: 'end-ended',
    worktreeId,
    terminalLeaseId: endedId,
    runtimeEpoch: 'stale-runtime',
  })
  await expect(
    fixture.command({
      type: 'terminal.lease.adopt',
      commandId: 'adopt-ended',
      worktreeId,
      terminalLeaseId: endedId,
      runtimeEpoch: 'new-runtime',
      fromRuntimeEpoch: 'stale-runtime',
    }),
  ).rejects.toMatchObject({ code: 'worktree.STALE_RESULT' })

  const wrongEpochId = '30000000-0000-4000-8000-000000000022'
  await fixture.command({
    type: 'terminal.lease.request',
    commandId: 'req-wrong-epoch',
    worktreeId,
    terminalLeaseId: wrongEpochId,
    runtimeEpoch: 'stale-runtime',
  })
  await fixture.command({
    type: 'terminal.lease.claim',
    commandId: 'claim-wrong-epoch',
    worktreeId,
    terminalLeaseId: wrongEpochId,
    runtimeEpoch: 'stale-runtime',
  })
  await expect(
    fixture.command({
      type: 'terminal.lease.adopt',
      commandId: 'adopt-wrong-epoch',
      worktreeId,
      terminalLeaseId: wrongEpochId,
      runtimeEpoch: 'new-runtime',
      fromRuntimeEpoch: 'a-different-stale-epoch',
    }),
  ).rejects.toMatchObject({ code: 'worktree.STALE_RESULT' })
})

it('ends an ownership-unknown lease only once the host proves the process is gone', async () => {
  const fixture = await createOrchestrationFixture()
  fixtures.push(fixture)
  const result = (await fixture.register()).result
  if (!result) throw new TypeError('Missing registered worktree')
  const worktreeId = result.worktreeId
  const terminalLeaseId = '30000000-0000-4000-8000-000000000030'
  const shared = { worktreeId, terminalLeaseId, runtimeEpoch: 'stale-runtime' }
  await fixture.command({ ...shared, type: 'terminal.lease.request', commandId: 'request' })
  await fixture.command({ ...shared, type: 'terminal.lease.claim', commandId: 'claim' })
  await fixture.command({ ...shared, type: 'terminal.lease.activate', commandId: 'activate' })
  await fixture.command({
    ...shared,
    type: 'terminal.lease.mark-unknown',
    commandId: 'mark-unknown',
  })

  await expect(
    fixture.command({ ...shared, type: 'terminal.lease.end', commandId: 'end-unproven' }),
  ).rejects.toMatchObject({ code: 'worktree.STALE_RESULT' })
  expect(
    (await fixture.engine.readModelSnapshot()).terminalLeases.get(terminalLeaseId)?.state,
  ).toBe('ownership-unknown')

  await fixture.command({
    ...shared,
    type: 'terminal.lease.end',
    commandId: 'end-proven',
    hostConfirmedGone: true,
  })
  expect(
    (await fixture.engine.readModelSnapshot()).terminalLeases.get(terminalLeaseId)?.state,
  ).toBe('ended')
})

it.each(['alive', 'gone', 'unreachable'] as const)(
  'rechecks unknown ownership when the host is %s',
  async (host) => {
    const fixture = await createOrchestrationFixture()
    fixtures.push(fixture)
    const registration = (await fixture.register()).result!
    const shared = {
      worktreeId: registration.worktreeId,
      terminalLeaseId: '30000000-0000-4000-8000-000000000099',
      runtimeEpoch: 'old',
    }
    await fixture.command({
      ...shared,
      type: 'terminal.lease.request',
      commandId: 'request-unknown',
      key: 'saved-shell',
    })
    await fixture.command({ ...shared, type: 'terminal.lease.claim', commandId: 'claim-unknown' })
    await fixture.command({ ...shared, type: 'terminal.lease.mark-unknown', commandId: 'unknown' })
    let model = await fixture.engine.readModelSnapshot()
    const sessions =
      host === 'alive'
        ? [
            {
              key: 'saved-shell',
              session: 1,
              pid: 100,
              startedAt: new Date().toISOString(),
              offset: 0,
              exited: false,
            },
          ]
        : []
    const recovery = new TerminalLeaseController({
      gate: new WorktreeExecutionGate(),
      getReadModel: () => model,
      queryHostSessions: async () => (host === 'unreachable' ? null : sessions),
      dispatch: async (command) => {
        await fixture.command(command)
        model = await fixture.engine.readModelSnapshot()
      },
    })
    await recovery.recover()
    const expected = { alive: 'active', gone: 'ended', unreachable: 'ownership-unknown' }
    expect(model.terminalLeases.get(shared.terminalLeaseId)?.state).toBe(expected[host])
  },
)
