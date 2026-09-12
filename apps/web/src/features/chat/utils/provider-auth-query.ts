import { queryOptions } from '@tanstack/react-query'
import type { ProviderInstanceId, ProviderSignInMethod } from '@workspace/contracts'

import type { Client } from '@/lib/client'
import { clientForQueryClient } from '@/lib/environments/state/query-clients'
import { createRpcError } from '@/lib/structured-errors'

const AUTH_STATUS_STALE_TIME_MS = 15_000
const LOGIN_POLL_INTERVAL_MS = 1_000

export const providerAuthKeys = {
  all: ['providers', 'auth'] as const,
  attempt: (providerInstanceId: ProviderInstanceId, attemptId: string) =>
    [...providerAuthKeys.all, providerInstanceId, 'attempt', attemptId] as const,
  status: (providerInstanceId: ProviderInstanceId) =>
    [...providerAuthKeys.all, providerInstanceId] as const,
}

function unwrap<Data>(response: { data: Data | null; error: unknown }): Data {
  if (response.error) throw createRpcError(response.error)

  return response.data as Data
}

function authRoutes(providerInstanceId: ProviderInstanceId, client: Client) {
  return client.providers({ providerInstanceId }).auth
}

/** Answers for every provider: the ones with no in-app flow report `supportsSignIn: false`. */
export async function fetchProviderAuth(providerInstanceId: ProviderInstanceId, client: Client) {
  return unwrap(await authRoutes(providerInstanceId, client).get())
}

export async function startProviderLogin(
  providerInstanceId: ProviderInstanceId,
  method: ProviderSignInMethod,
  client: Client,
) {
  return unwrap(await authRoutes(providerInstanceId, client).login.post({ method }))
}

export async function fetchProviderLoginAttempt(
  providerInstanceId: ProviderInstanceId,
  attemptId: string,
  client: Client,
) {
  return unwrap(await authRoutes(providerInstanceId, client).login({ attemptId }).get())
}

// Cancel is a POST, not a DELETE: the server allows GET/POST/OPTIONS only, so a
// DELETE from the browser would die in CORS preflight.
export async function cancelProviderLoginAttempt(
  providerInstanceId: ProviderInstanceId,
  attemptId: string,
  client: Client,
) {
  return unwrap(await authRoutes(providerInstanceId, client).login({ attemptId }).cancel.post())
}

export async function signOutProvider(providerInstanceId: ProviderInstanceId, client: Client) {
  return unwrap(await authRoutes(providerInstanceId, client).logout.post())
}

export function providerAuthQueryOptions(providerInstanceId: ProviderInstanceId, enabled: boolean) {
  return queryOptions({
    enabled,
    queryFn: ({ client }) => fetchProviderAuth(providerInstanceId, clientForQueryClient(client)),
    queryKey: providerAuthKeys.status(providerInstanceId),
    refetchOnWindowFocus: false,
    staleTime: AUTH_STATUS_STALE_TIME_MS,
  })
}

// The attempt finishes out-of-band in a browser tab, so polling is the only way
// to learn it landed. Polling stops the moment the attempt leaves `pending`.
export function providerLoginAttemptQueryOptions(
  providerInstanceId: ProviderInstanceId,
  attemptId: string | null,
) {
  return queryOptions({
    enabled: attemptId !== null,
    queryFn: ({ client }) =>
      fetchProviderLoginAttempt(providerInstanceId, attemptId ?? '', clientForQueryClient(client)),
    queryKey: providerAuthKeys.attempt(providerInstanceId, attemptId ?? 'none'),
    refetchInterval: (query) =>
      query.state.data?.state === 'pending' ? LOGIN_POLL_INTERVAL_MS : false,
    refetchOnWindowFocus: false,
    staleTime: 0,
  })
}
