import { expect, test } from 'vitest'
import { OrchestrationStreams } from '../streams'
import { createWorktreeDomain, MANAGED_ID, SECOND_SESSION_ID } from './factories/worktree-domain'
import { DOMAIN_IDS, DOMAIN_MODEL } from './factories/session-domain'

test('a shared checkout becoming missing updates every session and cannot be acknowledged away', () => {
  const fixture = createWorktreeDomain()
  fixture.create()
  fixture.ready()
  fixture.dispatch({
    type: 'session.create',
    sessionId: SECOND_SESSION_ID,
    worktreeTarget: { kind: 'current', worktreeId: MANAGED_ID },
    title: 'Shared',
    modelSelection: DOMAIN_MODEL,
  })
  const events = fixture.dispatch({ type: 'worktree.mark-missing', worktreeId: MANAGED_ID })
  expect(events.filter((event) => event.type === 'session.worktree-blocked')).toHaveLength(2)
  fixture.dispatch({ type: 'session.settle', sessionId: DOMAIN_IDS.session })
  for (const session of fixture.snapshots.shellSnapshot().sessions)
    expect(session).toMatchObject({
      attentionState: 'needs-input',
      attentionReason: 'worktree',
      hasError: true,
    })
})

test('session deletion fans the durable provider-stop guard into a worktree shell delta', async () => {
  const fixture = createWorktreeDomain()
  fixture.create()
  fixture.ready()
  const streams = new OrchestrationStreams(fixture.snapshots, {
    database: fixture.database,
    coalesceWindowMs: 0,
  })
  const controller = new AbortController()
  const iterator = streams.shell({ signal: controller.signal })
  await iterator.next()
  await iterator.next()
  const next = iterator.next()
  streams.publish(fixture.dispatch({ type: 'session.delete', sessionId: DOMAIN_IDS.session }))
  const first = await next
  expect(first.value).toMatchObject({ kind: 'session-removed', sessionId: DOMAIN_IDS.session })
  const second = await iterator.next()
  expect(second.value).toMatchObject({
    kind: 'worktree-upserted',
    worktree: {
      id: MANAGED_ID,
      cleanupEligibility: { reason: 'provider-stop-pending', nonDeletedSessionCount: 0 },
    },
  })
  controller.abort()
  await iterator.return(undefined)
})

test('reconnecting between same-sequence frames replays the missing worktree delta', async () => {
  const fixture = createWorktreeDomain()
  fixture.create()
  fixture.ready()
  const streams = new OrchestrationStreams(fixture.snapshots, {
    database: fixture.database,
    coalesceWindowMs: 0,
  })
  const controller = new AbortController()
  const iterator = streams.shell({ signal: controller.signal })
  await iterator.next()
  await iterator.next()
  const next = iterator.next()
  const events = fixture.dispatch({ type: 'session.delete', sessionId: DOMAIN_IDS.session })
  streams.publish(events)
  const first = await next
  expect(first.value).toMatchObject({ kind: 'session-removed', sessionId: DOMAIN_IDS.session })
  controller.abort()
  await iterator.return(undefined)

  const resumed = streams.shell({ afterSequence: events.at(-1)!.sequence })
  expect((await resumed.next()).value).toMatchObject({ kind: 'session-removed' })
  expect((await resumed.next()).value).toMatchObject({
    kind: 'worktree-upserted',
    worktree: { id: MANAGED_ID, cleanupEligibility: { reason: 'provider-stop-pending' } },
  })
  expect((await resumed.next()).value).toMatchObject({ kind: 'synchronized' })
  await resumed.return(undefined)
})

test('coalesced fanout keeps its causal cursor before later unrelated events', async () => {
  const fixture = createWorktreeDomain()
  fixture.create()
  fixture.ready()
  fixture.dispatch({
    type: 'session.create',
    sessionId: SECOND_SESSION_ID,
    worktreeTarget: { kind: 'current', worktreeId: DOMAIN_IDS.worktree },
    title: 'Other checkout',
    modelSelection: DOMAIN_MODEL,
  })
  const streams = new OrchestrationStreams(fixture.snapshots, {
    database: fixture.database,
    coalesceWindowMs: 0,
  })
  const controller = new AbortController()
  const iterator = streams.shell({ signal: controller.signal })
  await iterator.next()
  await iterator.next()
  const next = iterator.next()
  const deleted = fixture.dispatch({ type: 'session.delete', sessionId: DOMAIN_IDS.session })
  const unrelated = fixture.dispatch({ type: 'session.pin', sessionId: SECOND_SESSION_ID })
  streams.publish(deleted.concat(unrelated))
  expect((await next).value).toMatchObject({ kind: 'session-removed' })
  expect((await iterator.next()).value).toMatchObject({
    kind: 'worktree-upserted',
    worktree: { id: MANAGED_ID },
    sequence: deleted.at(-1)!.sequence,
  })
  expect((await iterator.next()).value).toMatchObject({
    kind: 'session-upserted',
    session: { id: SECOND_SESSION_ID },
    sequence: unrelated.at(-1)!.sequence,
  })
  controller.abort()
  await iterator.return(undefined)
})
