import * as v from 'valibot'
import { chatAttachmentSchema, type OrchestrationCommand } from '@workspace/contracts'

export function commandUploadClaim(command: OrchestrationCommand) {
  if (command.type === 'session.turn.start' || command.type === 'session.turn.steer')
    return {
      sessionId: command.sessionId,
      attachments: command.message.attachments
        .filter((attachment) => attachment.id.startsWith('upload-'))
        .map((attachment) => v.parse(chatAttachmentSchema, attachment)),
    }
  if (command.type === 'session.user-input.respond')
    return {
      sessionId: command.sessionId,
      attachments: Object.values(command.attachmentsByQuestionId ?? {})
        .flat()
        .filter((attachment) => attachment.id.startsWith('upload-')),
    }
  return null
}
