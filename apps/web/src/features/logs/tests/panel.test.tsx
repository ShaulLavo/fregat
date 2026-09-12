import { act, screen, waitFor } from '@testing-library/react'
import { createError } from 'evlog'

import { LogsPanel } from '@/features/logs/components/panel'
import { logsKeys } from '@/features/logs/utils/query-keys'
import { expect, test } from '../../../../test/fixtures'
import { renderWithProviders } from '../../../../test/render'

test.each(['summary', 'events', 'both'])(
  'renders one logs error banner when %s queries fail',
  async (failedQuery) => {
    const { queryClient } = renderWithProviders(<LogsPanel active={false} />)
    const queries = queryClient.getQueryCache().findAll({ queryKey: logsKeys.all })
    expect(queries.some((query) => query.queryKey[1] === 'events')).toBe(true)
    expect(queries.some((query) => query.queryKey[1] === 'summary')).toBe(true)

    act(() => {
      for (const query of queries) {
        if (failedQuery !== 'both' && query.queryKey[1] !== failedQuery) continue
        query.setState({ error: createError('Logs unavailable'), status: 'error' })
      }
    })

    await waitFor(() => {
      expect(screen.getAllByText('Could not read local logs.')).toHaveLength(1)
    })
  },
)

test('shows loading before declaring an empty log result', async () => {
  const { queryClient } = renderWithProviders(<LogsPanel active={false} />)
  expect(screen.getByRole('status', { name: 'Loading logs' })).toBeVisible()
  expect(screen.queryByText('No logs match the current filters.')).toBeNull()

  act(() => {
    queryClient.setQueriesData(
      { queryKey: [...logsKeys.all, 'events'] },
      { detailsById: {}, events: [], nextCursor: null, total: 0 },
    )
  })

  await waitFor(() => {
    expect(screen.queryByRole('status', { name: 'Loading logs' })).toBeNull()
    expect(screen.getByRole('status')).toHaveTextContent('No logs match the current filters.')
  })
})
