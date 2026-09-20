import { useEffect } from 'react'

import { useEditorWorkspaceState } from '@/features/editor/state/workspace-state'
import { useGitState } from '@/features/git/state/store'
import { allEditorTabs } from '@/lib/documents/utils/groups'
import { documentKey, fileDocumentKey, filesystemPath } from '@/lib/documents/utils/identity'
import { tabDocuments } from '@/lib/documents/utils/tabs'
import { useCommitMutation } from './use-commit-mutation'

/**
 * Finishes a commit whose message is being written in COMMIT_EDITMSG: once that
 * file's last tab closes, the saved contents are committed. An empty message,
 * or closing without saving, leaves only comments and the server aborts.
 */
export function useMessageFileCommit(rootPath: string) {
  const pending = useGitState((state) => state.pendingMessageFile)
  const setPendingMessageFile = useGitState((state) => state.setPendingMessageFile)
  const commit = useCommitMutation(rootPath)
  const isOpen = useEditorWorkspaceState((state) => {
    if (!pending) return false

    const key = fileDocumentKey(filesystemPath(pending.path))
    return allEditorTabs(state.workbenchPanels.editorGroups).some((tab) =>
      tabDocuments(tab.content).some((document) => documentKey(document) === key),
    )
  })

  useEffect(() => {
    if (!pending) return
    if (isOpen) {
      if (!pending.seenOpen) setPendingMessageFile({ path: pending.path, seenOpen: true })
      return
    }
    if (!pending.seenOpen) return

    setPendingMessageFile(null)
    commit.mutate({ message: '', source: 'message-file' })
    // `commit` is a fresh object each render; the close is the only trigger.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, pending, setPendingMessageFile])
}
