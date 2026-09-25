import { DEFAULT_APPROVAL_OPTIONS } from '@workspace/contracts'
import type { OrchestrationSessionActivity } from '@workspace/contracts'

import { derivePendingApprovals } from '@workspace/client-core/chat/pending-approvals'
import { expect, test } from '../../../../../test/fixtures'

test('an unresolved request stays open and a resolved one drops out', () => {
  const pending = derivePendingApprovals([
    requested('req-1', 1),
    requested('req-2', 2),
    resolved('req-1', 3),
    requested('req-3', 4),
    resolved('req-3', 5),
  ])

  expect(pending.map((approval) => approval.requestId)).toEqual(['req-2'])
})

test('open approvals come back oldest first', () => {
  const pending = derivePendingApprovals([
    requested('req-late', 3),
    requested('req-early', 1),
    requested('req-middle', 2),
  ])

  expect(pending.map((approval) => approval.requestId)).toEqual([
    'req-early',
    'req-middle',
    'req-late',
  ])
})

test('a resolve that arrives before its request in the array still closes it', () => {
  const pending = derivePendingApprovals([resolved('req-1', 2), requested('req-1', 1)])

  expect(pending).toEqual([])
})

test('activities without a sequence fall back to createdAt', () => {
  const pending = derivePendingApprovals([
    approvalActivity({ createdAt: at(2), kind: 'approval.requested', requestId: 'req-late' }),
    approvalActivity({ createdAt: at(1), kind: 'approval.requested', requestId: 'req-early' }),
    approvalActivity({ createdAt: at(3), kind: 'approval.resolved', requestId: 'req-late' }),
  ])

  expect(pending.map((approval) => approval.requestId)).toEqual(['req-early'])
})

test('activities sharing a createdAt keep the caller order, so the result is stable', () => {
  const activities = [
    approvalActivity({ createdAt: at(1), kind: 'approval.requested', requestId: 'req-a' }),
    approvalActivity({ createdAt: at(1), kind: 'approval.requested', requestId: 'req-b' }),
    approvalActivity({ createdAt: at(1), kind: 'approval.requested', requestId: 'req-c' }),
  ]

  const first = derivePendingApprovals(activities).map((approval) => approval.requestId)
  const second = derivePendingApprovals(activities).map((approval) => approval.requestId)

  expect(first).toEqual(['req-a', 'req-b', 'req-c'])
  expect(second).toEqual(first)
})

test('malformed payloads are dropped instead of breaking the derivation', () => {
  const pending = derivePendingApprovals([
    activity({ createdAt: at(1), kind: 'approval.requested', payload: null }),
    activity({ createdAt: at(2), kind: 'approval.requested', payload: 'not-a-record' }),
    activity({ createdAt: at(3), kind: 'approval.requested', payload: { detail: 'no id here' } }),
    activity({ createdAt: at(4), kind: 'approval.requested', payload: { requestId: 42 } }),
    activity({ createdAt: at(5), kind: 'approval.requested', payload: { requestId: '  ' } }),
    requested('req-good', 6),
  ])

  expect(pending.map((approval) => approval.requestId)).toEqual(['req-good'])
})

test('a malformed resolve leaves its request open rather than guessing', () => {
  const pending = derivePendingApprovals([
    requested('req-1', 1),
    activity({ createdAt: at(2), kind: 'approval.resolved', payload: { requestId: null } }),
  ])

  expect(pending.map((approval) => approval.requestId)).toEqual(['req-1'])
})

test('the derived approval carries the fields the panel renders', () => {
  const [approval] = derivePendingApprovals([
    activity({
      createdAt: at(1),
      kind: 'approval.requested',
      payload: {
        detail: 'rm -rf build',
        requestId: 'req-1',
        requestKind: 'command',
        requestType: 'exec_command_approval',
      },
      turnId: 'turn-1',
    }),
  ])

  expect(approval).toEqual({
    options: DEFAULT_APPROVAL_OPTIONS,
    defaultToNo: false,
    createdAt: at(1),
    detail: 'rm -rf build',
    requestId: 'req-1',
    requestKind: 'command',
    requestType: 'exec_command_approval',
    turnId: 'turn-1',
  })
})

test('MCP activities retain their advertised choices and app identity across derivation', () => {
  const options = [
    { decision: 'acceptAlways', label: 'Always allow Safari' },
    { decision: 'accept', label: 'Allow once' },
  ]
  const activities = [
    activity({
      createdAt: at(1),
      kind: 'approval.requested',
      payload: {
        requestId: 'mcp-1',
        requestType: 'mcp_elicitation_approval',
        requestKind: 'tool',
        detail: 'Safari',
        options,
      },
    }),
  ]
  const [pending] = derivePendingApprovals(activities)
  expect(pending).toMatchObject({ requestKind: 'app-access', options, detail: 'Safari' })
  expect(derivePendingApprovals(activities)).toEqual([pending])
})

test('requestKind is recovered from requestType when the provider omits it', () => {
  const [approval] = derivePendingApprovals([
    activity({
      createdAt: at(1),
      kind: 'approval.requested',
      payload: { requestId: 'req-1', requestType: 'apply_patch_approval' },
    }),
  ])

  expect(approval?.requestKind).toBe('file-change')
})

test('an unknown requestType leaves requestKind null but keeps the approval answerable', () => {
  const [approval] = derivePendingApprovals([
    activity({
      createdAt: at(1),
      kind: 'approval.requested',
      payload: { requestId: 'req-1', requestType: 'brand_new_approval' },
    }),
  ])

  expect(approval?.requestKind).toBeNull()
  expect(approval?.requestType).toBe('brand_new_approval')
})

test('non-approval activities are ignored', () => {
  const pending = derivePendingApprovals([
    activity({
      createdAt: at(1),
      kind: 'tool.started',
      payload: { requestId: 'req-1', requestKind: 'command' },
    }),
  ])

  expect(pending).toEqual([])
})

function at(index: number) {
  return `2026-05-28T00:00:0${index}.000Z`
}

function requested(requestId: string, sequence: number) {
  return approvalActivity({
    createdAt: at(sequence),
    kind: 'approval.requested',
    requestId,
    sequence,
  })
}

function resolved(requestId: string, sequence: number) {
  return approvalActivity({
    createdAt: at(sequence),
    kind: 'approval.resolved',
    requestId,
    sequence,
  })
}

function approvalActivity({
  createdAt,
  kind,
  requestId,
  sequence,
}: {
  createdAt: string
  kind: string
  requestId: string
  sequence?: number
}) {
  return activity({
    createdAt,
    kind,
    payload: { requestId, requestKind: 'command', requestType: 'exec_command_approval' },
    sequence,
  })
}

function activity({
  createdAt,
  kind,
  payload,
  sequence,
  turnId = null,
}: {
  createdAt: string
  kind: string
  payload: unknown
  sequence?: number
  turnId?: string | null
}): OrchestrationSessionActivity {
  return {
    createdAt,
    id: `event-${kind}-${createdAt}-${sequence ?? 'none'}`,
    kind,
    payload,
    sequence,
    summary: kind,
    sessionId: 'ad686244-5b2e-59be-805f-ef86eac80feb',
    tone: 'info',
    turnId,
  } as OrchestrationSessionActivity
}
