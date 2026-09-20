import { useChatInputDraftStore } from '@/features/chat/state/chat-input-draft-store'
import {
  shellSnapshot,
  TEST_ENVIRONMENT_ID as FIXTURE_ENVIRONMENT_ID,
} from '../../../../../test/factories/chat'
import { act, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { eventIdSchema, type ClientOrchestrationCommand } from '@workspace/contracts'
import * as v from 'valibot'

import { PendingUserInputPanel } from '@/features/chat/components/pending-user-input-panel'
import { ChatPendingRequestsProvider } from '@/features/chat/providers/pending-requests-provider'
import { unsupportedChatTransport } from '../../../../../test/factories/chat-transport'
import { useChatProjectionStore } from '@/features/chat/state/chat-projection-store'
import { expect, test } from '../../../../../test/fixtures'
import { sessionActivity, session as sessionFactory } from '../../../../../test/factories/chat'
import { renderWithProviders } from '../../../../../test/render'

const REQUEST_ID = 'user-input-1'

test('a single-select question renders its options and submits the chosen value', async () => {
  const { dispatched } = renderPanel([requestedActivity([framework()])])

  const card = screen.getByRole('region', { name: 'Agent question' })
  const arrival = within(card).getByRole('status')
  expect(arrival).toHaveTextContent('Which test runner should this use?')
  expect(within(arrival).queryByRole('button')).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: /Vitest/ }))
  await userEvent.click(screen.getByRole('button', { name: 'Submit' }))

  expect(dispatched[0]).toMatchObject({
    answers: { framework: 'vitest' },
    requestId: REQUEST_ID,
    type: 'session.user-input.respond',
  })
  expect(screen.getByText('Response sent. Waiting for agent…')).toBeVisible()
})

test('submit stays disabled until every question is answered', async () => {
  renderPanel([requestedActivity([framework(), notes()])])

  expect(screen.getByRole('button', { name: 'Submit' })).toBeDisabled()

  await userEvent.click(screen.getByRole('button', { name: /Vitest/ }))
  await userEvent.type(screen.getByLabelText('Your answer'), 'cover the revert path')

  expect(screen.getByRole('button', { name: 'Submit' })).toBeEnabled()
})

test('a multi-question prompt walks both answers into one response', async () => {
  const { dispatched } = renderPanel([requestedActivity([framework(), notes()])])

  expect(screen.getByText('1/2')).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: /Vitest/ }))
  await userEvent.type(screen.getByLabelText('Your answer'), 'cover the revert path')
  await userEvent.click(screen.getByRole('button', { name: 'Submit' }))

  expect(dispatched[0]).toMatchObject({
    answers: { framework: 'vitest', notes: 'cover the revert path' },
    type: 'session.user-input.respond',
  })
})

test('a multi-select keeps collecting values instead of advancing', async () => {
  const { dispatched } = renderPanel([requestedActivity([targets()])])

  await userEvent.click(screen.getByRole('button', { name: /Server/ }))
  await userEvent.click(screen.getByRole('button', { name: /Web/ }))
  await userEvent.click(screen.getByRole('button', { name: 'Submit' }))

  expect(dispatched[0]).toMatchObject({
    answers: { targets: ['server', 'web'] },
  })
})

test('a resolved prompt leaves nothing to answer', () => {
  renderPanel([requestedActivity([framework()]), resolvedActivity()])

  expect(screen.queryByRole('region', { name: 'Agent question' })).not.toBeInTheDocument()
})

test('next cannot skip an unanswered question', async () => {
  renderPanel([requestedActivity([notes(), framework()])])

  expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled()
  await userEvent.type(screen.getByLabelText('Your answer'), 'Check the editor')
  expect(screen.getByRole('button', { name: 'Next' })).toBeEnabled()
})

test('a failed response keeps the answer and reports why it can be retried', async () => {
  renderPanel([requestedActivity([notes()])], () => Promise.reject('offline'))

  await userEvent.type(screen.getByLabelText('Your answer'), 'Keep this answer')
  await userEvent.click(screen.getByRole('button', { name: 'Submit' }))

  expect(await screen.findByText('Could not send your response. offline')).toBeVisible()
  expect(screen.getByLabelText('Your answer')).toHaveValue('Keep this answer')
  expect(screen.getByRole('button', { name: 'Submit' })).toBeEnabled()
})

function framework() {
  return {
    answerKind: 'single-select',
    id: 'framework',
    options: [
      { label: 'Vitest', value: 'vitest' },
      { label: 'Bun test', value: 'bun-test' },
    ],
    prompt: 'Which test runner should this use?',
  }
}

function targets() {
  return {
    answerKind: 'multi-select',
    id: 'targets',
    options: [
      { label: 'Server', value: 'server' },
      { label: 'Web', value: 'web' },
    ],
    prompt: 'Which targets should this cover?',
  }
}

function notes() {
  return {
    answerKind: 'text',
    id: 'notes',
    prompt: 'Anything else the agent should know?',
  }
}

function requestedActivity(questions: readonly unknown[]) {
  return sessionActivity({
    kind: 'user-input.requested',
    payload: { questions, requestId: REQUEST_ID },
    summary: 'User input requested',
    tone: 'info',
  })
}

function resolvedActivity() {
  return sessionActivity({
    id: v.parse(eventIdSchema, 'event-activity-2'),
    kind: 'user-input.resolved',
    payload: { answers: { framework: 'vitest' }, requestId: REQUEST_ID },
    sequence: 2,
    summary: 'User input submitted',
    tone: 'info',
  })
}

function renderPanel(
  activities: ReturnType<typeof sessionActivity>[],
  dispatch?: () => Promise<{
    result: null
    deduped: boolean
    sequence: number
  }>,
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
  useChatProjectionStore
    .getState()
    // The store's ChatSession drops `deletedAt`; the wire snapshot still carries it.
    .syncSessionDetailSnapshot(FIXTURE_ENVIRONMENT_ID, {
      checkpoints: [],
      proposedPlans: [],
      snapshotSequence: 1,
      session: { deletion: null, ...seeded, deletedAt: null },
    })

  const dispatched: ClientOrchestrationCommand[] = []

  renderWithProviders(
    <ChatPendingRequestsProvider
      transport={{
        ...unsupportedChatTransport(),
        dispatchCommand: async (command) => {
          dispatched.push(command)
          if (dispatch) return dispatch()
          return { result: null, deduped: false, sequence: 1 }
        },
      }}
      sessionId={seeded.id}
    >
      <PendingUserInputPanel />
    </ChatPendingRequestsProvider>,
  )

  return { dispatched, sessionId: seeded.id }
}

test('only message-mode questions offer dismissal and dispatch without an answer', async () => {
  const activity = requestedActivity([framework()])
  const { dispatched } = renderPanel([
    {
      ...activity,
      payload: {
        questions: [framework()],
        requestId: REQUEST_ID,
        responseMode: 'message',
      },
    },
  ])
  await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
  expect(dispatched[0]).toMatchObject({
    type: 'session.user-input.dismiss',
    requestId: REQUEST_ID,
  })
  expect(dispatched[0]).not.toHaveProperty('answers')
})

test('native callback questions do not offer dismissal', () => {
  renderPanel([requestedActivity([framework()])])
  expect(screen.queryByRole('button', { name: 'Dismiss' })).not.toBeInTheDocument()
})

test('number shortcuts select visible choices but ignore editable fields and modifiers', async () => {
  renderPanel([requestedActivity([{ ...framework(), allowOther: true }])])
  await userEvent.keyboard('2')
  expect(screen.getByRole('button', { name: 'Bun test' })).toHaveAttribute('aria-pressed', 'true')
  await userEvent.click(screen.getByLabelText('Other'))
  await userEvent.keyboard('1')
  expect(screen.getByLabelText('Other')).toHaveValue('1')
  await userEvent.click(screen.getByRole('status'))
  await userEvent.keyboard('{Control>}1{/Control}')
  expect(screen.getByRole('button', { name: 'Vitest' })).toHaveAttribute('aria-pressed', 'false')
})

test('number shortcuts answer only the visible request when two requests are pending', async () => {
  const secondQuestion = {
    ...framework(),
    id: 'second',
    prompt: 'Second pending question?',
  }
  const second = requestedActivity([secondQuestion])
  const { dispatched } = renderPanel([
    requestedActivity([framework()]),
    {
      ...second,
      id: v.parse(eventIdSchema, 'second-pending-question'),
      sequence: 2,
      payload: { questions: [secondQuestion], requestId: 'user-input-2' },
    },
  ])

  expect(screen.getAllByRole('region', { name: 'Agent question' })).toHaveLength(1)
  expect(screen.queryByText('Second pending question?')).not.toBeInTheDocument()
  await userEvent.keyboard('2')
  await userEvent.click(screen.getByRole('button', { name: 'Submit' }))
  expect(dispatched).toHaveLength(1)
  expect(dispatched[0]).toMatchObject({
    requestId: REQUEST_ID,
    answers: { framework: 'bun-test' },
  })
})

test('independent question attachments can answer without text and survive failed response', async () => {
  const { dispatched, sessionId } = renderPanel(
    [requestedActivity([notes(), { ...notes(), id: 'second', prompt: 'Second question?' }])],
    async () => {
      throw new TypeError('Response rejected')
    },
  )
  function stage(questionId: string, name: string) {
    const attachment = {
      type: 'image' as const,
      id: `test-${questionId}`,
      name,
      mimeType: 'image/png',
      sizeBytes: 5,
    }
    act(() =>
      useChatInputDraftStore.getState().addAttachments(
        {
          environmentId: FIXTURE_ENVIRONMENT_ID,
          rootPath: '',
          draftKey: `${sessionId}:question:${REQUEST_ID}:${questionId}`,
        },
        [
          {
            ...attachment,
            previewUrl: 'data:image/png;base64,AA==',
            upload: { status: 'ready', attachment, expiresAt: '2099-01-01T00:00:00Z' },
          },
        ],
      ),
    )
  }
  stage('notes', 'first.png')
  await screen.findByRole('button', { name: 'Remove first.png' })
  await userEvent.click(screen.getByRole('button', { name: 'Next' }))
  expect(screen.queryByRole('button', { name: 'Remove first.png' })).not.toBeInTheDocument()
  stage('second', 'second.png')
  await screen.findByRole('button', { name: 'Remove second.png' })
  await userEvent.click(screen.getByRole('button', { name: 'Submit' }))
  expect(dispatched[0]).toMatchObject({
    answers: { notes: '', second: '' },
    attachmentsByQuestionId: {
      notes: [expect.objectContaining({ name: 'first.png' })],
      second: [expect.objectContaining({ name: 'second.png' })],
    },
  })
  expect(screen.getByRole('button', { name: 'Remove second.png' })).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Back' }))
  expect(screen.getByRole('button', { name: 'Remove first.png' })).toBeInTheDocument()
})
