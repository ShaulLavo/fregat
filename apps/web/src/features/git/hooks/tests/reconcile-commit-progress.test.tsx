import { act, waitFor } from '@testing-library/react'
import type { GitStatusResult } from '@workspace/contracts'
import { createClientError } from '@workspace/client-core/errors'

import { useReconcileCommitProgress } from '@/features/git/hooks/use-reconcile-commit-progress'
import {
  commitProgressStoreFor,
  selectCommitProgress,
} from '@/features/git/state/commit-progress-store'
import { mutationKeys } from '@/features/git/utils/mutation-keys'
import { gitKeys } from '@/lib/query-keys'
import { expect, test } from '../../../../../test/fixtures'
import { createTestQueryClient, renderHookWithProviders } from '../../../../../test/render'

test.for([null, 'previous-commit'])(
  "external commit clears only this repository's failed commit, starting at %s",
  async (commit) => {
    const queryClient = createTestQueryClient()
    const cache = queryClient.getMutationCache()
    const progress = commitProgressStoreFor(queryClient)
    const status: GitStatusResult = {
      repository: { branch: 'main', commit, ahead: 0, behind: 0, path: 'repo' },
      files: [],
      uninitializedSubmodules: 0,
    }
    queryClient.setQueryData(gitKeys.status('repo'), status)
    for (const root of ['repo', 'other']) {
      progress.getState().beginCommitProgress(root, commit)
      progress.getState().appendCommitProgress(root, { stream: 'stderr', text: 'hook rejected' })
    }
    for (const mutationKey of [
      mutationKeys.commit('repo'),
      mutationKeys.commit('other'),
      mutationKeys.push('repo'),
    ]) {
      const mutation = cache.build(queryClient, {
        mutationKey,
        mutationFn: async () => {
          throw createClientError({ code: 'git-test-rejected', message: 'Rejected' })
        },
      })
      await mutation.execute(undefined).catch(() => undefined)
    }

    const { unmount } = renderHookWithProviders(() => useReconcileCommitProgress('repo'), {
      queryClient,
    })
    expect(selectCommitProgress(progress.getState(), 'repo')).toHaveLength(1)
    expect(cache.getAll()).toHaveLength(3)

    // A new status snapshot at the same HEAD must preserve the explanation.
    act(() => queryClient.setQueryData(gitKeys.status('repo'), { ...status, files: [] }))
    expect(selectCommitProgress(progress.getState(), 'repo')).toHaveLength(1)
    act(() =>
      queryClient.setQueryData(gitKeys.status('repo'), {
        ...status,
        repository: { ...status.repository, commit: 'external-commit' },
      }),
    )
    await waitFor(() => expect(selectCommitProgress(progress.getState(), 'repo')).toEqual([]))
    expect(cache.findAll({ mutationKey: mutationKeys.commit('repo') })).toEqual([])
    expect(cache.findAll({ mutationKey: mutationKeys.commit('other') })).toHaveLength(1)
    expect(cache.findAll({ mutationKey: mutationKeys.push('repo') })).toHaveLength(1)
    expect(selectCommitProgress(progress.getState(), 'other')).toHaveLength(1)
    unmount()
    queryClient.clear()
  },
)
