import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { ChatInputTerminalContextList } from '@/features/chat/components/chat-input-terminal-context-list'
import type { ChatInputTerminalContext } from '@/features/chat/state/chat-input-draft-store'
import { expect, test } from '../../../../../test/fixtures'
import { renderWithProviders } from '../../../../../test/render'

function staged(id: string, text: string): ChatInputTerminalContext {
  return { id, lineEnd: 812, lineStart: 810, source: 'terminal-1', text }
}

test('nothing captured renders no strip at all', () => {
  renderWithProviders(
    <div data-testid='context-list'>
      <ChatInputTerminalContextList contexts={[]} disabled={false} onRemove={() => undefined} />
    </div>,
  )

  expect(screen.getByTestId('context-list')).toBeEmptyDOMElement()
})

test('a staged capture shows which terminal and which lines it came from', () => {
  renderWithProviders(
    <ChatInputTerminalContextList
      contexts={[staged('context-1', 'make: *** [build] Error 1')]}
      disabled={false}
      onRemove={() => undefined}
    />,
  )

  expect(screen.getByText('terminal-1')).toBeInTheDocument()
  expect(screen.getByText('lines 810-812')).toBeInTheDocument()
  expect(screen.getByText('make: *** [build] Error 1')).toBeInTheDocument()
})

test('a capture can be taken back off the message before it is sent', async () => {
  const removed: string[] = []
  const user = userEvent.setup()
  renderWithProviders(
    <ChatInputTerminalContextList
      contexts={[staged('context-1', 'boom')]}
      disabled={false}
      onRemove={(id) => removed.push(id)}
    />,
  )

  await user.click(screen.getByRole('button', { name: 'Remove terminal-1 lines 810-812' }))

  expect(removed).toEqual(['context-1'])
})

test('a disabled composer cannot drop its captures', () => {
  renderWithProviders(
    <ChatInputTerminalContextList
      contexts={[staged('context-1', 'boom')]}
      disabled
      onRemove={() => undefined}
    />,
  )

  expect(screen.getByRole('button', { name: 'Remove terminal-1 lines 810-812' })).toHaveAttribute(
    'aria-disabled',
    'true',
  )
})
