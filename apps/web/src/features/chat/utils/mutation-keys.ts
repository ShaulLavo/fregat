import type { ProviderInstanceId } from '@workspace/contracts'

export const chatMutationKeys = {
  message: (id: string) => ['chat', 'message', id] as const,
  providerSignIn: (id: ProviderInstanceId) => ['chat', 'provider-sign-in', id] as const,
  providerCancelSignIn: (id: ProviderInstanceId) =>
    ['chat', 'provider-cancel-sign-in', id] as const,
  providerSignOut: (id: ProviderInstanceId) => ['chat', 'provider-sign-out', id] as const,
}
