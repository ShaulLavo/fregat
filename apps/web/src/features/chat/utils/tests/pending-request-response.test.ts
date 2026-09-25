import type {
  ApprovalRequestId,
  CommandId,
  OrchestrationSessionActivity,
} from '@workspace/contracts'

import {
  pendingRequestResponse,
  type PendingRequestMutation,
} from '@/features/chat/utils/pending-request-response'
import { expect, test } from '../../../../../test/fixtures'

const requestId = 'req-1' as ApprovalRequestId

function mutation(
  status: PendingRequestMutation['status'],
  commandId = 'cmd-1',
): PendingRequestMutation {
  return { commandId: commandId as CommandId, errorMessage: null, requestId, status }
}

function respondFailed(commandId: string): OrchestrationSessionActivity {
  return {
    createdAt: '2026-09-25T00:00:00.000Z',
    id: 'activity-1',
    kind: 'provider.approval.respond.failed',
    payload: { commandId, detail: 'Provider socket hung up', requestId },
    sessionId: 'session-1',
    summary: 'Provider approval response failed',
    tone: 'error',
    turnId: null,
  } as OrchestrationSessionActivity
}

test('the latest mutation for the request decides its state', () => {
  const input = { activities: [], requestId, submittedElsewhere: false }

  expect(pendingRequestResponse({ ...input, mutations: [] })).toEqual({ kind: 'idle' })
  expect(pendingRequestResponse({ ...input, mutations: [mutation('pending')] })).toEqual({
    kind: 'submitting',
  })
  expect(
    pendingRequestResponse({
      ...input,
      mutations: [mutation('error'), mutation('success', 'cmd-2')],
    }),
  ).toEqual({ kind: 'accepted' })
})

test('an agent-side failure for the accepted command reads as failed', () => {
  expect(
    pendingRequestResponse({
      activities: [respondFailed('cmd-1')],
      mutations: [mutation('success')],
      requestId,
      submittedElsewhere: false,
    }),
  ).toEqual({ kind: 'failed', message: 'Provider socket hung up' })
})

test('an answer from another window reads as sent', () => {
  expect(
    pendingRequestResponse({ activities: [], mutations: [], requestId, submittedElsewhere: true }),
  ).toEqual({ kind: 'accepted' })
})
