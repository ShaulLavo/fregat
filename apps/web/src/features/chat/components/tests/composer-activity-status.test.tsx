import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { eventIdSchema } from '@workspace/contracts'
import * as v from 'valibot'

import { expect, test } from '../../../../../test/fixtures'
import { session, sessionActivity } from '../../../../../test/factories/chat'
import { renderComposerActivity } from '../../../../../test/factories/chat-view'

test('the composer opens its current plan without duplicating the live tool row', async () => {
  renderComposerActivity({
    connection: { kind: 'live' },
    pendingAction: null,
    session: session({
      activities: [
        sessionActivity({
          kind: 'turn.plan.updated',
          payload: {
            plan: [
              { step: 'Inspect gutters', status: 'completed' },
              { step: 'Check horizontal scrolling', status: 'inProgress' },
            ],
          },
          summary: 'Plan updated',
          tone: 'info',
        }),
        sessionActivity({
          id: v.parse(eventIdSchema, 'running-tool'),
          kind: 'tool.started',
          payload: {
            command: 'rg -n gutter globals.css',
            toolCallId: 'tool-1',
            toolName: 'exec_command',
          },
          sequence: 2,
          summary: 'Command execution started',
          tone: 'tool',
        }),
      ],
    }),
  })

  expect(screen.queryByText('Running rg')).not.toBeInTheDocument()
  expect(screen.queryByRole('status')).not.toBeInTheDocument()
  expect(screen.getByText('1/2')).toBeVisible()
  expect(screen.queryByRole('list', { name: 'Plan steps' })).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: /Check horizontal scrolling/ }))
  expect(screen.getByRole('list', { name: 'Plan steps' })).toHaveTextContent('Inspect gutters')
})

test('connection loss replaces thinking and its live timer with reconnect feedback', () => {
  const { container } = renderComposerActivity({
    connection: { kind: 'reconnecting', label: 'Reconnecting chat…', detail: 'Connection lost' },
    pendingAction: null,
    session: session(),
  })

  expect(screen.getByText('Reconnecting chat…')).toBeVisible()
  expect(screen.queryByText('Thinking')).not.toBeInTheDocument()
  expect(container.querySelectorAll('[data-slot="spinner"]')).toHaveLength(1)
})

test('stopping takes precedence over the running activity', () => {
  renderComposerActivity({
    connection: { kind: 'live' },
    pendingAction: 'stopping',
    session: session(),
  })

  expect(screen.getByText('Stopping…')).toBeVisible()
  expect(screen.queryByText('Thinking')).not.toBeInTheDocument()
})

test('ordinary live activity leaves the composer free of a second progress line', () => {
  const { container } = renderComposerActivity({
    connection: { kind: 'live' },
    pendingAction: null,
    session: session(),
  })

  expect(container.querySelector('[data-composer-activity]')).toBeNull()
})
