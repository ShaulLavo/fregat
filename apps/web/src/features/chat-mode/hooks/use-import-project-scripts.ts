import type { OrchestrationProjectScript } from '@workspace/contracts'
import { selectWorktreeAtPath } from '@workspace/client-core/chat/selectors'
import { toast } from 'sonner'

import { createProjectScriptsCommand } from '@workspace/client-core/chat/commands'
import { useActiveChatProjection } from '@/features/chat/hooks/use-active-projection'
import { transportFor } from '@/features/chat/state/active-transports'
import { dispatchChatCommand } from '@/features/chat/utils/command-dispatch'
import { notifyChatCommandError } from '@/features/chat/notify-command-error'
import { importableScripts } from '@/features/chat-mode/utils/project-scripts'
import { useEnvironmentId } from '@/lib/environments/hooks/use-environment-id'

/**
 * The explicit step that makes a project file's scripts trusted: they are copied into the saved
 * project scripts, and only saved scripts ever run on worktree creation. Editing the file later
 * changes nothing that was imported. Works from the palette, which sits above any chat session.
 */
export function useImportProjectScripts(rootPath: string | null) {
  const environmentId = useEnvironmentId()
  const project = useActiveChatProjection((slice) => {
    const worktree = rootPath === null ? undefined : selectWorktreeAtPath(slice, rootPath)
    return worktree ? (slice.projectById[worktree.projectId] ?? null) : null
  })

  return (file: readonly OrchestrationProjectScript[]) => {
    const transport = transportFor(environmentId)
    if (!project || !transport) {
      toast.error('Open this folder as a project before importing its scripts')
      return
    }
    const imported = importableScripts(file, project.scripts)
    if (imported.length === 0) {
      toast.info('Every script in t3.json is already saved')
      return
    }
    void dispatchChatCommand({
      action: 'chat.project.scripts.import',
      command: createProjectScriptsCommand({
        projectId: project.id,
        scripts: [...project.scripts, ...imported],
      }),
      dispatchCommand: transport.dispatchCommand,
      onAccepted: () =>
        toast.success(
          imported.length === 1 ? 'Imported 1 script' : `Imported ${imported.length} scripts`,
        ),
      onFailed: (error) => notifyChatCommandError(error, 'Could not import the project scripts'),
    })
  }
}
