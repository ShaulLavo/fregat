import {
  chatAttachmentUrlPath,
  MAX_CHAT_ATTACHMENTS,
  type OrchestrationEvent,
  type OrchestrationMessage,
  type SessionCheckpointRevertCommand,
} from '@workspace/contracts'
import type { ChatTransport } from '@/features/chat/transport/chat-transport'
import type { ChatInputAttachment } from '@/features/chat/state/chat-input-draft-store'
import { createClientInvariantError } from '@/lib/structured-errors'

export async function prepareRewindAttachments(
  message: OrchestrationMessage,
  origin: string,
  existingCount: number,
) {
  const attachments = message.attachments ?? []
  if (existingCount + attachments.length > MAX_CHAT_ATTACHMENTS)
    throw createClientInvariantError(
      `Rewind would exceed the limit of ${MAX_CHAT_ATTACHMENTS} attachments. Remove draft attachments first.`,
    )
  return Promise.all(
    attachments.map(async (attachment): Promise<ChatInputAttachment> => {
      const path = chatAttachmentUrlPath(attachment)
      if (!path) throw createClientInvariantError(`Cannot restore attachment ${attachment.name}.`)
      const response = await fetch(`${origin.replace(/\/+$/u, '')}${path}`, {
        credentials: 'include',
      })
      if (!response.ok)
        throw createClientInvariantError(`Could not load attachment ${attachment.name}.`)
      if (attachment.type === 'file')
        return {
          ...attachment,
          previewUrl: `${origin.replace(/\/+$/u, '')}${path}`,
          upload: { status: 'ready', attachment, expiresAt: '9999-01-01T00:00:00Z' },
        }
      const blob = await response.blob()
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () =>
          typeof reader.result === 'string'
            ? resolve(reader.result)
            : reject(createClientInvariantError('Attachment could not be read.'))
        reader.onerror = () => reject(reader.error)
        reader.readAsDataURL(blob)
      })
      return { ...attachment, id: `image-${crypto.randomUUID()}`, dataUrl, previewUrl: dataUrl }
    }),
  )
}

export async function awaitRewind(
  transport: ChatTransport,
  command: SessionCheckpointRevertCommand,
  afterSequence: number,
) {
  const signal = AbortSignal.timeout(60_000)
  for await (const item of transport.sessionDetailStream(command.sessionId, {
    afterSequence,
    signal,
  })) {
    const events =
      item.kind === 'event'
        ? [item.event]
        : (await transport.replayEvents({ afterSequence, sessionId: command.sessionId })).events
    for (const event of events) {
      const completed = rewindCompletion(event, command)
      if (completed) return completed
    }
  }
  throw createClientInvariantError(
    'Rewind result was not received. Refresh the session before retrying.',
  )
}

function rewindCompletion(event: OrchestrationEvent, command: SessionCheckpointRevertCommand) {
  if (event.type === 'session.reverted' && event.correlationId === command.commandId) return event
  if (event.type !== 'session.activity-appended') return null
  const activity = event.payload.activity
  const payload = activity.payload
  if (
    activity.kind !== 'checkpoint.revert.failed' ||
    !payload ||
    typeof payload !== 'object' ||
    !('commandId' in payload) ||
    payload.commandId !== command.commandId
  )
    return null
  throw createClientInvariantError(
    'detail' in payload && typeof payload.detail === 'string' ? payload.detail : 'Rewind failed.',
  )
}
