import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { useCreatePullRequestMutation } from '@/features/git/hooks/use-create-pull-request-mutation'
import { useLatestFailure } from '@/features/git/hooks/use-latest-failure'
import { expect, test } from '../../../../test/fixtures'
import { renderWithProviders } from '../../../../test/render'

const PROJECT = 'repo'
const WORKTREE = 'repo/.worktrees/one'

// A chat session runs its git commands in its own worktree. The mutation cache is
// shared, so the project's git panel used to adopt the session's failures — and
// kept showing them after the project was switched.
test('a failure in a session worktree stays out of the project git panel', async ({
  client,
  server,
}) => {
  void client
  void server

  renderWithProviders(<Harness />)
  await userEvent.click(screen.getByRole('button', { name: 'Open pull request' }))

  await waitFor(() =>
    expect(screen.getByTestId(`failure-${WORKTREE}`)).toHaveTextContent('create-pull-request'),
  )
  expect(screen.getByTestId(`failure-${PROJECT}`)).toHaveTextContent('none')
})

function Harness() {
  const createPullRequest = useCreatePullRequestMutation(WORKTREE)

  return (
    <>
      <button onClick={() => createPullRequest.mutate({ title: 'Add login' })} type='button'>
        Open pull request
      </button>
      <Probe rootPath={PROJECT} />
      <Probe rootPath={WORKTREE} />
    </>
  )
}

function Probe({ rootPath }: { readonly rootPath: string }) {
  const failure = useLatestFailure(rootPath)

  return <span data-testid={`failure-${rootPath}`}>{failure?.operation ?? 'none'}</span>
}
