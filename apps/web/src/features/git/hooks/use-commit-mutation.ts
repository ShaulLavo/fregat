import { admitGitMutation } from '@/features/git/utils/admit-mutation'
import { clientForQueryClient } from '@/lib/environments/state/query-clients'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

import { fileSystemKeys } from '@/lib/query-keys'
import { commitChangesStreaming, type CommitRequest } from '@/features/git/utils/api'
import { mutationKeys } from '@/features/git/utils/mutation-keys'
import { notifyMutationError } from '@/features/git/utils/notify-mutation-error'
import { commitProgressStoreFor } from '@/features/git/state/commit-progress-store'
import { useGitStoreApi } from '@/features/git/state/store'
import { useWorkspaceInvalidation } from './use-workspace-invalidation'

export function useCommitMutation(rootPath: string) {
  const invalidate = useWorkspaceInvalidation()
  const queryClient = useQueryClient()
  const store = useGitStoreApi()

  return useMutation({
    // Streaming, so the repository's hooks can be seen working. A commit is the
    // one git command that runs arbitrary user code, and the previous one-shot
    // call left a slow hook looking exactly like a hung button.
    mutationFn: async (request: CommitRequest, { client }) => {
      await admitGitMutation(client, rootPath)
      const progress = commitProgressStoreFor(client).getState()
      progress.clearCommitProgress(rootPath)

      return commitChangesStreaming(
        rootPath,
        request,
        (line) => progress.appendCommitProgress(rootPath, line),
        clientForQueryClient(client),
      )
    },
    mutationKey: mutationKeys.commit(rootPath),
    onMutate: () => ({ store, revision: store.getState().commitMessageRevision }),
    onError: notifyMutationError,
    onSuccess: (result, _request, draft) => {
      if (result.kind === 'message-file') {
        // Closing that tab is what commits; see useMessageFileCommit.
        store.getState().setPendingMessageFile({ path: result.path, seenOpen: false })
        toast.info('Write the commit message, then close the tab to commit')
        // Awaited, so the tab opens on the file the server just rewrote: a cached
        // snapshot from an earlier commit would make the first save a conflict.
        return queryClient.refetchQueries({ queryKey: fileSystemKeys.fileSnapshot(result.path) })
      }
      if (result.kind === 'aborted') {
        toast.info('Commit aborted: the message was empty')
        return
      }

      if (draft && draft.store.getState().commitMessageRevision === draft.revision)
        draft.store.getState().resetCommitMessage()
      toast.success('Committed changes')
      // Only on success: a rejected commit's output is the explanation, and
      // clearing it would take away the only thing that says what to fix.
      commitProgressStoreFor(queryClient).getState().clearCommitProgress(rootPath)
      invalidate()
    },
  })
}
