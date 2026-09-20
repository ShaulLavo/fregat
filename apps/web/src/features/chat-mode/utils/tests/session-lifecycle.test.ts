import { healthDescriptorSchema } from '@workspace/contracts'
import * as v from 'valibot'
import { sessionLifecyclePolicy } from '@/features/chat-mode/utils/session-lifecycle'
import { projectionSession, sessionActivity } from '../../../../../test/factories/chat'
import { expect, test } from '../../../../../test/fixtures'

test('snooze admits a genuinely running adopted turn before first output, but blocks queued and mismatched adoption', async ({
  client,
}) => {
  const descriptor = v.parse(healthDescriptorSchema, (await client.health.get()).data)
  const owner = { phase: 'live' as const, descriptor }
  const base = projectionSession()
  const running = { ...base, latestTurn: { ...base.latestTurn!, startedAt: null } }
  expect(sessionLifecyclePolicy(running, owner, []).snoozeBlocked).toBe(false)
  expect(sessionLifecyclePolicy(running, owner, []).settleBlocked).toBe(true)
  for (const providerStartState of ['queued', 'claimed'] as const)
    expect(
      sessionLifecyclePolicy(
        { ...running, latestTurn: { ...running.latestTurn, providerStartState } },
        owner,
        [],
      ).snoozeBlocked,
    ).toBe(true)
  expect(
    sessionLifecyclePolicy(
      { ...running, runtime: { ...running.runtime!, activeTurnId: null } },
      owner,
      [],
    ).snoozeBlocked,
  ).toBe(true)
})

test('settlement can dismiss retained message questions but cannot hide native questions or approvals', async ({
  client,
}) => {
  const descriptor = v.parse(healthDescriptorSchema, (await client.health.get()).data)
  const owner = { phase: 'live' as const, descriptor }
  const question = sessionActivity({
    kind: 'user-input.requested',
    payload: {
      requestId: 'optional',
      responseMode: 'message',
      questions: [
        {
          id: 'q',
          header: 'Next',
          prompt: 'Continue?',
          answerKind: 'text',
          allowOther: false,
          secret: false,
          options: [],
        },
      ],
    },
  })
  const idle = projectionSession({
    latestTurn: null,
    runtime: null,
    pendingUserInputCount: 1,
    pendingMessageQuestions: [question],
  })
  expect(sessionLifecyclePolicy(idle, owner, []).settleBlocked).toBe(false)
  expect(sessionLifecyclePolicy(idle, owner, []).snoozeBlocked).toBe(true)
  expect(
    sessionLifecyclePolicy({ ...idle, pendingUserInputCount: 2 }, owner, []).settleBlocked,
  ).toBe(true)
  expect(
    sessionLifecyclePolicy({ ...idle, pendingApprovalCount: 1 }, owner, []).settleBlocked,
  ).toBe(true)
  expect(sessionLifecyclePolicy(idle, { ...owner, phase: 'offline' }, []).settlement).toBe(false)
  expect(
    sessionLifecyclePolicy(
      idle,
      { ...owner, descriptor: { ...descriptor, capabilities: undefined } },
      [],
    ).snooze,
  ).toBe(false)
  expect(
    sessionLifecyclePolicy({ ...idle, archivedAt: new Date().toISOString() }, owner, []).pinning,
  ).toBe(false)
})
