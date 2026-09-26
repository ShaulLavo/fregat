import { act, screen, waitFor } from '@testing-library/react'
import { useSessionCheckoutRefresh } from '@/features/chat-mode/hooks/use-session-checkout-refresh'
import { useChatProjectionStore } from '@/features/chat/state/chat-projection-store'
import { gitKeys } from '@/lib/query-keys'
import { expect, test } from '../../../../../test/fixtures'
import { createRailHarness, renderInRailHarness } from '../../../../../test/factories/rail-harness'

function CheckoutRefresh() {
  useSessionCheckoutRefresh()
  return <span>Checkout refresh ready</span>
}

test('a session commit invalidates only that checkout and its file reads', async ({
  client,
  server,
}) => {
  const harness = await createRailHarness(client, server)
  const queryClient = harness.application.getSnapshot().queryClient
  const own = harness.context.worktree!.path
  const relevant = [
    gitKeys.status(own),
    gitKeys.branches(own),
    gitKeys.branchRemoteState(own),
    gitKeys.pullRequestState(own),
    gitKeys.diff(`${own}/a.ts`, false),
  ]
  const unrelated = [
    gitKeys.status('other'),
    gitKeys.pullRequestState('other'),
    gitKeys.diff('other/a.ts', false),
  ]
  for (const key of [...relevant, ...unrelated]) queryClient.setQueryData(key, { value: 'cached' })
  const rendered = renderInRailHarness(harness, <CheckoutRefresh />)
  await screen.findByText('Checkout refresh ready')
  const snapshot = await harness.refresh()
  await act(async () => {
    useChatProjectionStore.getState().syncShellSnapshot(harness.environmentId, {
      ...snapshot,
      snapshotSequence: snapshot.snapshotSequence + 1,
      worktrees: snapshot.worktrees.map((worktree) =>
        worktree.id === harness.worktreeId ? { ...worktree, headCommit: 'new-commit' } : worktree,
      ),
    })
  })
  await waitFor(() =>
    expect(queryClient.getQueryState(gitKeys.status(own))?.isInvalidated).toBe(true),
  )
  for (const key of relevant) expect(queryClient.getQueryState(key)?.isInvalidated).toBe(true)
  for (const key of unrelated) expect(queryClient.getQueryState(key)?.isInvalidated).toBe(false)
  rendered.unmount()
})
