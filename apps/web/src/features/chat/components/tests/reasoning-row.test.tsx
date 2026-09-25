import { act, screen } from '@testing-library/react'
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
  useChatWorkLogExpansionStore.setState({ autoExpandedRowIds: {}, userExpandedRowIds: {} })
}

test('reasoning from history starts folded, says how long it took, and opens on click', async () => {
  resetExpansion()
  renderRow(false)

  expect(screen.queryByRole('region', { name: 'Reasoning' })).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Thought for 12s' }))
  expect(screen.getByRole('region', { name: 'Reasoning' })).toHaveTextContent(reasoning)
})

test('streaming reasoning says Thinking and shows what the automation opened', () => {
  resetExpansion()
  useChatWorkLogExpansionStore.setState({ autoExpandedRowIds: { 'reasoning-full': true } })
  renderRow(true)

  expect(screen.getByRole('button', { name: 'Thinking' })).toHaveAttribute('aria-expanded', 'true')
  expect(screen.getByRole('region', { name: 'Reasoning' })).toBeInTheDocument()
})

test('the reader toggle outranks the automation', async () => {
  resetExpansion()
  useChatWorkLogExpansionStore.setState({ autoExpandedRowIds: { 'reasoning-full': true } })
  renderRow(true)

  await userEvent.click(screen.getByRole('button', { name: 'Thinking' }))
  useChatWorkLogExpansionStore.getState().setAutoRowsExpanded(['reasoning-full'], true)
  expect(await screen.findByRole('button', { name: 'Thinking' })).toHaveAttribute(
    'aria-expanded',
    'false',
  )
})

test('two reader clicks in one render keep the reasoning open after automation settles', () => {
  resetExpansion()
  useChatWorkLogExpansionStore.setState({ autoExpandedRowIds: { 'reasoning-full': true } })
  renderRow(true)
  const toggle = screen.getByRole('button', { name: 'Thinking' })

  act(() => {
    toggle.click()
    toggle.click()
  })
  act(() => useChatWorkLogExpansionStore.getState().setAutoRowsExpanded(['reasoning-full'], false))

  expect(toggle).toHaveAttribute('aria-expanded', 'true')
  expect(screen.getByRole('region', { name: 'Reasoning' })).toBeInTheDocument()
})
