import {
  shellSnapshot,
  TEST_ENVIRONMENT_ID as FIXTURE_ENVIRONMENT_ID,
} from '../../../../../test/factories/chat'
import { act, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  eventIdSchema,
  type ClientOrchestrationCommand,
  type SessionId,
} from '@workspace/contracts'
import type { ReactNode } from 'react'
import * as v from 'valibot'

import { PendingApprovalPanel } from '@/features/chat/components/pending-approval-panel'
import { ChatPendingRequestsProvider } from '@/features/chat/providers/pending-requests-provider'
import { useChatProjectionStore } from '@/features/chat/state/chat-projection-store'
import { expect, test } from '../../../../../test/fixtures'
import { sessionActivity, session as sessionFactory } from '../../../../../test/factories/chat'
import { renderWithProviders } from '../../../../../test/render'

const REQUEST_ID = 'approval-1'

test('an open approval renders its command and offers every decision', () => {
  renderPanel([requestedActivity()])

  expect(screen.getByRole('alert', { name: 'Pending approvals' })).toBeInTheDocument()
  expect(screen.getByLabelText('Command')).toHaveTextContent('rm -rf build')
  for (const label of ['Allow', 'Allow for this session', 'Deny', 'Cancel']) {
    expect(screen.getByRole('button', { name: label })).toBeEnabled()
  }
})

test('allowing dispatches the respond command for that request', async () => {
  const { dispatched } = renderPanel([requestedActivity()])

  await userEvent.click(screen.getByRole('button', { name: 'Allow' }))

  expect(dispatched).toHaveLength(1)
  expect(dispatched[0]).toMatchObject({
    decision: 'accept',
    requestId: REQUEST_ID,
    type: 'session.approval.respond',
  })
})

test('each decision sends its own verb', async () => {
  const { dispatched } = renderPanel([requestedActivity()])

  await userEvent.click(screen.getByRole('button', { name: 'Deny' }))

  expect(dispatched[0]).toMatchObject({ decision: 'decline', type: 'session.approval.respond' })
})

test('a resolved approval leaves nothing to answer', () => {
  renderPanel([requestedActivity(), resolvedActivity()])

  expect(screen.queryByRole('alert', { name: 'Pending approvals' })).not.toBeInTheDocument()
})

test('only the oldest approval is shown and resolving it reveals the next request', () => {
  const nextApproval = sessionActivity({
    id: v.parse(eventIdSchema, 'event-activity-next'),
    sequence: 3,
    payload: {
      detail: 'cat package.json',
      requestId: 'approval-2',
      requestKind: 'command',
      requestType: 'exec_command_approval',
    },
  })
  const { updateActivities } = renderPanel([requestedActivity(), nextApproval])

  expect(screen.getByText('1/2')).toBeInTheDocument()
  expect(screen.getByLabelText('Command')).toHaveTextContent('rm -rf build')
  expect(screen.queryByText('cat package.json')).not.toBeInTheDocument()
  expect(screen.getAllByRole('button', { name: 'Allow' })).toHaveLength(1)

  act(() => updateActivities([requestedActivity(), resolvedActivity(), nextApproval]))

  expect(screen.queryByText('1/2')).not.toBeInTheDocument()
  expect(screen.getByLabelText('Command')).toHaveTextContent('cat package.json')
  expect(screen.queryByText('rm -rf build')).not.toBeInTheDocument()
})

test('the complete approval detail is keyboard accessible without truncation', () => {
  const detail = `bun run build\n${'echo checking workspace\n'.repeat(30)}bun run deploy`
  renderPanel([
    sessionActivity({
      payload: {
        detail,
        requestId: REQUEST_ID,
        requestKind: 'command',
        requestType: 'exec_command_approval',
      },
    }),
  ])

  expect(screen.getByLabelText('Command').textContent).toBe(detail)
  expect(screen.getByLabelText('Command')).toHaveAttribute('tabindex', '0')
})

test('the decisions stay disabled while a response is in flight', async () => {
  // Never settles, so the row is observed mid-dispatch rather than after it.
  renderPanel([requestedActivity()], () => new Promise(() => {}))

  await userEvent.click(screen.getByRole('button', { name: 'Allow' }))

  expect(await screen.findByRole('button', { name: 'Allow' })).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Deny' })).toBeDisabled()
})

test('a failed dispatch re-enables the row so the agent can still be unblocked', async () => {
  renderPanel([requestedActivity()], () => Promise.reject(new Error('offline')))

  await userEvent.click(screen.getByRole('button', { name: 'Allow' }))

  expect(await screen.findByRole('button', { name: 'Allow' })).toBeEnabled()
})

function requestedActivity() {
  return sessionActivity({
    payload: {
      detail: 'rm -rf build',
      requestId: REQUEST_ID,
      requestKind: 'command',
      requestType: 'exec_command_approval',
    },
  })
}

function resolvedActivity() {
  return sessionActivity({
    id: v.parse(eventIdSchema, 'event-activity-2'),
    kind: 'approval.resolved',
    payload: { decision: 'accept', requestId: REQUEST_ID, requestKind: 'command' },
    sequence: 2,
    summary: 'Approval resolved',
  })
}

function renderPanel(
  activities: ReturnType<typeof sessionActivity>[],
  dispatch?: () => Promise<{ result: null; deduped: boolean; sequence: number }>,
) {
  const seeded = sessionFactory({ activities })
  useChatProjectionStore.getState().resetChatProjection()
  useChatProjectionStore.getState().syncShellSnapshot(
    FIXTURE_ENVIRONMENT_ID,
    shellSnapshot({
      projects: [seeded.project],
      worktrees: [seeded.worktree],
      sessions: [seeded],
    }),
  )
  useChatProjectionStore.getState().syncSessionDetailSnapshot(FIXTURE_ENVIRONMENT_ID, {
    checkpoints: [],
    proposedPlans: [],
    snapshotSequence: 1,
    // The store's ChatSession drops `deletedAt`; the wire snapshot still carries it.
    session: { deletion: null, ...seeded, deletedAt: null },
  })

  const dispatched: ClientOrchestrationCommand[] = []
  const dispatchCommand = async (command: ClientOrchestrationCommand) => {
    dispatched.push(command)
    if (dispatch) return dispatch()

    return { result: null, deduped: false, sequence: 1 }
  }

  renderWithProviders(
    <Wrap dispatchCommand={dispatchCommand} sessionId={seeded.id}>
      <PendingApprovalPanel />
    </Wrap>,
  )

  return {
    dispatched,
    updateActivities: (nextActivities: ReturnType<typeof sessionActivity>[]) => {
      useChatProjectionStore.getState().syncSessionDetailSnapshot(FIXTURE_ENVIRONMENT_ID, {
        checkpoints: [],
        proposedPlans: [],
        snapshotSequence: 2,
        session: { deletion: null, ...seeded, activities: nextActivities, deletedAt: null },
      })
    },
  }
}

function Wrap({
  children,
  dispatchCommand,
  sessionId,
}: {
  children: ReactNode
  dispatchCommand: (command: ClientOrchestrationCommand) => Promise<{
    result: null
    deduped: boolean
    sequence: number
  }>
  sessionId: SessionId
}) {
  return (
    <ChatPendingRequestsProvider dispatchCommand={dispatchCommand} sessionId={sessionId}>
      {children}
    </ChatPendingRequestsProvider>
  )
}
