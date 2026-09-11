import { editorDocumentToken, type Address } from '@workspace/client-core/address/grammar'
import {
  chatReferenceSchema,
  tokenForChatReference,
} from '@workspace/client-core/address/references'
import * as v from 'valibot'
import type { SessionId } from '@workspace/contracts'

const navigationHistoryTargetSchema = v.variant('kind', [
  v.object({ kind: v.literal('editor') }),
  v.object({ kind: v.literal('sidebar-chat'), chat: chatReferenceSchema }),
])

export type NavigationHistoryTarget = v.InferOutput<typeof navigationHistoryTargetSchema>

export function addressForHistoryTraversal(address: Address, target: unknown): Address {
  const content = { ...address, chat: null, tool: null }
  const parsed = v.safeParse(navigationHistoryTargetSchema, target)
  if (!parsed.success) return content
  if (parsed.output.kind === 'editor') return { ...content, tool: 'editor' }

  return { ...content, side: 'chat', chat: tokenForChatReference(parsed.output.chat) }
}

export function historyTargetForEditorChange(
  previous: Address,
  next: Address,
): NavigationHistoryTarget | null | undefined {
  const token = editorDocumentToken(next)
  if (previous.mode === next.mode && editorDocumentToken(previous) === token) return undefined

  return token ? { kind: 'editor' } : null
}

export function historyTargetAfterSessionRemoval({
  target,
  removedSessionIds,
  successorSessionId,
}: {
  target: unknown
  removedSessionIds: readonly SessionId[]
  successorSessionId: SessionId | null
}): NavigationHistoryTarget | undefined {
  const parsed = v.safeParse(navigationHistoryTargetSchema, target)
  if (!parsed.success || parsed.output.kind !== 'sidebar-chat') return undefined
  const chat = parsed.output.chat
  if (chat.kind !== 'session' || !removedSessionIds.includes(chat.sessionId)) return undefined

  return {
    kind: 'sidebar-chat',
    chat: successorSessionId
      ? { kind: 'session', sessionId: successorSessionId }
      : { kind: 'draft' },
  }
}
