import { screen } from '@testing-library/react'

import userEvent from '@testing-library/user-event'
import { LiveActivityRow } from '@/features/chat/components/live-activity-row'
import { workLogEntry } from '../../../../../test/factories/work-log'
import { expect, test } from '../../../../../test/fixtures'
import { renderWithProviders } from '../../../../../test/render'

test('the current activity expands its history without duplicating recent calls', async () => {
  const activities = ['one', 'two', 'three'].map((id) =>
    workLogEntry({ command: `echo ${id}`, id, outcome: 'succeeded' }),
  )
  renderWithProviders(
    <LiveActivityRow
      activity={{ active: true, activities, entry: null, label: 'Running bun' }}
      groupId='live'
    />,
  )

  expect(screen.getByRole('status')).toHaveTextContent('Running bun')
  expect(screen.queryByText('echo one')).not.toBeInTheDocument()
  expect(screen.queryByRole('list')).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Running bun' }))
  expect(screen.getByRole('region', { name: 'Activity history' })).toHaveTextContent('echo one')
  expect(screen.getByText('echo three')).toBeInTheDocument()
})

test('a waiting turn keeps its own words', () => {
  renderWithProviders(
    <LiveActivityRow
      activity={{
        active: false,
        activities: [],
        entry: null,
        label: 'Waiting for approval',
      }}
      groupId='live'
    />,
  )

  expect(screen.queryByText('Working…')).not.toBeInTheDocument()
  expect(screen.getByRole('status')).toHaveTextContent('Waiting for approval')
  expect(screen.queryByRole('list')).not.toBeInTheDocument()
})
