import { screen, waitFor, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { writeFile } from 'node:fs/promises'
import { PullRequestDiscussion } from '@/features/git/components/pull-request-discussion'
import { useSubmitPullRequestReview } from '@/features/git/hooks/use-submit-pull-request-review'
import { usePostPullRequestComment } from '@/features/git/hooks/use-post-pull-request-comment'
import { pullRequestDiscussionKeys } from '@/features/git/utils/query-keys'
import { resourceQueryClient } from '@/lib/resources/state/query-client'
import { test as base, expect } from '../../../../../test/fixtures'
import { makeTestServer } from '../../../../../test/server'
import {
  renderWithProviders,
  renderHookWithProviders,
  createTestQueryClient,
} from '../../../../../test/render'
import { runGit } from '../../../../../test/factories/git'
import { createForgeDiscussionBoundary } from '../../../../../test/factories/forge'

const test = base.extend<{
  forge: ReturnType<typeof createForgeDiscussionBoundary>
  server: Awaited<ReturnType<typeof makeTestServer>>
}>({
  // eslint-disable-next-line no-empty-pattern -- Vitest fixtures require a destructured context.
  forge: async ({}, provide) => {
    await provide(createForgeDiscussionBoundary())
  },
  server: async ({ forge }, provide) => {
    const server = await makeTestServer({ forgeBoundaries: forge })
    runGit(server.root, ['init', '-b', 'main'])
    runGit(server.root, ['remote', 'add', 'origin', 'https://github.com/fixture/repo.git'])
    await writeFile(`${server.root}/readme.md`, 'fixture\n')
    runGit(server.root, ['add', 'readme.md'])
    runGit(server.root, ['commit', '-m', 'fixture'])
    await provide(server)
    await server.cleanup()
  },
})

test('delegates the checkout-qualified remote probe, posts, settles, and refreshes discussion', async ({
  client,
  server,
  forge,
}) => {
  void client
  const view = renderWithProviders(
    <PullRequestDiscussion rootPath='' number={7} url='https://github.com/fixture/repo/pull/7' />,
  )
  expect(resourceQueryClient.getQueryState(pullRequestDiscussionKeys.dialogModule)).toMatchObject({
    status: 'pending',
    fetchStatus: 'idle',
  })
  await userEvent.hover(screen.getByRole('button', { name: 'Discussion' }))
  await waitFor(() =>
    expect(resourceQueryClient.getQueryState(pullRequestDiscussionKeys.dialogModule)?.status).toBe(
      'success',
    ),
  )
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(forge.remoteProbes).toEqual([])
  await userEvent.click(screen.getByRole('button', { name: 'Discussion' }))
  expect(await screen.findByText('No comments')).toBeVisible()
  expect(forge.remoteProbes).toContainEqual(['git', '-C', server.root, 'remote', '-v'])
  await userEvent.type(
    screen.getByRole('textbox', { name: 'Comment' }),
    'Please explain this change',
  )
  await userEvent.click(screen.getByRole('button', { name: 'Post comment' }))
  expect(await screen.findByText('Please explain this change')).toBeVisible()
  await waitFor(() => expect(screen.getByRole('textbox', { name: 'Comment' })).toHaveValue(''))
  expect(forge.writes).toEqual(['Please explain this change'])
  expect(view.queryClient.getQueryData(pullRequestDiscussionKeys.comments('', 7))).toMatchObject({
    kind: 'ready',
    comments: [{ body: 'Please explain this change' }],
  })
  forge.comments.push({ ...forge.comments[0]!, id: 2, body: 'External reply' })
  await userEvent.click(screen.getByRole('button', { name: 'Refresh discussion' }))
  expect(await screen.findByText('External reply')).toBeVisible()
})

test('a rejected post keeps the draft and does not claim it was posted', async ({
  client,
  forge,
}) => {
  void client
  forge.control.failPost = true
  renderWithProviders(
    <PullRequestDiscussion rootPath='' number={7} url='https://github.com/fixture/repo/pull/7' />,
  )
  await userEvent.click(screen.getByRole('button', { name: 'Discussion' }))
  await screen.findByText('No comments')
  await userEvent.type(screen.getByRole('textbox', { name: 'Comment' }), 'Keep this draft')
  await userEvent.click(screen.getByRole('button', { name: 'Post comment' }))
  expect(await screen.findByText('The Git host could not post the comment')).toBeVisible()
  expect(screen.getByRole('textbox', { name: 'Comment' })).toHaveValue('Keep this draft')
  expect(forge.comments).toEqual([])
  await userEvent.keyboard('{Escape}')
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  await userEvent.click(screen.getByRole('button', { name: 'Discussion' }))
  expect(await screen.findByRole('textbox', { name: 'Comment' })).toHaveValue('Keep this draft')
})

test('a failed comment releases a queued review and both settle the query', async ({
  client,
  forge,
}) => {
  void client
  const queryClient = createTestQueryClient()
  const gate = Promise.withResolvers<void>()
  queryClient.setQueryData(pullRequestDiscussionKeys.comments('', 7), {
    kind: 'ready',
    comments: [],
  })
  forge.control.beforePost = async () => {
    forge.control.failPost = forge.writes.length === 1
    if (forge.writes.length === 1) await gate.promise
  }
  const a = renderHookWithProviders(() => usePostPullRequestComment('', 7), { queryClient })
  const b = renderHookWithProviders(() => useSubmitPullRequestReview('', 7), { queryClient })
  let first!: Promise<unknown>
  let second!: Promise<unknown>
  act(() => {
    first = a.result.current.mutateAsync('First').catch((error) => error)
    second = b.result.current.mutateAsync({ body: 'Second', verdict: 'approve' })
    void second.catch(() => {})
  })
  try {
    await waitFor(() => expect(forge.writes).toEqual(['First']))
    expect(forge.reviews).toEqual([])
    gate.resolve()
    await act(async () => {
      await Promise.all([first, second])
    })
    expect(forge.writes).toEqual(['First'])
    expect(forge.comments).toEqual([])
    expect(forge.reviews).toEqual([{ body: 'Second', event: 'APPROVE' }])
    expect(await first).toMatchObject({ code: 'git.PULL_REQUEST_COMMENT_FAILED' })
    expect(
      queryClient.getQueryState(pullRequestDiscussionKeys.comments('', 7))?.isInvalidated,
    ).toBe(true)
  } finally {
    gate.resolve()
    await Promise.allSettled([first, second])
  }
})

test('Azure explains the unsupported write and keeps the composer hidden', async ({
  client,
  server,
  forge,
}) => {
  void client
  runGit(server.root, [
    'remote',
    'set-url',
    'origin',
    'https://dev.azure.com/org/project/_git/repo',
  ])
  renderWithProviders(
    <PullRequestDiscussion
      rootPath=''
      number={7}
      url='https://dev.azure.com/org/project/_git/repo/pullrequest/7'
    />,
  )
  await userEvent.click(screen.getByRole('button', { name: 'Discussion' }))
  expect(await screen.findByText('Open Azure DevOps to post pull request comments.')).toBeVisible()
  expect(screen.queryByRole('textbox', { name: 'Comment' })).toBeNull()
  expect(forge.writes).toEqual([])
})

test('comment routes reject blank comments and invalid request numbers before forge I/O', async ({
  client,
  forge,
}) => {
  const empty = await client.git['pull-request'].comment.post({ path: '', number: 7, body: '   ' })
  expect(empty.status).toBe(400)
  const invalid = await client.git['pull-request'].comments.get({
    query: { path: '', number: 0 },
  })
  expect(invalid.status).toBe(400)
  expect(forge.writes).toEqual([])
})

test('review controls submit a verdict and preserve a refused summary across reopening', async ({
  client,
  forge,
}) => {
  void client
  renderWithProviders(
    <PullRequestDiscussion rootPath='' number={7} url='https://github.com/fixture/repo/pull/7' />,
  )
  await userEvent.click(screen.getByRole('button', { name: 'Discussion' }))
  const summary = await screen.findByRole('textbox', { name: 'Review summary' })
  expect(screen.getByRole('button', { name: 'Request changes' })).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Submit review' })).toBeDisabled()
  await userEvent.click(screen.getByRole('button', { name: 'Approve pull request' }))
  expect(await screen.findByText('Review submitted')).toBeVisible()
  expect(forge.reviews).toEqual([{ body: '', event: 'APPROVE' }])
  await userEvent.type(summary, 'Please revise this implementation')
  forge.control.failReview = true
  await userEvent.click(screen.getByRole('button', { name: 'Request changes' }))
  expect(await screen.findByText('The Git host could not submit the review')).toBeVisible()
  expect(summary).toHaveValue('Please revise this implementation')
  expect(screen.queryByText('Review submitted')).toBeNull()
  await userEvent.keyboard('{Escape}')
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  await userEvent.click(screen.getByRole('button', { name: 'Discussion' }))
  expect(await screen.findByRole('textbox', { name: 'Review summary' })).toHaveValue(
    'Please revise this implementation',
  )
  expect(forge.reviews).toHaveLength(1)
})

test('Azure displays readable inline and reply context with unsupported review actions', async ({
  client,
  server,
  forge,
}) => {
  void client
  runGit(server.root, [
    'remote',
    'set-url',
    'origin',
    'https://dev.azure.com/org/project/_git/repo',
  ])
  forge.azureThreads.push({
    id: 8,
    threadContext: { filePath: '/src/main.ts' },
    comments: [
      { id: 1, content: 'Inline feedback', publishedDate: 'today' },
      { id: 2, content: 'Thread reply', publishedDate: 'today' },
    ],
  })
  renderWithProviders(
    <PullRequestDiscussion
      rootPath=''
      number={7}
      url='https://dev.azure.com/org/project/_git/repo/pullrequest/7'
    />,
  )
  await userEvent.click(screen.getByRole('button', { name: 'Discussion' }))
  expect(await screen.findByText('Inline feedback')).toBeVisible()
  expect(screen.getByText('Thread reply')).toBeVisible()
  expect(screen.getAllByText('Thread #8 · /src/main.ts')).toHaveLength(2)
  expect(screen.getByText('Open Azure DevOps to submit a pull request review.')).toBeVisible()
  expect(screen.queryByRole('textbox', { name: 'Review summary' })).toBeNull()
  expect(screen.queryByRole('button', { name: 'Approve pull request' })).toBeNull()
})

test('review validation refuses empty summaries before forge I/O', async ({ client, forge }) => {
  for (const verdict of ['comment', 'request-changes'] as const) {
    const result = await client.git['pull-request'].review.post({
      path: '',
      number: 7,
      body: '   ',
      verdict,
    })
    expect(result.status).toBe(400)
  }
  expect(forge.reviews).toEqual([])
  expect(forge.remoteProbes).toEqual([])
})

test('a refused review waits for refreshed discussion before releasing the composer', async ({
  client,
  forge,
}) => {
  void client
  const gate = Promise.withResolvers<void>()
  renderWithProviders(
    <PullRequestDiscussion rootPath='' number={7} url='https://github.com/fixture/repo/pull/7' />,
  )
  await userEvent.click(screen.getByRole('button', { name: 'Discussion' }))
  await screen.findByText('No comments')
  forge.comments.push({
    id: 1,
    body: 'Host activity arrived',
    user: { login: 'reviewer' },
    created_at: 'today',
    html_url: 'https://github.com/fixture/repo/pull/7#issuecomment-1',
  })
  forge.control.failReview = true
  forge.control.beforeRead = () => gate.promise
  await userEvent.type(screen.getByRole('textbox', { name: 'Review summary' }), 'Keep the summary')
  await userEvent.click(screen.getByRole('button', { name: 'Submit review' }))
  try {
    await waitFor(() => expect(forge.reads).toHaveLength(2))
    expect(screen.getByRole('button', { name: 'Submitting review…' })).toBeDisabled()
    expect(screen.getByRole('textbox', { name: 'Review summary' })).toHaveValue('Keep the summary')
    gate.resolve()
    expect(await screen.findByText('Host activity arrived')).toBeVisible()
    expect(await screen.findByText('The Git host could not submit the review')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Submit review' })).toBeEnabled()
    expect(forge.reviews).toEqual([])
  } finally {
    gate.resolve()
  }
})

test('the existing discussion surface reads review and commit activity and groups native thread comments', async ({
  client,
  forge,
}) => {
  void client
  forge.activityReviews.push({
    id: 1,
    body: 'Host review summary',
    state: 'APPROVED',
    user: { login: 'alice' },
    submitted_at: '2026-10-01T10:00:00Z',
  })
  forge.activityCommits.push({
    sha: 'a'.repeat(40),
    author: { login: 'bob' },
    commit: { message: 'Activity commit headline', committer: { date: '2026-10-01T09:00:00Z' } },
  })
  forge.activityDiscussions.push(
    {
      id: 9,
      body: 'Inline root feedback',
      path: 'src/main.ts',
      user: { login: 'alice' },
      created_at: '2026-10-01T10:00:00Z',
      html_url: 'https://github.com/fixture/repo/pull/7#9',
    },
    {
      id: 10,
      in_reply_to_id: 9,
      body: 'Inline reply feedback',
      path: 'src/main.ts',
      user: { login: 'bob' },
      created_at: '2026-10-01T11:00:00Z',
      html_url: 'https://github.com/fixture/repo/pull/7#10',
    },
  )
  const view = renderWithProviders(
    <PullRequestDiscussion rootPath='' number={7} url='https://github.com/fixture/repo/pull/7' />,
  )
  await userEvent.click(screen.getByRole('button', { name: 'Discussion' }))
  await userEvent.click(await screen.findByRole('tab', { name: 'Activity' }))
  expect(await screen.findByText('Host review summary')).toBeVisible()
  expect(screen.getByText('Activity commit headline')).toBeVisible()
  expect(screen.getByRole('region', { name: 'Discussion 9' })).toHaveTextContent(
    'Inline root feedback',
  )
  expect(screen.getByRole('region', { name: 'Discussion 9' })).toHaveTextContent(
    'Inline reply feedback',
  )
  expect(view.queryClient.getQueryData(pullRequestDiscussionKeys.activity('', 7))).toMatchObject({
    kind: 'ready',
    discussions: { kind: 'ready', items: [{ id: '9', comments: [{ id: '9' }, { id: '10' }] }] },
  })
  forge.activityReviews.push({
    id: 2,
    body: 'External review arrived',
    state: 'CHANGES_REQUESTED',
    user: { login: 'bob' },
    submitted_at: '2026-10-01T11:00:00Z',
  })
  await userEvent.click(screen.getByRole('button', { name: 'Refresh discussion' }))
  expect(await screen.findByText('External review arrived')).toBeVisible()
})

test('Azure activity presents native grouped conversation and explicit unsupported read sections', async ({
  client,
  server,
  forge,
}) => {
  void client
  runGit(server.root, [
    'remote',
    'set-url',
    'origin',
    'https://dev.azure.com/org/project/_git/repo',
  ])
  forge.azureThreads.push({
    id: 8,
    threadContext: { filePath: '/src/main.ts' },
    comments: [
      { id: 1, content: 'Azure root feedback', publishedDate: '2026-10-01T10:00:00Z' },
      { id: 2, content: 'Azure reply feedback', publishedDate: '2026-10-01T11:00:00Z' },
    ],
  })
  renderWithProviders(
    <PullRequestDiscussion
      rootPath=''
      number={7}
      url='https://dev.azure.com/org/project/_git/repo/pullrequest/7'
    />,
  )
  await userEvent.click(screen.getByRole('button', { name: 'Discussion' }))
  await userEvent.click(await screen.findByRole('tab', { name: 'Activity' }))
  expect(await screen.findByText('Open Azure DevOps for review history.')).toBeVisible()
  expect(screen.getByText('Open Azure DevOps for pull request commits.')).toBeVisible()
  expect(screen.queryByText('No reviews')).toBeNull()
  expect(screen.queryByText('No commits')).toBeNull()
  expect(screen.getByRole('region', { name: 'Discussion 8' })).toHaveTextContent(
    'Azure root feedback',
  )
  expect(screen.getByRole('region', { name: 'Discussion 8' })).toHaveTextContent(
    'Azure reply feedback',
  )
})

test('a refused review awaits independently blocked activity settlement before releasing its draft', async ({
  client,
  forge,
}) => {
  void client
  const gate = Promise.withResolvers<void>()
  renderWithProviders(
    <PullRequestDiscussion rootPath='' number={7} url='https://github.com/fixture/repo/pull/7' />,
  )
  await userEvent.click(screen.getByRole('button', { name: 'Discussion' }))
  await userEvent.click(await screen.findByRole('tab', { name: 'Activity' }))
  await screen.findByText('No reviews')
  forge.control.failReview = true
  forge.control.beforeActivityRead = () => gate.promise
  forge.activityReviews.push({
    id: 4,
    body: 'Review appeared during refusal',
    state: 'APPROVED',
    user: { login: 'alice' },
    submitted_at: '2026-10-01T10:00:00Z',
  })
  await userEvent.type(
    screen.getByRole('textbox', { name: 'Review summary' }),
    'Keep this activity draft',
  )
  await userEvent.click(screen.getByRole('button', { name: 'Submit review' }))
  try {
    await waitFor(() => expect(forge.activityReads).toHaveLength(6))
    await waitFor(() => expect(forge.reads).toHaveLength(2))
    expect(screen.getByRole('button', { name: 'Submitting review…' })).toBeDisabled()
    expect(screen.getByText('No reviews')).toBeVisible()
    gate.resolve()
    expect(await screen.findByText('Review appeared during refusal')).toBeVisible()
    expect(await screen.findByText('The Git host could not submit the review')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Submit review' })).toBeEnabled()
    expect(screen.getByRole('textbox', { name: 'Review summary' })).toHaveValue(
      'Keep this activity draft',
    )
  } finally {
    gate.resolve()
  }
})
