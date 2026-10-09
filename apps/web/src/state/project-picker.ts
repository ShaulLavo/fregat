import type { EnvironmentId, WorktreeId } from '@workspace/contracts'
import { transportFor } from '@/features/chat/state/active-transports'
import {
  selectChatProjectionSlice,
  useChatProjectionStore,
} from '@/features/chat/state/chat-projection-store'
import { createWorkspaceProjectCommand } from '@workspace/client-core/chat/commands'
import { dispatchChatCommand } from '@/features/chat/utils/command-dispatch'
import { reportError, toClientError } from '@/lib/client-error-taxonomy'
import type { ConfirmedMachine } from '@/lib/environments/utils/machines'
import { createClientInvariantError } from '@/lib/structured-errors'
import type { Navigation } from '@/state/navigation'

const PROJECTION_WAIT_MS = 10_000

/**
 * Registers the folder as a project on its machine, then opens it; throws when the machine
 * refuses. `project` is set once the chat projection holds its checkout, so a draft can open there.
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
  const registered = outcome.result.result
  const projected =
    registered !== null && (await projectedWorktree(machine.environmentId, registered.worktreeId))
  const opened = await navigation.openWorkspace({ environmentId: machine.environmentId, path })
  return { opened, project: projected ? registered : null }
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

/** The command's answer can arrive before its event; waits for the event, and gives up after 10 s. */
function projectedWorktree(environmentId: EnvironmentId, worktreeId: WorktreeId) {
  const projected = () =>
    Boolean(
      selectChatProjectionSlice(useChatProjectionStore.getState(), environmentId).worktreeById[
        worktreeId
      ],
    )
  if (projected()) return Promise.resolve(true)
  return new Promise<boolean>((resolve) => {
    const settle = (value: boolean) => {
      clearTimeout(timer)
      unsubscribe()
      resolve(value)
    }
    const timer = setTimeout(() => settle(false), PROJECTION_WAIT_MS)
    const unsubscribe = useChatProjectionStore.subscribe(() => {
      if (projected()) settle(true)
    })
  })
}
