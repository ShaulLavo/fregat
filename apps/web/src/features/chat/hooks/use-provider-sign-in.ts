import { chatMutationKeys } from '@/features/chat/utils/mutation-keys'
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import type {
  ProviderAuth,
  ProviderInstanceId,
  ProviderLoginAttempt,
  ProviderSignInMethod,
} from '@workspace/contracts'
import { useEffect, useState } from 'react'

import {
  DEFAULT_PROVIDER_AUTH_METHOD,
  providerSignInPhase,
  type ProviderSignInPhase,
} from '@workspace/client-core/chat/providers/auth'
import {
  cancelProviderLoginAttempt,
  providerAuthQueryOptions,
  providerLoginAttemptQueryOptions,
  signOutProvider,
  startProviderLogin,
} from '@/features/chat/utils/provider-auth-query'
import { providerAuthKeys } from '@/features/chat/utils/query-keys'
import { providerListQueryOptions } from '@/lib/provider-query'
import { clientForQueryClient } from '@/lib/environments/state/query-clients'
import { errorMessage } from '@/lib/error-message'

export type ProviderSignIn = {
  /** Account the CLI reports for this provider, re-read after every attempt. */
  readonly account: ProviderAuth | null
  /** Captured CLI failure text for the last attempt or sign-out, if any. */
  readonly attemptError: string | null
  /** Kills the in-flight attempt server-side and returns to the method choice. */
  readonly cancelSignIn: () => void
  readonly isAuthenticated: boolean
  /** Method of the current or last attempt. Defaults to the subscription flow. */
  readonly method: ProviderSignInMethod
  readonly phase: ProviderSignInPhase
  /** Clears attempt and mutation state without touching the CLI. */
  readonly reset: () => void
  readonly signIn: (method: ProviderSignInMethod) => void
  readonly signOut: () => void
  readonly signOutPending: boolean
  readonly statusError: string | null
  readonly statusPending: boolean
}

async function invalidateProviderAuth(
  queryClient: QueryClient,
  providerInstanceId: ProviderInstanceId,
) {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: providerAuthKeys.status(providerInstanceId) }),
    queryClient.invalidateQueries({ queryKey: providerListQueryOptions().queryKey }),
  ])
}

// The server reports a reason when it has one and the tail of the CLI output
// when it does not, so a failed attempt never renders as a bare "failed".
function signInFailureText(attempt: ProviderLoginAttempt | null, startError: unknown) {
  if (attempt?.state === 'failed') {
    return attempt.message ?? attempt.outputTail.at(-1) ?? 'The Claude CLI could not sign in.'
  }
  if (startError) return errorMessage(startError, 'Sign-in could not be started.')

  return null
}

/**
 * Drives one provider's sign-in: reads auth state, starts a `claude auth login`
 * attempt, polls it while the user finishes in the browser, and invalidates the
 * provider list on success so the picker and error card refresh themselves.
 */
export function useProviderSignIn({
  enabled = true,
  providerInstanceId,
}: {
  enabled?: boolean
  providerInstanceId: ProviderInstanceId
}): ProviderSignIn {
  const queryClient = useQueryClient()
  const client = clientForQueryClient(queryClient)
  const [method, setMethod] = useState<ProviderSignInMethod>(DEFAULT_PROVIDER_AUTH_METHOD)
  const [attemptId, setAttemptId] = useState<string | null>(null)

  const statusQuery = useQuery(providerAuthQueryOptions(providerInstanceId, enabled))
  const attemptQuery = useQuery(providerLoginAttemptQueryOptions(providerInstanceId, attemptId))

  const startMutation = useMutation({
    mutationKey: chatMutationKeys.providerSignIn(providerInstanceId),
    mutationFn: (next: ProviderSignInMethod) =>
      startProviderLogin(providerInstanceId, next, client),
    onSuccess: (attempt) => setAttemptId(attempt.attemptId),
  })
  const cancelMutation = useMutation({
    mutationKey: chatMutationKeys.providerCancelSignIn(providerInstanceId),
    mutationFn: (id: string) => cancelProviderLoginAttempt(providerInstanceId, id, client),
  })
  const signOutMutation = useMutation({
    mutationKey: chatMutationKeys.providerSignOut(providerInstanceId),
    mutationFn: () => signOutProvider(providerInstanceId, client),
    onSuccess: () => invalidateProviderAuth(queryClient, providerInstanceId),
  })

  const attempt = attemptQuery.data ?? null
  const attemptState = attempt?.state ?? null

  useEffect(() => {
    if (attemptState !== 'succeeded') return

    void invalidateProviderAuth(queryClient, providerInstanceId)
  }, [attemptId, attemptState, providerInstanceId, queryClient])

  const account = statusQuery.data?.auth ?? null
  const signOutError = signOutMutation.error
    ? errorMessage(signOutMutation.error, 'Sign-out failed.')
    : null

  return {
    account,
    attemptError: signInFailureText(attempt, startMutation.error) ?? signOutError,
    cancelSignIn: () => {
      const pendingAttemptId = attemptId
      setAttemptId(null)
      startMutation.reset()
      if (!pendingAttemptId) return

      cancelMutation.mutate(pendingAttemptId)
    },
    isAuthenticated: account?.status === 'authenticated',
    method,
    phase: providerSignInPhase({
      attempt,
      startFailed: startMutation.isError,
      startPending: startMutation.isPending,
    }),
    reset: () => {
      setAttemptId(null)
      startMutation.reset()
      cancelMutation.reset()
      signOutMutation.reset()
    },
    signIn: (next: ProviderSignInMethod) => {
      setMethod(next)
      setAttemptId(null)
      cancelMutation.reset()
      startMutation.reset()
      startMutation.mutate(next)
    },
    signOut: () => signOutMutation.mutate(),
    signOutPending: signOutMutation.isPending,
    statusError: statusQuery.error
      ? errorMessage(statusQuery.error, 'Could not read the sign-in state.')
      : null,
    statusPending: statusQuery.isPending && enabled,
  }
}
