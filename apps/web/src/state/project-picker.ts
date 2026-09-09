import { transportFor } from '@/features/chat/state/active-transports'
import { createWorkspaceProjectCommand } from '@workspace/client-core/chat/commands'
import { dispatchChatCommand } from '@/features/chat/utils/command-dispatch'
import { reportError, toClientError } from '@/lib/client-error-taxonomy'
import type { ConfirmedMachine } from '@/lib/environments/utils/machines'
import { createClientInvariantError } from '@/lib/structured-errors'
import type { ApplicationRuntime } from '@/state/application-runtime'

export async function openPickedMachineProject(
  application: ApplicationRuntime,
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
  if (!outcome.ok) {
    reportError(toClientError(outcome.error))
    return
  }
  await application.openEnvironmentWorkspaceRoot(machine.environmentId, path)
}
