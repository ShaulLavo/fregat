import type { GitPullRequestState } from '@workspace/contracts'
import { gitKeys } from '@/lib/query-keys'
import { usePushRemoteMutation } from '@/features/git/hooks/use-push-remote-mutation'
import { usePushAndOpenPullRequestMutation } from '@/features/git/hooks/use-push-and-open-pull-request-mutation'
import { registerEnvironmentQueryClient } from '@/lib/environments/state/query-clients'
import { activeServerOrigin } from '@/lib/client'
import { createObservedInProcessClient } from '../../../../../test/client'
import { PublishRepositoryDialog } from '@/features/git/components/publish-repository-dialog'
import { mutationKeys } from '@/features/git/utils/mutation-keys'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { BranchActions } from '@/features/git/components/branch-actions'
import { expect, test } from '../../../../../test/fixtures'
import {
  createTestQueryClient,
  renderHookWithProviders,
  renderWithProviders,
} from '../../../../../test/render'
import { runGit } from '../../../../../test/factories/git'

// Real git and the real route. These fixtures' origin is a local directory, so
// no forge is detected and the component must not offer Create.

test('offers to publish a branch that has no upstream, and pushes it', async ({
  client,
  server,
}) => {
  void client
  const { origin, repo } = await clonedRepo(server.root)
  runGit(repo, ['checkout', '-b', 'feature/login'], { cwdMode: 'option' })

  renderWithProviders(<BranchActions pullRequestTitle='Add login' rootPath='repo' />)

  // Nothing is ahead, and publishing is still the thing to offer: a plain push
  // fails on a branch with no upstream, which is every branch a session makes.
  await userEvent.click(await screen.findByRole('button', { name: 'Push branch' }))

  await waitFor(
    () => {
      expect(
        runGit(origin, ['branch', '--format', '%(refname:short)'], { cwdMode: 'option' }).stdout,
      ).toContain('feature/login')
    },
    { timeout: 10_000 },
  )
})

test('never offers a pull request when no forge could be asked', async ({ client, server }) => {
  void client
  const { repo } = await clonedRepo(server.root)
  await writeFile(path.join(repo, 'readme.md'), 'two\n')
  runGit(repo, ['commit', '-am', 'edit'], { cwdMode: 'option' })

  renderWithProviders(<BranchActions pullRequestTitle='Add login' rootPath='repo' />)

  // The push button proves the state actually arrived, so the missing Create
  // button below is a decision rather than a component still loading.
  expect(await screen.findByRole('button', { name: /Push 1$/ })).toBeVisible()
  expect(screen.queryByRole('button', { name: 'Pull request' })).toBeNull()
})

async function clonedRepo(root: string) {
  const origin = path.join(root, 'origin.git')
  await mkdir(origin, { recursive: true })
  runGit(origin, ['init', '--bare', '-b', 'main'], { cwdMode: 'option' })

  const repo = path.join(root, 'repo')
  await mkdir(repo, { recursive: true })
  runGit(repo, ['init', '-b', 'main'], { cwdMode: 'option' })
  await writeFile(path.join(repo, 'readme.md'), 'one\n')
  runGit(repo, ['add', 'readme.md'], { cwdMode: 'option' })
  runGit(repo, ['commit', '-m', 'init'], { cwdMode: 'option' })
  runGit(repo, ['remote', 'add', 'origin', origin], { cwdMode: 'option' })
  runGit(repo, ['push', '-u', 'origin', 'main'], { cwdMode: 'option' })

  return { origin, repo }
}

test('a push-and-open mutation disables Push in every branch header', async ({
  client,
  server,
}) => {
  void client
  const { repo } = await clonedRepo(server.root)
  await writeFile(path.join(repo, 'readme.md'), 'two\n')
  runGit(repo, ['commit', '-am', 'edit'], { cwdMode: 'option' })
  const queryClient = createTestQueryClient()
  const barrier = Promise.withResolvers<void>()
  const operation = queryClient.getMutationCache().build(queryClient, {
    mutationKey: mutationKeys.pushAndOpenPullRequest('repo'),
    mutationFn: () => barrier.promise,
  })
  const executing = operation.execute(undefined)
  const rendered = renderWithProviders(<BranchActions pullRequestTitle='Edit' rootPath='repo' />, {
    queryClient,
  })
  try {
    expect(await screen.findByRole('button', { name: /Push 1$/ })).toBeDisabled()
    await act(async () => {
      barrier.resolve()
      await executing
    })
    await waitFor(() => expect(screen.getByRole('button', { name: /Push 1$/ })).toBeEnabled())
  } finally {
    barrier.resolve()
    await executing
    rendered.unmount()
  }
})

test('a second publish dialog observes the checkout publish already in flight', async () => {
  const queryClient = createTestQueryClient()
  const barrier = Promise.withResolvers<void>()
  const operation = queryClient.getMutationCache().build(queryClient, {
    mutationKey: mutationKeys.publish('repo'),
    mutationFn: () => barrier.promise,
  })
  const executing = operation.execute(undefined)
  const rendered = renderWithProviders(
    <PublishRepositoryDialog open rootPath='repo' onOpenChange={() => {}} />,
    { queryClient },
  )
  try {
    await userEvent.type(await screen.findByRole('textbox', { name: 'Repository' }), 'acme/repo')
    expect(screen.getByRole('button', { name: /Create and push$/ })).toBeDisabled()
    await act(async () => {
      barrier.resolve()
      await executing
    })
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Create and push' })).toBeEnabled(),
    )
  } finally {
    barrier.resolve()
    await executing
    rendered.unmount()
  }
})

test('push queues behind push-and-open for the same checkout', async ({ client, server }) => {
  void client
  await clonedRepo(server.root)
  const barrier = Promise.withResolvers<void>()
  const requests: string[] = []
  const observed = createObservedInProcessClient(server, async (request) => {
    const path = new URL(request.url).pathname
    if (path !== '/git/push' && path !== '/git/push-and-pull-request') return
    requests.push(path)
    if (path === '/git/push-and-pull-request') await barrier.promise
  })
  const queryClient = createTestQueryClient()
  registerEnvironmentQueryClient(queryClient, activeServerOrigin(), observed)
  const rendered = renderHookWithProviders(
    () => ({
      push: usePushRemoteMutation('repo'),
      ship: usePushAndOpenPullRequestMutation('repo', 'Pull request'),
    }),
    { queryClient },
  )
  const shipping = rendered.result.current.ship.mutateAsync({ title: 'Change' })
  let pushing: Promise<unknown> | undefined
  try {
    await waitFor(() => expect(requests).toEqual(['/git/push-and-pull-request']))
    pushing = rendered.result.current.push.mutateAsync()
    await waitFor(() => expect(rendered.result.current.push.isPaused).toBe(true))
    expect(requests).toEqual(['/git/push-and-pull-request'])
    await act(async () => {
      barrier.resolve()
      await shipping
      await pushing
    })
    expect(requests).toEqual(['/git/push-and-pull-request', '/git/push'])
  } finally {
    barrier.resolve()
    await shipping
    await pushing
    rendered.unmount()
  }
})

test('retains the previous worktree actions while the next worktree loads', async ({
  client,
  server,
}) => {
  void client
  const first = await clonedRepo(server.root)
  const second = await clonedRepo(path.join(server.root, 'second'))
  await writeFile(path.join(first.repo, 'readme.md'), 'two\n')
  runGit(first.repo, ['commit', '-am', 'ahead'], { cwdMode: 'option' })
  runGit(second.repo, ['checkout', '-b', 'new-branch'], { cwdMode: 'option' })
  const barrier = Promise.withResolvers<void>()
  const forgeBarrier = Promise.withResolvers<void>()
  const queryClient = createTestQueryClient()
  queryClient.setQueryData<GitPullRequestState>(gitKeys.pullRequestState('repo'), {
    branch: 'main',
    support: 'ready',
    forge: { kind: 'github', name: 'GitHub', host: 'github.com' },
    pullRequest: {
      number: 17,
      state: 'open',
      draft: false,
      title: 'First',
      url: 'https://github.com/fixture/repo/pull/17',
    },
  })
  const observed = createObservedInProcessClient(server, async (request) => {
    const url = new URL(request.url)
    if (url.pathname === '/git/pull-request' && url.searchParams.get('path') === 'second/repo')
      await forgeBarrier.promise
    if (
      url.pathname === '/git/branch-remote-state' &&
      url.searchParams.get('path') === 'second/repo'
    )
      await barrier.promise
  })
  registerEnvironmentQueryClient(queryClient, activeServerOrigin(), observed)
  const rendered = renderWithProviders(<BranchActions pullRequestTitle='First' rootPath='repo' />, {
    queryClient,
  })
  try {
    await screen.findByRole('button', { name: 'Push 1' })
    expect(screen.getByRole('link', { name: '#17' })).toHaveAttribute(
      'href',
      'https://github.com/fixture/repo/pull/17',
    )
    rendered.rerender(<BranchActions pullRequestTitle='Second' rootPath='second/repo' />)
    expect(screen.getByRole('button', { name: 'Push 1' })).toBeDisabled()
    expect(screen.getByRole('status', { name: 'Loading branch actions' })).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Push branch' })).toBeNull()
    await act(async () => {
      barrier.resolve()
    })
    await waitFor(() =>
      expect(queryClient.getQueryData(gitKeys.branchRemoteState('second/repo'))).toBeDefined(),
    )
    expect(screen.getByRole('button', { name: 'Push 1' })).toBeDisabled()
    expect(screen.getByRole('link', { name: '#17' })).toBeVisible()
    await act(async () => {
      forgeBarrier.resolve()
    })
    await screen.findByRole('button', { name: 'Push branch' })
    expect(screen.queryByRole('link', { name: '#17' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Push 1' })).toBeNull()
  } finally {
    barrier.resolve()
    forgeBarrier.resolve()
    rendered.unmount()
  }
})
