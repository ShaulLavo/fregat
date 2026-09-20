import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { ActivityRow } from '@/features/chat/components/activity-row'
import { ActivityGroupRow } from '@/features/chat/components/activity-group-row'
import { chatWorkLogEntries } from '@/features/chat/utils/work-log'
import { useChatWorkLogExpansionStore } from '@/features/chat/state/chat-work-log-expansion-store'
import { sessionActivity } from '../../../../../test/factories/chat'
import { workLogEntry as entry } from '../../../../../test/factories/work-log'
import { expect, test } from '../../../../../test/fixtures'
import { renderWithProviders } from '../../../../../test/render'

test('tool groups collapse to a useful summary and open on click', async () => {
  resetExpansion()
  renderWithProviders(
    <ActivityGroupRow
      activities={[
        entry({
          itemType: 'command_execution',
          id: 'one',
          title: 'First command',
          outcome: 'succeeded',
        }),
        entry({
          itemType: 'command_execution',
          id: 'two',
          title: 'Second command',
          outcome: 'succeeded',
        }),
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
    <ActivityRow
      activity={entry({
        id: 'ok',
        lifecycle: 'completed',
        outcome: 'succeeded',
        title: 'Command run',
      })}
    />,
  )

  expect(screen.getByLabelText('Succeeded')).toBeInTheDocument()
  expect(screen.queryByLabelText('Failed')).not.toBeInTheDocument()
  unmount()

  renderWithProviders(
    <ActivityRow
      activity={entry({
        id: 'broken',
        lifecycle: 'failed',
        outcome: 'failed',
        output: 'cat: missing.txt: No such file or directory',
        title: 'Command run',
      })}
    />,
  )

  expect(screen.getByLabelText('Failed')).toBeInTheDocument()
  expect(screen.getByText('Failed command')).not.toHaveClass('text-destructive')
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

function resetExpansion() {
  useChatWorkLogExpansionStore.setState({ expandedGroupIds: {}, expandedRowIds: {} })
}

test('a native no-match search finishes without failure styling', async () => {
  resetExpansion()
  const [activity] = chatWorkLogEntries({
    activities: [
      sessionActivity({
        kind: 'tool.completed',
        tone: 'tool',
        payload: {
          itemType: 'command_execution',
          toolCallId: 'no-match-search',
          status: 'failed',
          data: {
            command: 'rg absent existing.txt',
            status: 'failed',
            exitCode: 1,
            aggregatedOutput: '',
          },
        },
      }),
    ],
  })
  expect(activity).toMatchObject({ outcome: 'neutral', lifecycle: 'completed' })
  renderWithProviders(<ActivityRow activity={activity!} />)
  expect(screen.queryByLabelText('Failed')).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'rg absent existing.txt' }))
  expect(screen.getByLabelText('Result')).toHaveTextContent('No matches · Exit code 1')
})

test('a reasoning summary can be expanded to read the entire text', async () => {
  resetExpansion()
  const reasoning =
    'The gutter needs a solid background matching the editor while the surrounding pane keeps its own transparency.'
  renderWithProviders(
    <ActivityRow
      activity={entry({
        id: 'reasoning-full',
        sourceKind: 'task.progress',
        icon: 'thinking',
        tone: 'thinking',
        title: reasoning,
      })}
    />,
  )
  expect(screen.queryByLabelText('Reasoning')).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: reasoning }))
  expect(screen.getByLabelText('Reasoning')).toHaveTextContent(reasoning)
})

test('historical commands show their actual invocation and an expandable process result', async () => {
  resetExpansion()
  renderWithProviders(
    <ActivityRow
      activity={entry({
        command: 'rg missing src; true',
        lifecycle: 'failed',
        outcome: 'failed',
        result: 'Exit code 0\nrg: missing: No such file or directory',
      })}
    />,
  )
  await userEvent.click(
    screen.getByRole('button', { name: 'rg missing src; true, tool call failed' }),
  )
  expect(screen.getByLabelText('Result')).toHaveTextContent('Exit code 0')
  expect(screen.getByLabelText('Result')).toHaveTextContent('No such file or directory')
})

test('native answer history preserves question order, nested choices and file references', async () => {
  resetExpansion()
  const activity = sessionActivity({
    kind: 'user-input.answer-submitted',
    summary: 'Answers submitted',
    payload: {
      requestId: 'native-question',
      answers: { scope: { answers: ['Repository', 'Tests'] }, details: 'Use the attached spec.' },
      questionTextById: {
        scope: 'Which scope?',
        details: 'Any constraints?',
        file: 'Provide a spec',
      },
      attachmentsByQuestionId: {
        file: [
          {
            type: 'file',
            id: 'history-file',
            name: 'spec.pdf',
            mimeType: 'application/pdf',
            sizeBytes: 40,
          },
        ],
      },
      detail: 'Answers recorded',
    },
  })
  const row = chatWorkLogEntries({ activities: [activity] })[0]!
  renderWithProviders(<ActivityRow activity={row} />)
  expect(screen.queryByText('Which scope?')).toBeNull()
  await userEvent.click(screen.getByRole('button', { name: 'Answers submitted' }))
  expect(screen.getByText('Repository, Tests')).toBeVisible()
  expect(screen.getByText('Use the attached spec.')).toBeVisible()
  expect(screen.getByText('Provide a spec')).toBeVisible()
  await userEvent.click(screen.getByRole('button', { name: 'spec.pdf' }))
  expect(screen.getByRole('dialog', { name: 'spec.pdf' })).toBeVisible()
  expect(screen.getByRole('link', { name: 'Download spec.pdf' })).toHaveAttribute(
    'download',
    'spec.pdf',
  )
})
