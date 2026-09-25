import type { ProviderInstanceId } from '@workspace/contracts'

export const chatMutationKeys = {
  composer: (environmentId: string, sessionId: string | null) =>
    ['chat', 'composer', environmentId, sessionId] as const,
  stop: (environmentId: string, sessionId: string | null) =>
    ['chat', 'stop', environmentId, sessionId] as const,
  restoreFollowUp: (environmentId: string, sessionId: string | null) =>
    ['chat', 'restore-follow-up', environmentId, sessionId] as const,
  draftRecovery: (action: 'open' | 'discard') => ['chat', 'draft-recovery', action] as const,
  moveDraft: (environmentId: string, draftKey: string | null) =>
    ['chat', 'move-draft', environmentId, draftKey] as const,
  stash: (environmentId: string, draftKey: string | null) =>
    ['chat', 'stash', environmentId, draftKey] as const,
  attachments: (environmentId: string, draftKey: string | null) =>
    ['chat', 'attachments', environmentId, draftKey] as const,
  questionAttachments: (environmentId: string, sessionId: string, requestId: string) =>
    ['chat', 'question-attachments', environmentId, sessionId, requestId] as const,
  rewind: (environmentId: string, sessionId: string | null) =>
    ['chat', 'rewind', environmentId, sessionId] as const,
  pendingRequestResponse: (environmentId: string, sessionId: string) =>
    ['chat', 'pending-request-response', environmentId, sessionId] as const,
  fork: (environmentId: string, sessionId: string) =>
    ['chat', 'fork', environmentId, sessionId] as const,
  message: (id: string) => ['chat', 'message', id] as const,
  screenshot: (scope: string) => ['chat', 'screenshot', scope] as const,
  providerSignIn: (id: ProviderInstanceId) => ['chat', 'provider-sign-in', id] as const,
  providerCancelSignIn: (id: ProviderInstanceId) =>
    ['chat', 'provider-cancel-sign-in', id] as const,
  providerSignOut: (id: ProviderInstanceId) => ['chat', 'provider-sign-out', id] as const,
}
