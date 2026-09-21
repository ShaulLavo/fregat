import { useEffect, useMemo } from 'react'

import { ConflictEditorResolutionCoordinator } from '@/features/workspace/state/conflict-editor-resolution'
import { useEditorRuntime } from '@/features/editor/hooks/use-runtime'
import { useEditorCommands } from '@/features/editor/hooks/use-editor-commands'
import { clientForQueryClient } from '@/lib/environments/state/query-clients'

export function useConflictEditorResolution() {
  const runtime = useEditorRuntime()
  const commands = useEditorCommands()
  // Required stable identity: the coordinator owns debounce state and in-flight writes across
  // editor renders, so rebuilding it would drop them.
  const coordinator = useMemo(
    () =>
      new ConflictEditorResolutionCoordinator({
        client: clientForQueryClient(runtime.queryClient),
        conflictStore: runtime.conflictStore,
        documentStore: runtime.documentStore,
        queryClient: runtime.queryClient,
        getOperationRoot: runtime.getOperationRoot,
        issueWriteId: runtime.issueFileWriteId,
        discardLiveEditorDocument: commands.discardLiveEditorDocument,
        renameLiveEditorDocument: commands.renameLiveEditorDocument,
      }),
    [commands, runtime],
  )
  useEffect(() => coordinator.connect(), [coordinator])
  return coordinator.schedule
}
