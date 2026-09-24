import { EMPTY_GIT_FILES } from '@/features/workspace/utils/tab-model'
import { ChatModeLayout } from '@/features/chat-mode/components/layout'
import { ChatModeSessionProvider } from '@/features/chat-mode/providers/session-provider'
import { useEditorConflictState } from '@/features/editor/state/conflict-state'
import { useEditorWorkspaceState } from '@/features/editor/state/workspace-state'
import { useStatus } from '@/features/git/hooks/use-status'

export function ChatModeSurfaceView({ rootPath }: { readonly rootPath: string }) {
  const conflicts = useEditorConflictState((state) => state.conflicts)
  const gitStatus = useStatus(rootPath)
  const gitFiles = gitStatus.data?.files ?? EMPTY_GIT_FILES
  const panels = useEditorWorkspaceState((state) => state.chatModePanels)
  const workbenchPanels = useEditorWorkspaceState((state) => state.workbenchPanels)

  return (
    <ChatModeSessionProvider editorRootPath={rootPath}>
      <ChatModeLayout
        conflicts={conflicts}
        gitFiles={gitFiles}
        panels={panels}
        rootPath={rootPath}
        workbenchPanels={workbenchPanels}
      />
    </ChatModeSessionProvider>
  )
}
