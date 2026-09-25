import type { ChatSelection } from '@/lib/chat-selection'
import { type EnvironmentId, type ProjectId, type SessionId } from '@workspace/contracts'
import {
  chatReferenceForToken,
  tokenForChatReference,
} from '@workspace/client-core/address/references'

export function sessionTokenFor(selection: ChatSelection) {
  return selection.kind === 'auto' ? null : tokenForChatReference(selection)
}

export type ParsedSessionToken =
  | { readonly kind: 'draft'; readonly draftId?: string }
  | { readonly kind: 'session'; readonly sessionId: SessionId }
  | { readonly kind: 'rejected' }

export function parseSessionToken(token: string | null): ParsedSessionToken | null {
  if (!token?.startsWith('t/')) return null
  return chatReferenceForToken(token) ?? { kind: 'rejected' }
}

export function sessionSelectionFor(
  parsed: ParsedSessionToken,
  environmentId: EnvironmentId,
  projectId: ProjectId,
): ChatSelection | null {
  if (parsed.kind === 'draft')
    return {
      kind: 'draft',
      environmentId,
      projectId,
      ...(parsed.draftId ? { draftId: parsed.draftId } : {}),
    }
  if (parsed.kind === 'session')
    return { kind: 'session', environmentId, projectId, sessionId: parsed.sessionId }

  return null
}
