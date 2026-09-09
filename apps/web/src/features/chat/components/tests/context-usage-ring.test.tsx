import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { ContextUsageRing } from '@/features/chat/components/context-usage-ring'
import type { ContextUsage } from '@workspace/client-core/chat/context-usage'
import { expect, test } from '../../../../../test/fixtures'
import { renderWithProviders } from '../../../../../test/render'

function usage(overrides: Partial<ContextUsage> = {}): ContextUsage {
  return {
    compactsAutomatically: false,
    maxTokens: 200_000,
    ratio: 0.25,
    totalProcessedTokens: null,
    usedTokens: 50_000,
    ...overrides,
  }
}

test('a reported window shows the share of it that is gone', () => {
  renderWithProviders(<ContextUsageRing usage={usage()} />)

  expect(screen.getByRole('button', { name: 'Context 25% full' })).toHaveTextContent('25%')
})

test('a provider that reports no window size still gets a gauge', async () => {
  renderWithProviders(<ContextUsageRing usage={usage({ maxTokens: null, ratio: null })} />)

  // The count is what is actually known, so that is what the gauge says instead
  // of a percentage of nothing — and instead of disappearing.
  const trigger = screen.getByRole('button', {
    name: 'Context 50k tokens used, window size unknown',
  })
  expect(trigger).toHaveTextContent('50k')

  await userEvent.click(trigger)
  expect(await screen.findByText(/did not report a window size/)).toBeVisible()
  expect(await screen.findByText('50k used')).toBeVisible()
})

test('the breakdown is a popover the keyboard can reach, not a title string', async () => {
  renderWithProviders(
    <ContextUsageRing
      usage={usage({ compactsAutomatically: true, totalProcessedTokens: 1_200_000 })}
    />,
  )

  await userEvent.click(screen.getByRole('button', { name: 'Context 25% full' }))

  expect(await screen.findByText('50k / 200k')).toBeVisible()
  expect(await screen.findByText('1.2M')).toBeVisible()
  expect(await screen.findByText(/compacts the context on its own/)).toBeVisible()
})

test('the narrow composer keeps the ring and drops the readout', () => {
  renderWithProviders(<ContextUsageRing compact usage={usage()} />)

  expect(screen.getByRole('button', { name: 'Context 25% full' })).not.toHaveTextContent('25%')
})
