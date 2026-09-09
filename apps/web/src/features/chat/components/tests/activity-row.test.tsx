import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { ActivityRow } from '@/features/chat/components/activity-row'
import { ActivityGroupRow } from '@/features/chat/components/activity-group-row'
import type { ChatWorkLogEntry } from '@/features/chat/utils/work-log'
import { useChatWorkLogExpansionStore } from '@/features/chat/state/chat-work-log-expansion-store'
import { sessionActivity } from '../../../../../test/factories/chat'
import { expect, test } from '../../../../../test/fixtures'
import { renderWithProviders } from '../../../../../test/render'

test('the tool spinner stops when its turn settles or is no longer current', () => {
  resetExpansion()
  const turnId = sessionActivity().turnId
  const activities = [entry({ outcome: 'neutral', status: 'Started', turnId })]
  const { rerender } = renderWithProviders(
    <ActivityGroupRow activities={activities} activeTurnId={turnId} />,
  )

  expect(screen.getByLabelText('Tool running')).toBeInTheDocument()
  rerender(<ActivityGroupRow activities={activities} activeTurnId={null} />)
  expect(screen.queryByLabelText('Tool running')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Ran 1 command' })).toBeInTheDocument()

  rerender(
    <ActivityGroupRow
      activities={[entry({ outcome: 'neutral', status: 'Started', turnId: null })]}
      activeTurnId={turnId}
    />,
  )
  expect(screen.queryByLabelText('Tool running')).not.toBeInTheDocument()
})

test('tool groups collapse to a useful summary and open on click', async () => {
  resetExpansion()
  renderWithProviders(
    <ActivityGroupRow
      activeTurnId={null}
      activities={[
        entry({ id: 'one', title: 'First command', outcome: 'succeeded' }),
        entry({ id: 'two', title: 'Second command', outcome: 'succeeded' }),
      ]}
    />,
  )

  expect(screen.queryByText('First command')).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Ran 2 commands' }))
  expect(screen.getByText('First command')).toBeInTheDocument()
  expect(screen.getByText('Second command')).toBeInTheDocument()
})

test('a collapsed group keeps failed calls visible after a later success', () => {
  resetExpansion()
  renderWithProviders(
    <ActivityGroupRow
      activeTurnId={null}
      activities={[
        entry({ id: 'failed', title: 'Failed command', outcome: 'failed' }),
        entry({ id: 'ok', title: 'Successful command', outcome: 'succeeded' }),
      ]}
    />,
  )

  expect(screen.getByText('Failed command')).toBeInTheDocument()
  expect(screen.getByLabelText('Failed')).toBeInTheDocument()
  expect(screen.queryByText('Successful command')).not.toBeInTheDocument()
})

test('expanded MCP rows expose their arguments and full detail', async () => {
  resetExpansion()
  renderWithProviders(
    <ActivityRow
      activity={entry({
        title: 'linear · get_issue',
        detail: 'Retrieving ENG-12',
        input: '{"id":"ENG-12"}',
        output: 'Issue found',
      })}
    />,
  )

  await userEvent.click(screen.getByRole('button'))
  expect(screen.getByLabelText('Input')).toHaveTextContent('{"id":"ENG-12"}')
  expect(screen.getByLabelText('Details')).toHaveTextContent('Retrieving ENG-12')
  expect(screen.getByLabelText('Output')).toHaveTextContent('Issue found')
})

test('a failed tool call is distinguishable from a successful one', () => {
  const { unmount } = renderWithProviders(
    <ActivityRow activity={entry({ id: 'ok', outcome: 'succeeded', title: 'Command run' })} />,
  )

  expect(screen.getByLabelText('Succeeded')).toBeInTheDocument()
  expect(screen.queryByLabelText('Failed')).not.toBeInTheDocument()
  unmount()

  renderWithProviders(
    <ActivityRow
      activity={entry({
        id: 'broken',
        outcome: 'failed',
        output: 'cat: missing.txt: No such file or directory',
        title: 'Command run',
      })}
    />,
  )

  expect(screen.getByLabelText('Failed')).toBeInTheDocument()
  expect(screen.getByText('Command run')).toHaveClass('text-destructive')
})

test('expanding a row reveals its raw command, output and changed files', async () => {
  resetExpansion()
  renderWithProviders(
    <ActivityRow
      activity={entry({
        changedFiles: ['src/a.ts'],
        command: 'bun test --filter chat',
        output: '12 passed',
      })}
    />,
  )

  expect(screen.queryByLabelText('Command')).not.toBeInTheDocument()

  await userEvent.click(screen.getByRole('button'))

  expect(screen.getByLabelText('Command')).toHaveTextContent('bun test --filter chat')
  expect(screen.getByLabelText('Output')).toHaveTextContent('12 passed')
  expect(screen.getByLabelText('Changed files')).toHaveTextContent('src/a.ts')
})

test('expansion survives the row unmounting', async () => {
  resetExpansion()
  const activity = entry({ command: 'bun test', output: '12 passed' })
  const { unmount } = renderWithProviders(<ActivityRow activity={activity} />)

  await userEvent.click(screen.getByRole('button'))
  expect(screen.getByLabelText('Command')).toBeInTheDocument()

  unmount()
  renderWithProviders(<ActivityRow activity={activity} />)

  expect(screen.getByLabelText('Command')).toHaveTextContent('bun test')
})

test('a plan row renders every step and marks the one in progress', () => {
  resetExpansion()
  renderWithProviders(
    <ActivityRow
      activity={entry({
        icon: 'task',
        id: 'turn-plan:turn-1',
        plan: {
          completedCount: 1,
          currentStep: 'Write the test',
          steps: [
            { status: 'completed', step: 'Read the code' },
            { status: 'inProgress', step: 'Write the test' },
            { status: 'pending', step: 'Ship it' },
          ],
        },
        title: 'Plan updated',
        tone: 'info',
      })}
    />,
  )

  expect(screen.getByText('Read the code')).toBeInTheDocument()
  expect(screen.getByText('Ship it')).toBeInTheDocument()
  expect(screen.getByText('Write the test')).toHaveClass('text-foreground/85')
  expect(screen.getByLabelText('Plan progress')).toHaveTextContent('Plan 1/3')
})

function resetExpansion() {
  useChatWorkLogExpansionStore.setState({ expandedGroupIds: {}, expandedRowIds: {} })
}

function entry(overrides: Partial<ChatWorkLogEntry> = {}): ChatWorkLogEntry {
  return {
    changedFiles: [],
    command: null,
    createdAt: '2026-05-28T00:00:00.000Z',
    detail: null,
    icon: 'tool',
    id: 'activity-1',
    input: null,
    itemType: 'command_execution',
    outcome: null,
    output: null,
    plan: null,
    status: 'Completed',
    title: 'Command run',
    tone: 'tool',
    turnId: null,
    ...overrides,
  }
}
