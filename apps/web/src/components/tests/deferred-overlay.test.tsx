import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { queryOptions } from '@tanstack/react-query'

import { DeferredOverlay } from '@/components/deferred-overlay'
import { DeferredSessionDialogs } from '@/components/deferred-session-dialogs'
import { overlayQueryKeys } from '@/components/utils/query-keys'
import { useSessionSnoozeRequestStore } from '@/features/chat-mode/state/session-snooze-request-store'
import { resourceQueryClient } from '@/lib/resources/state/query-client'
import { expect, test } from '../../../test/fixtures'
import { holdDeferredDialog, renderWithProviders } from '../../../test/render'

test('an overlay opened before its code arrives shows a loading dialog, then the overlay', async () => {
  const release = holdDeferredDialog(
    overlayQueryKeys.sessionDialogs,
    () => import('@/components/session-dialogs'),
  )
  renderWithProviders(<DeferredSessionDialogs />)
  expect(screen.queryByRole('dialog')).toBeNull()

  act(() =>
    useSessionSnoozeRequestStore.getState().requestSnooze({ refs: [], title: 'First session' }),
  )
  expect(await screen.findByRole('dialog', { name: 'session dialog' })).toBeVisible()
  expect(screen.getByRole('status', { name: 'Loading session dialog' })).toBeVisible()

  release()
  expect(await screen.findByRole('button', { name: /In 1 hour/ })).toBeVisible()
  expect(screen.queryByRole('status', { name: 'Loading session dialog' })).toBeNull()
  act(() => useSessionSnoozeRequestStore.getState().dismiss())
})

test('a failed download offers Try again, and closing the dialog closes the overlay', async () => {
  const queryKey = ['test', 'deferred-overlay', crypto.randomUUID()] as const
  let attempts = 0
  const module = queryOptions({
    queryKey,
    queryFn: async () => {
      attempts += 1
      if (attempts === 1) throw new TypeError('Failed to fetch dynamically imported module')
      return { View: () => <p>Loaded overlay</p> }
    },
    retry: false,
    staleTime: 'static',
  })
  let closed = 0
  renderWithProviders(
    <DeferredOverlay label='test overlay' module={module} open onClose={() => (closed += 1)}>
      {({ View }) => <View />}
    </DeferredOverlay>,
  )
  const retry = await screen.findByRole('button', { name: 'Try again' })
  await userEvent.keyboard('{Escape}')
  await waitFor(() => expect(closed).toBe(1))
  await userEvent.click(retry)
  expect(await screen.findByText('Loaded overlay')).toBeVisible()
  expect(attempts).toBe(2)
  resourceQueryClient.removeQueries({ exact: true, queryKey })
})
