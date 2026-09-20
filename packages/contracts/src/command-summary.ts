import type { ClientOrchestrationCommand, OrchestrationCommand } from './orchestration-commands'

export function chatCommandSummary(command: ClientOrchestrationCommand | OrchestrationCommand) {
  const summary: Record<string, unknown> = {
    commandId: command.commandId,
    commandType: command.type,
  }

  if ('sessionId' in command) summary.sessionId = command.sessionId
  if ('projectId' in command) summary.projectId = command.projectId
  if ('turnId' in command) summary.turnId = command.turnId

  if (command.type === 'session.turn.start') {
    summary.attachmentCount = command.message.attachments.length
    summary.bootstrapCreateSession = Boolean(command.bootstrap?.createSession)
    summary.interactionMode = command.interactionMode
    summary.messageId = command.message.messageId
    summary.model = command.modelSelection?.model
    summary.providerInstanceId = command.modelSelection?.providerInstanceId
    summary.worktreeId = command.bootstrap?.createSession?.worktreeTarget.worktreeId
    summary.runtimeMode = command.runtimeMode
    summary.textLength = command.message.text.length
  }

  return summary
}
