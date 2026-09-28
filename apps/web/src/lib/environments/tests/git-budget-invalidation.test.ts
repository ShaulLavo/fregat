import { QueryObserver } from '@tanstack/react-query'
import { settingsKeys } from '@workspace/client-core/settings/query-keys'
import { expect, test } from '../../../../test/fixtures'
import { createTestQueryClient } from '../../../../test/render'
import { settingsSnapshot } from '../../../../test/factories/settings'
import { gitKeys } from '@/lib/query-keys'
import { installGitBudgetInvalidation } from '@/lib/environments/state/git-budget-invalidation'

test('budget changes discard inactive diff text and refetch an observed blob pair', async () => {
  const client = createTestQueryClient()
  const stop = installGitBudgetInvalidation(client)
  const key = gitKeys.blobDiff({ path: 'file.txt', oldObjectId: 'old', newObjectId: 'new' })
  client.setQueryData(settingsKeys.document(), settingsSnapshot())
  client.setQueryData(key, { content: 'old policy' })
  client.setQueryData(gitKeys.diff('inactive.txt', false), { content: 'retained' })
  let reads = 0
  const observer = new QueryObserver(client, {
    queryKey: key,
    staleTime: Infinity,
    queryFn: async () => {
      reads += 1
      return { content: 'new policy' }
    },
  })
  const unsubscribe = observer.subscribe(() => {})
  try {
    client.setQueryData(
      settingsKeys.document(),
      settingsSnapshot({ values: { 'git.maxDiffFileSizeMiB': 1 } }),
    )
    await expect.poll(() => reads).toBe(1)
    await expect.poll(() => client.getQueryData(key)).toEqual({ content: 'new policy' })
    expect(client.getQueryData(gitKeys.diff('inactive.txt', false))).toBeUndefined()
    client.setQueryData(
      settingsKeys.document(),
      settingsSnapshot({ sequence: 2, values: { 'git.maxDiffFileSizeMiB': 1 } }),
    )
    expect(reads).toBe(1)
  } finally {
    unsubscribe()
    stop()
    client.clear()
  }
})
