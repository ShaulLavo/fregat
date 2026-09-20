import type { ProviderInstanceId } from '@workspace/contracts'

export const chatMutationKeys = {
  draftRecovery: (action: 'open' | 'discard') => ['chat', 'draft-recovery', action] as const,
  stash: (environmentId: string, draftKey: string | null) =>
    ['chat', 'stash', environmentId, draftKey] as const,
  attachments: (environmentId: string, draftKey: string | null) =>
    ['chat', 'attachments', environmentId, draftKey] as const,
  questionAttachments: (environmentId: string, sessionId: string, requestId: string) =>
    ['chat', 'question-attachments', environmentId, sessionId, requestId] as const,
  rewind: (environmentId: string, sessionId: string | null) =>
    ['chat', 'rewind', environmentId, sessionId] as const,
  message: (id: string) => ['chat', 'message', id] as const,
  providerSignIn: (id: ProviderInstanceId) => ['chat', 'provider-sign-in', id] as const,
  providerCancelSignIn: (id: ProviderInstanceId) =>
    ['chat', 'provider-cancel-sign-in', id] as const,
  providerSignOut: (id: ProviderInstanceId) => ['chat', 'provider-sign-out', id] as const,
}
