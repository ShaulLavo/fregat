import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { ChatRuntimeStatus } from '@/features/chat/components/chat-runtime-status'
import { providerListQueryOptions } from '@/lib/provider-query'
import { ChatProviderSignInProvider } from '@/features/chat/providers/provider-sign-in-provider'
import type { ChatSession } from '@workspace/client-core/chat/types'
import { providerSnapshot, session } from '../../../../../test/factories/chat'
import { expect, test } from '../../../../../test/fixtures'
import { createTestQueryClient, renderWithProviders } from '../../../../../test/render'

test('pending requests do not produce duplicate runtime banners', () => {
  renderStatus({ session: session({ pendingApprovalCount: 2, pendingUserInputCount: 1 }) })

  expect(screen.queryByRole('status', { name: 'Runtime notices' })).toBeNull()
})

test('a dismissed failure stays dismissed while nothing about it has changed', async () => {
  const { rerender } = renderStatus({
    commandFailure: 'Dispatch rejected',
    session: session({ pendingApprovalCount: 0 }),
  })

  await userEvent.click(await screen.findByRole('button', { name: 'Dismiss Command failed' }))
  expect(screen.queryByText('Dispatch rejected')).toBeNull()

  // The same failure re-rendered is the same failure: nothing has happened that
  // the user has not already read and put away.
  rerender('Dispatch rejected')
  expect(screen.queryByText('Dispatch rejected')).toBeNull()

  // A different failure is news, and comes back on its own.
  rerender('Worktree is locked')
  expect(await screen.findByText('Worktree is locked')).toBeVisible()
})

function renderStatus({
  commandFailure = null,
  session: chatSession = session({ pendingApprovalCount: 1 }),
}: {
  commandFailure?: string | null
  session?: ChatSession
} = {}) {
  const queryClient = createTestQueryClient()
  queryClient.setQueryData(providerListQueryOptions().queryKey, {
    providers: [providerSnapshot()],
  })

  function statusTree(commandFailure: string | null) {
    return (
      <ChatProviderSignInProvider>
        <ChatRuntimeStatus commandFailure={commandFailure} session={chatSession} />
      </ChatProviderSignInProvider>
    )
  }

  const view = renderWithProviders(statusTree(commandFailure), { queryClient })

  return {
    rerender(commandFailure: string | null) {
      view.rerender(statusTree(commandFailure))
    },
  }
}
