import { expect, test } from 'vitest'
import * as v from 'valibot'
import { clientOrchestrationCommandSchema } from '@workspace/contracts'
import { OrchestrationCommandReceipts } from '../command-receipts'
import { worktreeLifecycleErrors } from '../worktrees/worktree-errors'
import { createWorktreeDomain, MANAGED_ID } from './factories/worktree-domain'
import { DOMAIN_IDS, DOMAIN_MODEL } from './factories/session-domain'

test('trusted preparation failures retain the original session wire intent and durable receipt', () => {
  const fixture = createWorktreeDomain()
  const receipts = new OrchestrationCommandReceipts(fixture.database)
  const command = v.parse(clientOrchestrationCommandSchema, {
    type: 'session.create',
    commandId: 'prepare-invalid',
    sessionId: DOMAIN_IDS.session,
    title: 'Session',
    modelSelection: DOMAIN_MODEL,
    worktreeTarget: { kind: 'new', worktreeId: MANAGED_ID, baseWorktreeId: DOMAIN_IDS.worktree },
  })
  const error = worktreeLifecycleErrors.UNSUPPORTED_REPOSITORY({ worktreeId: DOMAIN_IDS.worktree })
  const first = receipts.recordPreparationRejected(command, error, 'original-wire-intent')
  expect(first).toMatchObject({
    status: 'rejected',
    aggregateKind: 'session',
    aggregateId: DOMAIN_IDS.session,
    commandType: 'session.create',
    intentFingerprint: 'original-wire-intent',
    resultSequence: null,
  })
  expect(receipts.recordPreparationRejected(command, error, 'original-wire-intent')).toEqual(first)
  expect(() => receipts.recordPreparationRejected(command, error, 'different-intent')).toThrow(
    expect.objectContaining({ code: 'orchestration.COMMAND_ID_COLLISION' }),
  )
  expect(fixture.eventStore.currentSequence()).toBe(2)
})

test('an infrastructure failure before acceptance remains retryable', () => {
  const fixture = createWorktreeDomain()
  const receipts = new OrchestrationCommandReceipts(fixture.database)
  const command = v.parse(clientOrchestrationCommandSchema, {
    type: 'worktree.cleanup',
    commandId: 'temporary-failure',
    worktreeId: MANAGED_ID,
  })
  expect(
    receipts.recordPreparationRejected(
      command,
      new TypeError('database temporarily unavailable'),
      'intent',
    ),
  ).toBeNull()
  expect(receipts.find(command.commandId)).toBeNull()
})
