import { screen, waitFor, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { writeFile } from 'node:fs/promises'
import { PullRequestDiscussion } from '@/features/git/components/pull-request-discussion'
import { usePostPullRequestComment } from '@/features/git/hooks/use-post-pull-request-comment'
import { pullRequestDiscussionKeys } from '@/features/git/utils/query-keys'
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

test('posts a forge comment, settles the query, and reads external comments on refresh', async ({
  client,
  forge,
}) => {
  void client
  const view = renderWithProviders(
    <PullRequestDiscussion rootPath='' number={7} url='https://github.com/fixture/repo/pull/7' />,
  )
  await userEvent.click(screen.getByRole('button', { name: 'Discussion' }))
  expect(await screen.findByText('No comments')).toBeVisible()
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
})

test('a failed concurrent write releases the next write and both invalidate the query', async ({
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
  const b = renderHookWithProviders(() => usePostPullRequestComment('', 7), { queryClient })
  let first!: Promise<unknown>
  let second!: Promise<unknown>
  act(() => {
    first = a.result.current.mutateAsync('First').catch((error) => error)
    second = b.result.current.mutateAsync('Second')
  })
  try {
    await waitFor(() => expect(forge.writes).toEqual(['First']))
    gate.resolve()
    await act(async () => {
      await Promise.all([first, second])
    })
    expect(forge.writes).toEqual(['First', 'Second'])
    expect(forge.comments.map((row) => row.body)).toEqual(['Second'])
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
  expect(
    await screen.findByText('Open Azure DevOps to read and post pull request discussion.'),
  ).toBeVisible()
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
