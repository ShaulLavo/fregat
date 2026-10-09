import type { EnvironmentId, WorktreeId } from '@workspace/contracts'
import { transportFor } from '@/features/chat/state/active-transports'
import {
  selectChatProjectionSlice,
  useChatProjectionStore,
} from '@/features/chat/state/chat-projection-store'
import { createWorkspaceProjectCommand } from '@workspace/client-core/chat/commands'
import { dispatchChatCommand } from '@/features/chat/utils/command-dispatch'
import { settleShellSnapshot } from '@/features/chat-mode/state/settle-shell-snapshot'
import { reportError, toClientError } from '@/lib/client-error-taxonomy'
import type { ConfirmedMachine } from '@/lib/environments/utils/machines'
import { createClientInvariantError } from '@/lib/structured-errors'
import type { Navigation } from '@/state/navigation'

/**
 * Registers the folder as a project on its machine, then opens it; throws when the machine
 * refuses. Resolves with the chat projection already holding the project, so a draft can open
 * in `project` at once.
 */
export async function openMachineProject(
  navigation: Navigation,
  machine: ConfirmedMachine,
  path: string,
) {
  const transport = transportFor(machine.environmentId)
  const outcome = await dispatchChatCommand({
    action: 'workspace.machine_project_selected',
    command: createWorkspaceProjectCommand({ rootPath: path }),
    context: { environmentId: machine.environmentId, machine: machine.name, path },
    dispatchCommand: (command) => {
      if (!transport || transport.closed)
        throw createClientInvariantError(
          `Reconnect ${machine.label ?? machine.name} before adding a project.`,
        )
      return transport.dispatchCommand(command)
    },
  })
  if (!outcome.ok) throw toClientError(outcome.error)
  const project = outcome.result.result
  // The command answers before its event arrives; the machine's snapshot already holds the project.
  if (project && !projected(machine.environmentId, project.worktreeId))
    await settleShellSnapshot(machine.environmentId)
  const opened = await navigation.openWorkspace({ environmentId: machine.environmentId, path })
  return { opened, project }
}

export async function openPickedMachineProject(
  navigation: Navigation,
  machine: ConfirmedMachine,
  path: string,
) {
  try {
    await openMachineProject(navigation, machine, path)
  } catch (error) {
    reportError(toClientError(error))
  }
}

function projected(environmentId: EnvironmentId, worktreeId: WorktreeId) {
  const slice = selectChatProjectionSlice(useChatProjectionStore.getState(), environmentId)
  return Boolean(slice.worktreeById[worktreeId])
}
