import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { ReasoningRow } from '@/features/chat/components/reasoning-row'
import { useChatWorkLogExpansionStore } from '@/features/chat/state/chat-work-log-expansion-store'
import { TestEditorStateProvider } from '../../../../../test/factories/editor-state-provider'
import { workLogEntry as entry } from '../../../../../test/factories/work-log'
import { expect, test } from '../../../../../test/fixtures'
import { renderWithProviders } from '../../../../../test/render'

const reasoning =
  'The gutter needs a solid background matching the editor while the surrounding pane keeps its own transparency.'

function reasoningEntry() {
  return entry({
    createdAt: '2026-05-28T00:00:00.000Z',
    icon: 'thinking',
    id: 'reasoning-full',
    lastActivityAt: '2026-05-28T00:00:12.000Z',
    reasoning: true,
    sourceKind: 'task.progress',
    title: reasoning,
    tone: 'thinking',
  })
}

function renderRow(streaming: boolean) {
  return renderWithProviders(
    <TestEditorStateProvider>
      <ReasoningRow entry={reasoningEntry()} streaming={streaming} />
    </TestEditorStateProvider>,
  )
}

function resetExpansion() {
  useChatWorkLogExpansionStore.setState({ expandedRowIds: {} })
}

test('reasoning in mixed history starts folded and opens on click', async () => {
  resetExpansion()
  renderRow(false)

  expect(screen.queryByRole('region', { name: 'Reasoning' })).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Thought' }))
  expect(screen.getByRole('region', { name: 'Reasoning' })).toHaveTextContent(reasoning)
})

test('streaming reasoning respects the reader expansion after it settles', async () => {
  resetExpansion()
  const view = renderRow(true)
  const toggle = screen.getByRole('button', { name: 'Thinking' })
  expect(toggle).toHaveAttribute('aria-expanded', 'false')
  await userEvent.click(toggle)
  expect(screen.getByRole('region', { name: 'Reasoning' })).toHaveTextContent(reasoning)
  view.unmount()
  renderRow(false)
  expect(screen.getByRole('button', { name: 'Thought' })).toHaveAttribute('aria-expanded', 'true')
})

test('a reasoning-only history shows the text without a second disclosure', () => {
  resetExpansion()
  renderWithProviders(
    <TestEditorStateProvider>
      <ReasoningRow entry={reasoningEntry()} streaming showHeader={false} />
    </TestEditorStateProvider>,
  )
  expect(screen.queryByRole('button')).not.toBeInTheDocument()
  expect(screen.getByRole('region', { name: 'Reasoning' })).toHaveTextContent(reasoning)
})
