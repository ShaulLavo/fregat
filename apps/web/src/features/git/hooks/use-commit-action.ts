import { useEditorCommands } from '@/features/editor/hooks/use-editor-commands'
import { useGitState } from '@/features/git/state/store'
import { useCommitMutation } from './use-commit-mutation'
import { useCommitPending } from './use-commit-pending'

export function useCommitAction(rootPath: string) {
  const { discardLiveEditorDocument, selectFile } = useEditorCommands()
  const message = useGitState((state) => state.commitMessage)
  const setMessage = useGitState((state) => state.setCommitMessage)
  const commit = useCommitMutation(rootPath)
  const isPending = useCommitPending(rootPath)
  const trimmedMessage = message.trim()

  function submit() {
    if (isPending) return

    commit.mutate(trimmedMessage, {
      onSuccess: (result) => {
        if (result.kind !== 'message-file') return
        discardLiveEditorDocument(result.path)
        // TODO: when save is implemented, saving COMMIT_EDITMSG should complete or abort the git commit.
        selectFile(result.path)
      },
    })
  }

  return {
    isPending,
    message,
    setMessage,
    submit,
  }
}
