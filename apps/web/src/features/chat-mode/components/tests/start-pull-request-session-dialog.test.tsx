import { act, screen, waitFor } from '@testing-library/react'
import { StartPullRequestSessionDialog } from '@/features/chat-mode/components/start-pull-request-session-dialog'
import { registerEnvironmentQueryClient } from '@/lib/environments/state/query-clients'
import { activeServerOrigin } from '@/lib/client'
import { providerQueryKeys } from '@/lib/query-keys'
import { expect, test } from '../../../../../test/fixtures'
import { createObservedInProcessClient } from '../../../../../test/client'
import { createRailHarness } from '../../../../../test/factories/rail-harness'
import { renderWithProviders } from '../../../../../test/render'

test('provider discovery shows pending before an empty provider verdict', async ({
  client,
  server,
}) => {
  const harness = await createRailHarness(client, server)
  const queryClient = harness.application.getSnapshot().queryClient
  queryClient.removeQueries({ queryKey: providerQueryKeys.all })
  const barrier = Promise.withResolvers<void>()
  const observed = createObservedInProcessClient(server, async (request) => {
    if (new URL(request.url).pathname === '/providers') await barrier.promise
  })
  registerEnvironmentQueryClient(queryClient, activeServerOrigin(), observed)
  const rendered = renderWithProviders(
    <StartPullRequestSessionDialog
      open
      rootPath={harness.context.worktree!.path}
      onOpenChange={() => {}}
    />,
    {
      application: harness.application,
      queryClient,
    },
  )
  try {
    await screen.findByRole('dialog')
    expect(screen.queryByText('No provider is ready to run the session.')).toBeNull()
    expect(screen.getByRole('status')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Start' })).toBeDisabled()
    await act(async () => barrier.resolve())
    await waitFor(() =>
      expect(queryClient.isFetching({ queryKey: providerQueryKeys.list() })).toBe(0),
    )
  } finally {
    barrier.resolve()
    rendered.unmount()
  }
})
