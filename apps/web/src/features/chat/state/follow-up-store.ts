import { create } from 'zustand'
import { scopedSessionKey, type ScopedSessionRef } from '@workspace/contracts'
import type {
  createSteerSubmission,
  createTurnSubmission,
} from '@workspace/client-core/chat/commands'
import type { ChatInputDraft, ChatInputDraftTarget } from './chat-input-draft-store'
import type { ChatInputSubmitPayload } from '../utils/composed-message'

export type MessageSubmission = ReturnType<
  typeof createTurnSubmission | typeof createSteerSubmission
>
type ComposedContent = Pick<ChatInputDraft, 'prompt' | 'attachments' | 'terminalContexts'>
export type QueuedFollowUp = {
  id: string
  target: ChatInputDraftTarget
  payload: ChatInputSubmitPayload
  content: ComposedContent
  afterToolActivityId: string | null
  held: boolean
  submission: MessageSubmission | null
}

type FollowUpStore = {
  queues: Record<string, readonly QueuedFollowUp[]>
  enqueue: (ref: ScopedSessionRef, message: QueuedFollowUp) => void
  take: (ref: ScopedSessionRef, id: string, toolId?: string | null) => QueuedFollowUp | undefined
  remove: (ref: ScopedSessionRef, id: string) => QueuedFollowUp | undefined
  hold: (ref: ScopedSessionRef, message: QueuedFollowUp) => void
  drain: (ref: ScopedSessionRef) => readonly QueuedFollowUp[]
}

const EMPTY_QUEUE: readonly QueuedFollowUp[] = []

export const useFollowUpStore = create<FollowUpStore>((set, get) => ({
  queues: {},
  enqueue: (ref, message) => {
    const key = scopedSessionKey(ref)
    set((state) => ({
      queues: { ...state.queues, [key]: [...(state.queues[key] ?? []), message] },
    }))
  },
  take: (ref, id, toolId) => {
    const key = scopedSessionKey(ref)
    const queue = get().queues[key] ?? EMPTY_QUEUE
    const message = queue.find((item) => item.id === id)
    if (!message) return undefined
    set((state) => ({
      queues: replaceQueue(
        state.queues,
        key,
        queue
          .filter((item) => item.id !== id)
          .map((item) =>
            toolId === undefined || item.afterToolActivityId === toolId
              ? item
              : { ...item, afterToolActivityId: toolId },
          ),
      ),
    }))
    return message
  },
  remove: (ref, id) => {
    const message = queuedFollowUps(get(), ref).find((item) => item.id === id)
    if (message?.submission) return undefined
    return get().take(ref, id)
  },
  hold: (ref, message) => {
    const key = scopedSessionKey(ref)
    set((state) => ({
      queues: {
        ...state.queues,
        [key]: [
          { ...message, held: true },
          ...(state.queues[key] ?? []).filter((item) => item.id !== message.id),
        ],
      },
    }))
  },
  drain: (ref) => {
    const key = scopedSessionKey(ref)
    const queue = get().queues[key] ?? EMPTY_QUEUE
    set((state) => ({ queues: replaceQueue(state.queues, key, []) }))
    return queue
  },
}))

export function queuedFollowUps(
  state: Pick<FollowUpStore, 'queues'>,
  ref: ScopedSessionRef | null,
) {
  return ref ? (state.queues[scopedSessionKey(ref)] ?? EMPTY_QUEUE) : EMPTY_QUEUE
}

function replaceQueue(
  queues: FollowUpStore['queues'],
  key: string,
  queue: readonly QueuedFollowUp[],
) {
  const next = { ...queues }
  if (queue.length) next[key] = queue
  else delete next[key]
  return next
}
