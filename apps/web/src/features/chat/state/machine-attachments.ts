import * as v from 'valibot'
import {
  MAX_CHAT_ATTACHMENTS,
  chatAttachmentUrlPath,
  machineFileAttachmentSchema,
} from '@workspace/contracts'

import { environmentClientFor, serverEndpoint } from '@/lib/client'
import { confirmedEnvironmentOrigin } from '@/lib/environments/state/domain'
import { errorMessage } from '@/lib/error-message'
import { createClientInvariantError, createRpcError } from '@/lib/structured-errors'
import { removeDraftAttachment } from './attachment-uploads'
import type { ChatInputAttachment, ChatInputDraftTarget } from './chat-input-draft-store'

/**
 * Attaches files that live on the draft's own machine. That machine copies each one into its
 * attachment store, so the bytes never travel through the device in hand, and each arrives ready.
 */
export async function stageMachineFiles(input: {
  addAttachments: (
    target: ChatInputDraftTarget,
    attachments: readonly ChatInputAttachment[],
  ) => number
  draftTarget: ChatInputDraftTarget
  existingCount: number
  paths: readonly string[]
  onError: (error: string | null) => void
}) {
  const origin = confirmedEnvironmentOrigin(input.draftTarget.environmentId)
  const client = environmentClientFor(origin)
  let added = 0
  for (const path of input.paths) {
    if (input.existingCount + added >= MAX_CHAT_ATTACHMENTS) {
      input.onError(`Up to ${MAX_CHAT_ATTACHMENTS} files per message.`)
      break
    }
    const staged = await stageOne(client, path).catch((error: unknown) => {
      input.onError(errorMessage(error, 'That file could not be attached.'))
      return null
    })
    if (!staged) continue
    const attachment: ChatInputAttachment = {
      ...staged.attachment,
      previewUrl: `${serverEndpoint(origin)}${chatAttachmentUrlPath(staged.attachment) ?? ''}`,
      upload: { status: 'ready', attachment: staged.attachment, expiresAt: staged.expiresAt },
    }
    if (input.addAttachments(input.draftTarget, [attachment]) === 0) {
      input.onError(`Up to ${MAX_CHAT_ATTACHMENTS} files per message.`)
      await removeDraftAttachment(input.draftTarget.environmentId, attachment.id, staged.attachment)
      break
    }
    added += 1
  }
  if (added === input.paths.length) input.onError(null)
  return added
}

async function stageOne(client: ReturnType<typeof environmentClientFor>, path: string) {
  const response = await client.attachments.uploads['from-machine'].post({ path })
  if (response.error) throw createRpcError(response.error)
  const parsed = v.safeParse(machineFileAttachmentSchema, response.data)
  if (!parsed.success)
    throw createClientInvariantError('The server returned an invalid attachment.', parsed.issues)
  return parsed.output
}
