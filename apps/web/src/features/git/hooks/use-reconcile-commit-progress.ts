import { useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { useStore } from 'zustand'

import { useCommitPending } from '@/features/git/hooks/use-commit-pending'
import { useStatus } from '@/features/git/hooks/use-status'
import { commitProgressStoreFor } from '@/features/git/state/commit-progress-store'
import { mutationKeys } from '@/features/git/utils/mutation-keys'

export function useReconcileCommitProgress(rootPath: string) {
  const client = useQueryClient()
  const progress = commitProgressStoreFor(client)
  const baseCommit = useStore(progress, (state) => state.runsByRootPath[rootPath]?.commit)
  const commit = useStatus(rootPath).data?.repository?.commit
  const pending = useCommitPending(rootPath)

  useEffect(() => {
    if (pending || baseCommit === undefined || commit === undefined || commit === baseCommit) return

    // An agent or terminal can commit without running this panel's success callback.
    const cache = client.getMutationCache()
    const failures = cache.findAll({
      mutationKey: mutationKeys.commit(rootPath),
      exact: true,
      status: 'error',
    })
    for (const failure of failures) cache.remove(failure)
    progress.getState().clearCommitProgress(rootPath)
  }, [baseCommit, client, commit, pending, progress, rootPath])
}
