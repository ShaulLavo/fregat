import {
  TEST_WORKTREE_ID,
  shellSnapshot,
  TEST_ENVIRONMENT_ID as FIXTURE_ENVIRONMENT_ID,
} from '../../../../../test/factories/chat'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  proposedPlanIdSchema,
  sessionIdSchema,
  type ClientOrchestrationCommand,
  type OrchestrationProposedPlan,
  type OrchestrationSessionDetailSnapshot,
  type SessionId,
} from '@workspace/contracts'
import * as v from 'valibot'

import { PlanFollowUpBanner } from '@/features/chat/components/plan-follow-up-banner'
import { ChatPlanFollowUpProvider } from '@/features/chat/providers/plan-follow-up-provider'
import {
  resetChatInputDraftStore,
  useChatInputDraftStore,
  type ChatInputDraftTarget,
} from '@/features/chat/state/chat-input-draft-store'
import {
  chatMessageIntents,
  createOptimisticMessagesForSessionSelector,
  resetChatMessageIntents,
} from '@/features/chat/state/chat-message-intents'
import { useChatProjectionStore } from '@/features/chat/state/chat-projection-store'
import { unsupportedChatTransport } from '../../../../../test/factories/chat-transport'
import { expect, test } from '../../../../../test/fixtures'
import { session as sessionFactory } from '../../../../../test/factories/chat'
import { renderWithProviders } from '../../../../../test/render'

const PLAN_MARKDOWN = '# Ship the retry queue\n\n1. Add the queue\n2. Drain it on boot'
const SESSION_ID = v.parse(sessionIdSchema, 'ad686244-5b2e-59be-805f-ef86eac80feb')
const draftTarget: ChatInputDraftTarget = {
  environmentId: FIXTURE_ENVIRONMENT_ID,
  draftKey: SESSION_ID,
  rootPath: '/repo/platform',
}

test('a plan waiting on the user offers to implement it', () => {
  renderBanner()

  expect(screen.getByRole('status', { name: 'Plan ready' })).toHaveTextContent(
    'Ship the retry queue',
  )
  expect(screen.getByRole('button', { name: 'Implement' })).toBeEnabled()
})

test('plan actions cannot bypass a disconnected composer', async () => {
  const { dispatched } = renderBanner({ disabledReason: 'Reconnecting chat…' })
  expect(screen.getByRole('button', { name: 'Implement' })).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Implement in a new session' })).toBeDisabled()
  await userEvent.click(screen.getByRole('button', { name: 'Implement' }))
  expect(dispatched).toHaveLength(0)
})

test('plan actions wait for staged image preparation', async () => {
  const { dispatched } = renderBanner()
  useChatInputDraftStore.getState().changeAttachmentPreparation(draftTarget, 1)
  expect(await screen.findByRole('button', { name: 'Implement' })).toBeDisabled()
  expect(dispatched).toHaveLength(0)
})

test('typed feedback turns the same action into a refinement', async () => {
  renderBanner()

  useChatInputDraftStore.getState().setPrompt(draftTarget, 'drop step 2')

  expect(await screen.findByRole('button', { name: 'Refine' })).toBeEnabled()
  expect(screen.queryByRole('button', { name: 'Implement' })).not.toBeInTheDocument()
})

test('implementing starts a turn that points back at the plan it came from', async () => {
  const { dispatched } = renderBanner()

  await userEvent.click(screen.getByRole('button', { name: 'Implement' }))

  expect(dispatched).toHaveLength(1)
  expect(dispatched[0]).toMatchObject({
    interactionMode: 'default',
    sourceProposedPlan: { planId: 'plan-1', sessionId: 'ad686244-5b2e-59be-805f-ef86eac80feb' },
    sessionId: 'ad686244-5b2e-59be-805f-ef86eac80feb',
    type: 'session.turn.start',
  })
})

test('the implementation turn carries the plan itself as the prompt', async () => {
  const { dispatched } = renderBanner()

  await userEvent.click(screen.getByRole('button', { name: 'Implement' }))

  const command = dispatched[0]
  expect(command?.type === 'session.turn.start' && command.message.text).toContain(
    'Drain it on boot',
  )
})

test('refining stays in plan mode and never claims the plan was implemented', async () => {
  const { dispatched } = renderBanner()
  useChatInputDraftStore.getState().setPrompt(draftTarget, 'drop step 2')

  await userEvent.click(await screen.findByRole('button', { name: 'Refine' }))

  expect(dispatched[0]).toMatchObject({
    interactionMode: 'plan',
    message: { text: 'drop step 2' },
    type: 'session.turn.start',
  })
  expect(dispatched[0]).not.toHaveProperty('sourceProposedPlan', expect.anything())
})

test('a sent follow-up leaves the composer draft empty', async () => {
  renderBanner()
  useChatInputDraftStore.getState().setPrompt(draftTarget, 'drop step 2')

  await userEvent.click(await screen.findByRole('button', { name: 'Refine' }))

  expect(useChatInputDraftStore.getState().getDraft(draftTarget).prompt).toBe('')
})

test('an implemented plan offers nothing — the loop is closed', () => {
  renderBanner({ plan: { implementedAt: '2026-05-28T00:00:09.000Z' } })

  expect(screen.queryByRole('status', { name: 'Plan ready' })).not.toBeInTheDocument()
})

test('a session already running a turn hides the action so no duplicate build starts', () => {
  renderBanner({ busy: true })

  expect(screen.queryByRole('button', { name: 'Implement' })).not.toBeInTheDocument()
})

test('a plan can be built in a session of its own, seeded with the plan itself', async () => {
  const { dispatched } = renderBanner()

  await userEvent.click(screen.getByRole('button', { name: 'Implement in a new session' }))

  const command = dispatched[0]
  expect(command).toMatchObject({
    bootstrap: {
      createSession: {
        worktreeTarget: { kind: 'current', worktreeId: TEST_WORKTREE_ID },
        title: 'Implement Ship the retry queue',
      },
    },
    interactionMode: 'default',
    sourceProposedPlan: { planId: 'plan-1', sessionId: 'ad686244-5b2e-59be-805f-ef86eac80feb' },
    type: 'session.turn.start',
  })
  expect(command?.type === 'session.turn.start' && command.message.text).toContain(
    'Drain it on boot',
  )
  expect(command?.type === 'session.turn.start' && command.sessionId).not.toBe(SESSION_ID)
})

test('the session a plan was split into is handed to the host to show', async () => {
  const { created, dispatched } = renderBanner()

  await userEvent.click(screen.getByRole('button', { name: 'Implement in a new session' }))

  // Reported rather than selected here: the sidebar panel and the chat stage
  // keep their selection in different places, and only the host knows which.
  const command = dispatched[0]
  expect(created).toEqual([command?.type === 'session.turn.start' ? command.sessionId : null])
})

test('a rejected split leaves the stage on the session that has the plan', async () => {
  const { created } = renderBanner({ dispatch: () => Promise.reject(new Error('offline')) })

  await userEvent.click(screen.getByRole('button', { name: 'Implement in a new session' }))

  // No session was created, so nothing should be handed over to show.
  expect(created).toEqual([])
  expect(await screen.findByRole('button', { name: 'Implement in a new session' })).toBeEnabled()
})

test('typed feedback withdraws the new-session action — there is no plan to build yet', async () => {
  renderBanner()

  useChatInputDraftStore.getState().setPrompt(draftTarget, 'drop step 2')

  expect(await screen.findByRole('button', { name: 'Refine' })).toBeEnabled()
  expect(
    screen.queryByRole('button', { name: 'Implement in a new session' }),
  ).not.toBeInTheDocument()
})

test('the session holding the plan stops offering it once the build is split off', async () => {
  const { snapshotRequests } = renderBanner()

  await userEvent.click(screen.getByRole('button', { name: 'Implement in a new session' }))

  // Source detail reconciliation observes the separately emitted implementation event.
  await waitFor(() => {
    expect(screen.queryByRole('status', { name: 'Plan ready' })).not.toBeInTheDocument()
  })
  expect(snapshotRequests).toContain(SESSION_ID)
})

test('a host that cannot show the new session does not undo the accepted turn', async () => {
  const { dispatched, snapshotRequests } = renderBanner({
    onSessionCreated: () => {
      throw new Error('no stage for this session')
    },
  })

  await userEvent.click(screen.getByRole('button', { name: 'Implement in a new session' }))

  // The server accepted the command and the turn is running, so the message it
  // will answer stays on screen and the projection still catches up.
  const command = dispatched[0]
  const splitSessionId = command?.type === 'session.turn.start' ? command.sessionId : SESSION_ID
  expect(pendingMessagesFor(splitSessionId)).toHaveLength(1)
  await waitFor(() => {
    expect(snapshotRequests).toContain(splitSessionId)
  })
})

test('a rejected dispatch drops the optimistic message so the timeline stays honest', async () => {
  renderBanner({ dispatch: () => Promise.reject(new Error('offline')) })

  await userEvent.click(screen.getByRole('button', { name: 'Implement' }))

  expect(pendingMessagesFor(SESSION_ID)).toHaveLength(0)
  expect(await screen.findByRole('button', { name: 'Implement' })).toBeEnabled()
})

function renderBanner({
  busy = false,
  disabledReason = null,
  dispatch,
  onSessionCreated,
  plan: planOverrides,
}: {
  busy?: boolean
  disabledReason?: string | null
  dispatch?: () => Promise<{ result: null; deduped: boolean; sequence: number }>
  onSessionCreated?: (sessionId: SessionId) => void
  plan?: Partial<OrchestrationProposedPlan>
} = {}) {
  resetChatInputDraftStore()
  resetChatMessageIntents()
  useChatProjectionStore.getState().resetChatProjection()

  // The factory's default session is mid-turn, which is exactly the busy case.
  const seeded = sessionFactory(busy ? {} : { latestTurn: null, runtime: null })
  useChatProjectionStore.getState().syncShellSnapshot(
    FIXTURE_ENVIRONMENT_ID,
    shellSnapshot({
      projects: [seeded.project],
      worktrees: [seeded.worktree],
      sessions: [seeded],
    }),
  )
  // Server-side truth for the plan, mutated by dispatch the way the projection is:
  // a turn started from a plan stamps that plan, wherever the plan lives.
  let implementedAt = planOverrides?.implementedAt ?? null
  const sourceSnapshot = (): OrchestrationSessionDetailSnapshot => ({
    checkpoints: [],
    proposedPlans: [proposedPlan({ ...planOverrides, implementedAt })],
    snapshotSequence: implementedAt ? 2 : 1,
    // The store's ChatSession drops `deletedAt`; the wire snapshot still carries it.
    session: { deletion: null, ...seeded, deletedAt: null },
  })
  useChatProjectionStore
    .getState()
    .syncSessionDetailSnapshot(FIXTURE_ENVIRONMENT_ID, sourceSnapshot())

  const created: SessionId[] = []
  const dispatched: ClientOrchestrationCommand[] = []
  const snapshotRequests: SessionId[] = []
  const transport = unsupportedChatTransport({
    dispatchCommand: async (command) => {
      dispatched.push(command)
      if (dispatch) return dispatch()

      // The source plan receives its own newer aggregate event on implementation.
      if (command.type === 'session.turn.start' && command.sourceProposedPlan) {
        implementedAt = '2026-05-28T00:00:09.000Z'
      }

      return { result: null, deduped: false, sequence: 1 }
    },
    replayEvents: async () => ({ events: [] }),
    shellStream: async function* () {},
    sessionDetailSnapshot: async (sessionId) => {
      snapshotRequests.push(sessionId)
      if (sessionId === seeded.id) return sourceSnapshot()

      return splitSessionSnapshot(sessionId)
    },
    sessionDetailStream: async function* () {},
  })

  renderWithProviders(
    <ChatPlanFollowUpProvider
      draftTarget={draftTarget}
      disabledReason={disabledReason}
      transport={transport}
      sessionId={seeded.id}
      onSessionCreated={(sessionId) => {
        created.push(sessionId)
        onSessionCreated?.(sessionId)
      }}
    >
      <PlanFollowUpBanner draftTarget={draftTarget} />
    </ChatPlanFollowUpProvider>,
  )

  return { created, dispatched, snapshotRequests }
}

/** The session the build was split into: real session, no plans of its own yet. */
function splitSessionSnapshot(sessionId: SessionId): OrchestrationSessionDetailSnapshot {
  const split = sessionFactory({ id: sessionId, latestTurn: null, runtime: null })

  return {
    checkpoints: [],
    proposedPlans: [],
    snapshotSequence: 1,
    session: { deletion: null, ...split, deletedAt: null },
  }
}

function proposedPlan(
  overrides: Partial<OrchestrationProposedPlan> = {},
): OrchestrationProposedPlan {
  return {
    createdAt: '2026-05-28T00:00:02.000Z',
    id: v.parse(proposedPlanIdSchema, 'plan-1'),
    implementationSessionId: null,
    implementedAt: null,
    planMarkdown: PLAN_MARKDOWN,
    sessionId: SESSION_ID,
    turnId: 'turn-1',
    updatedAt: '2026-05-28T00:00:02.000Z',
    ...overrides,
  } as OrchestrationProposedPlan
}

function pendingMessagesFor(sessionId: SessionId) {
  return createOptimisticMessagesForSessionSelector({
    environmentId: FIXTURE_ENVIRONMENT_ID,
    sessionId,
  })(chatMessageIntents.getState())
}
