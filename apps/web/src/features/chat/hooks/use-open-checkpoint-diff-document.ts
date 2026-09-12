import { useEnvironmentId } from '@/lib/environments/hooks/use-environment-id'
import { clientForQueryClient } from '@/lib/environments/state/query-clients'
import { useQueryClient } from '@tanstack/react-query'

import { useEditorCommands } from '@/features/editor/hooks/use-editor-commands'
import { documentTab } from '@/lib/documents/utils/tabs'
import { filesystemPath } from '@/lib/documents/utils/identity'
import { checkpointRequest } from '@/lib/documents/utils/comparisons'
import { useEditorWorkspaceStoreApi } from '@/features/editor/state/workspace-state'
import {
  canOpenCheckpointDiff,
  checkpointFileDocument,
  checkpointDiffRetry,
  checkpointDiffRetryDelay,
  checkpointSessionDocument,
  checkpointFullSessionDiffInputForSummary,
  checkpointDiffInputForSummary,
  checkpointDiffQueryKey,
  checkpointTurnDocument,
  fetchCheckpointDiff,
  matchingCheckpointDiff,
} from '@/features/chat/utils/checkpoint-diff-query'
import type { ChatTurnDiffSummary } from '@workspace/client-core/chat/types'
import { useNavigation } from '@/hooks/use-navigation'

export function useOpenCheckpointDiffDocument() {
  const queryClient = useQueryClient()
  const environmentId = useEnvironmentId()
  const { selectContent } = useEditorCommands()
  const navigation = useNavigation()
  const workspaceStore = useEditorWorkspaceStoreApi()

  async function openCheckpointDiff(summary: ChatTurnDiffSummary, path?: string) {
    if (!canOpenCheckpointDiff(summary)) return false

    const rootPath = workspaceStore.getState().rootFolder?.path ?? null
    if (rootPath === null) return false
    const owner = filesystemPath(rootPath)
    const operation = navigation.getSnapshot()
    const rangeInput = checkpointDiffInputForSummary(summary)
    const diffs = await queryClient.fetchQuery({
      queryFn: ({ signal, client }) =>
        fetchCheckpointDiff(rangeInput, signal, clientForQueryClient(client)),
      queryKey: checkpointDiffQueryKey(rangeInput),
      retry: checkpointDiffRetry,
      retryDelay: checkpointDiffRetryDelay,
      staleTime: Infinity,
    })
    if (navigation.getSnapshot() !== operation) return false
    if (!path) {
      const documentInput = checkpointTurnDocument(summary, owner)
      queryClient.setQueryData(
        checkpointDiffQueryKey(checkpointRequest(documentInput.source)),
        diffs,
      )
      const opened = await selectContent(documentTab(documentInput))
      if (opened.status !== 'applied') return false
      await rememberTurnScope(summary, null)

      return true
    }

    const diff = matchingCheckpointDiff(diffs, path) ?? diffs[0] ?? null
    const documentPath = diff?.path ?? path ?? summary.files[0]?.path
    if (!documentPath) return false

    const documentInput = checkpointFileDocument(summary, filesystemPath(documentPath), diff, owner)
    // Seed only a diff we actually have: the viewer reads this key and treats a
    // seeded entry as final, so seeding an empty list for a file the range fetch
    // missed would pin the tab to "no changes" instead of letting it ask again.
    if (diff)
      queryClient.setQueryData(checkpointDiffQueryKey(checkpointRequest(documentInput.source)), [
        diff,
      ])
    const opened = await selectContent(documentTab(documentInput))
    if (opened.status !== 'applied') return false
    await rememberTurnScope(summary, documentPath)

    return true
  }

  async function openFullSessionCheckpointDiff(summary: ChatTurnDiffSummary) {
    if (!canOpenCheckpointDiff(summary)) return false

    const rootPath = workspaceStore.getState().rootFolder?.path ?? null
    if (rootPath === null) return false
    const owner = filesystemPath(rootPath)
    const operation = navigation.getSnapshot()
    const input = checkpointFullSessionDiffInputForSummary(summary)
    const diffs = await queryClient.fetchQuery({
      queryFn: ({ signal, client }) =>
        fetchCheckpointDiff(input, signal, clientForQueryClient(client)),
      queryKey: checkpointDiffQueryKey(input),
      retry: checkpointDiffRetry,
      retryDelay: checkpointDiffRetryDelay,
      staleTime: Infinity,
    })
    if (navigation.getSnapshot() !== operation) return false
    const documentInput = checkpointSessionDocument(summary, owner)
    queryClient.setQueryData(checkpointDiffQueryKey(checkpointRequest(documentInput.source)), diffs)
    return (await selectContent(documentTab(documentInput))).status === 'applied'
  }

  async function rememberTurnScope(summary: ChatTurnDiffSummary, filePath: string | null) {
    await navigation.setDiffScope(
      { filePath, kind: 'turn', turnId: summary.turnId },
      { environmentId, sessionId: summary.sessionId },
    )
  }

  return { openCheckpointDiff, openFullSessionCheckpointDiff }
}
