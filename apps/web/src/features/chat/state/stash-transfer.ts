import type { EnvironmentId } from '@workspace/contracts'
import type { ChatInputAttachment } from '../utils/attachment-draft'
import { createClientInvariantError } from '@/lib/structured-errors'
import {
  chatInputAttachmentsPreparing,
  useChatInputDraftStore,
  type ChatInputDraftTarget,
} from './chat-input-draft-store'
import {
  MAX_PROMPT_STASH_ENTRIES,
  promptStashStoreFor,
  type PromptStashEntry,
} from './prompt-stash-store'
import { cloneStashAttachments, releaseStashAttachments } from './stash-attachments'
import { composedMessageEmpty, stashMessage } from '../utils/stash-message'
import { useFollowUpStore } from './follow-up-store'

export async function transferStash(
  target: ChatInputDraftTarget,
  action: { kind: 'stash' } | { kind: 'restore' | 'remove'; entry: PromptStashEntry },
) {
  const store = promptStashStoreFor(target.environmentId)
  const entries = store.getState().entries
  if (action.kind === 'remove') {
    if (!store.getState().commit(entries.filter((item) => item.id !== action.entry.id)))
      throw createClientInvariantError('Could not save the stash. The message was kept.')
    await releaseUnusedDraftAttachments(target.environmentId, action.entry.attachments)
    return null
  }
  const drafts = useChatInputDraftStore.getState()
  if (chatInputAttachmentsPreparing(drafts, target))
    throw createClientInvariantError('Wait for attachments to finish preparing before stashing.')
  const expected = drafts.getDraft(target)
  if (expected.attachments.some((item) => item.upload && item.upload.status !== 'ready'))
    throw createClientInvariantError('Retry or remove unfinished attachments before stashing.')
  if (action.kind === 'stash' && composedMessageEmpty(expected)) return null
  const incoming =
    action.kind === 'restore' ? entries.find((item) => item.id === action.entry.id) : null
  if (action.kind === 'restore' && !incoming) return null
  const outgoingAttachments = await cloneStashAttachments(
    target.environmentId,
    expected.attachments,
  )
  let incomingAttachments: Awaited<ReturnType<typeof cloneStashAttachments>> = []
  let committed = false
  try {
    incomingAttachments = await cloneStashAttachments(
      target.environmentId,
      incoming?.attachments ?? [],
    )
    const nextEntries = entries.filter((item) => item.id !== incoming?.id)
    if (!composedMessageEmpty(expected))
      nextEntries.unshift(stashMessage({ ...expected, attachments: outgoingAttachments }))
    const evicted = nextEntries.splice(MAX_PROMPT_STASH_ENTRIES)
    const content = {
      prompt: incoming?.prompt ?? '',
      attachments: incomingAttachments,
      terminalContexts: incoming?.terminalContexts ?? [],
    }
    if (
      store.getState().entries !== entries ||
      !store.getState().commit(nextEntries, { target, expected, content })
    )
      throw createClientInvariantError(
        'The draft changed or storage is unavailable. Your draft and stash were kept.',
      )
    committed = true
    await releaseUnusedDraftAttachments(target.environmentId, [
      ...expected.attachments,
      ...(incoming?.attachments ?? []),
      ...evicted.flatMap((item) => item.attachments),
    ])
    return content
  } finally {
    if (!committed)
      await releaseStashAttachments(target.environmentId, [
        ...outgoingAttachments,
        ...incomingAttachments,
      ])
  }
}

export async function releaseUnusedDraftAttachments(
  environmentId: EnvironmentId,
  attachments: readonly ChatInputAttachment[],
) {
  const draftAttachments = Object.entries(useChatInputDraftStore.getState().draftsByKey)
    .filter(([key]) => key.startsWith(`${environmentId}:`))
    .flatMap(([, draft]) => draft.attachments)
  const stashed = promptStashStoreFor(environmentId)
    .getState()
    .entries.flatMap((entry) => entry.attachments)
  const queued = Object.values(useFollowUpStore.getState().queues)
    .flatMap((queue) => queue)
    .filter((entry) => entry.target.environmentId === environmentId)
    .flatMap((entry) => entry.content.attachments)
  const used = new Set(
    [...draftAttachments, ...stashed, ...queued].flatMap((item) =>
      item.upload?.status === 'ready' ? [item.id, item.upload.attachment.id] : [item.id],
    ),
  )
  await releaseStashAttachments(
    environmentId,
    attachments.filter(
      (item) =>
        !used.has(item.id) &&
        !(item.upload?.status === 'ready' && used.has(item.upload.attachment.id)),
    ),
  )
}
