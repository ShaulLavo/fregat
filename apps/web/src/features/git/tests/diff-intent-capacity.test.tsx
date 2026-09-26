import { waitFor } from '@testing-library/react'
import { diffQueryOptions } from '@/features/git/utils/diff-query'
import { startDiffIntent } from '@/lib/intent-prefetch/state/query-intent'
import {
  registerEnvironmentQueryClient,
  originForQueryClient,
} from '@/lib/environments/state/query-clients'
import { createObservedInProcessClient } from '../../../../test/client'
import { delayedGitDiffs } from '../../../../test/factories/delayed-git'
import { expect, test } from '../../../../test/fixtures'
import { createTestQueryClient } from '../../../../test/render'

test('leaving eight rows admits only four server Git operations until they finish', async ({
  client,
  server,
}) => {
  void client
  const git = await delayedGitDiffs(server.root, 8)
  const reads: string[] = []
  const observed = createObservedInProcessClient(server, (request) => {
    if (new URL(request.url).pathname === '/git/diff') reads.push(request.url)
  })
  const queryClient = createTestQueryClient()
  registerEnvironmentQueryClient(queryClient, originForQueryClient(queryClient), observed)
  try {
    for (const path of git.paths) {
      startDiffIntent(queryClient, diffQueryOptions(path, false), 'active-row', true)()
    }
    // Check real subprocesses, not just the browser's cancelled fetch count.
    await waitFor(async () => expect((await git.active()).length).toBeGreaterThanOrEqual(4))
    expect(reads).toHaveLength(4)
    expect(await git.active()).toHaveLength(4)
    expect(queryClient.isFetching()).toBe(4)
    startDiffIntent(queryClient, diffQueryOptions(git.paths[0]!, false), 'hover', true)()
    expect(reads).toHaveLength(4)
    await git.release()
    await waitFor(() => expect(queryClient.isFetching()).toBe(0))
    for (const path of git.paths.slice(0, 4)) {
      const diffs = queryClient.getQueryData(diffQueryOptions(path, false).queryKey)
      expect(diffs?.[0]?.newText).toBe('after\n')
    }
    startDiffIntent(queryClient, diffQueryOptions(git.paths[4]!, false), 'hover', true)()
    await waitFor(() => expect(reads).toHaveLength(5))
    await waitFor(() => expect(queryClient.isFetching()).toBe(0))
  } finally {
    await git.release()
    await waitFor(async () => expect(await git.active()).toHaveLength(0))
    queryClient.clear()
  }
})
