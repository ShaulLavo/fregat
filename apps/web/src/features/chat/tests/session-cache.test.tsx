import { screen, within } from '@testing-library/react'
import { expect, test } from '../../../../test/fixtures'
import { recordSessionCacheFixture } from '../../../../test/factories/session-cache'
import { renderWithProviders } from '../../../../test/render'
import { SessionUsageTotal } from '@/features/chat/components/session-usage-total'

test('session cache details read recorded counters through the real session route', async ({
  server,
  client,
}) => {
  expect(client).toBeDefined()
  const ref = recordSessionCacheFixture(server, { readTokens: 60, writeTokens: 40 })
  const view = renderWithProviders(<SessionUsageTotal sessionRef={ref} />)
  try {
    const region = await screen.findByRole('region', { name: 'Recent prompt cache' })
    expect(within(region).getByText('1 turn', { exact: true })).toBeInTheDocument()
    expect(region.querySelectorAll('dd')).toHaveLength(3)
    expect(Array.from(region.querySelectorAll('dd'), (cell) => cell.textContent)).toEqual([
      '60',
      '40',
      '40%',
    ])
    expect(region).toHaveTextContent('40% of reported cache reads and writes')
    expect(region.querySelector('time')).toHaveAttribute('datetime', '2026-09-25T06:00:00.000Z')
    expect(region.querySelector('time')).toHaveAttribute(
      'title',
      expect.stringContaining('Started unknown'),
    )
    expect(region).not.toHaveTextContent('rebuild')
  } finally {
    view.unmount()
  }
})

test('a missing cache write counter remains unknown on the session surface', async ({
  server,
  client,
}) => {
  expect(client).toBeDefined()
  const ref = recordSessionCacheFixture(server, { readTokens: 60, writeTokens: null })
  const view = renderWithProviders(<SessionUsageTotal sessionRef={ref} />)
  try {
    const region = await screen.findByRole('region', { name: 'Recent prompt cache' })
    expect(Array.from(region.querySelectorAll('dd'), (cell) => cell.textContent)).toEqual([
      '60',
      'Unknown',
      '—',
    ])
    expect(region).toHaveTextContent('Cache write share unknown.')
    expect(region).not.toHaveTextContent('0%')
  } finally {
    view.unmount()
  }
})
