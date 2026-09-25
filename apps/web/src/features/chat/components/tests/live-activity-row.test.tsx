import { screen, within } from '@testing-library/react'

import { LiveActivityRow } from '@/features/chat/components/live-activity-row'
import { workLogEntry } from '../../../../../test/factories/work-log'
import { expect, test } from '../../../../../test/fixtures'
import { renderWithProviders } from '../../../../../test/render'

test('the live header says Working with the current step, over a tail of the newest calls', () => {
  const tail = ['one', 'two', 'three'].map((id) =>
    workLogEntry({ command: `echo ${id}`, id, outcome: 'succeeded' }),
  )
  renderWithProviders(
    <LiveActivityRow
      activity={{ active: true, activities: tail, entry: null, label: 'Running bun', tail }}
      groupId='live'
    />,
  )

  expect(screen.getByText('Working…')).toBeInTheDocument()
  expect(screen.getByRole('status')).toHaveTextContent('Running bun')
  const list = screen.getByRole('list', { name: 'Latest tool calls' })
  expect(
    within(list)
      .getAllByRole('listitem')
      .map((row) => row.textContent),
  ).toEqual(['echo one', 'echo two', 'echo three'])
})

test('a waiting turn keeps its own words', () => {
  renderWithProviders(
    <LiveActivityRow
      activity={{
        active: false,
        activities: [],
        entry: null,
        label: 'Waiting for approval',
        tail: [],
      }}
      groupId='live'
    />,
  )

  expect(screen.queryByText('Working…')).not.toBeInTheDocument()
  expect(screen.getByRole('status')).toHaveTextContent('Waiting for approval')
  expect(screen.queryByRole('list')).not.toBeInTheDocument()
})
