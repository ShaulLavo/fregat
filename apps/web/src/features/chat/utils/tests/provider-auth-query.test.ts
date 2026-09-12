import { getClient } from '@/lib/client'
import { providerInstanceIdSchema } from '@workspace/contracts'
import * as v from 'valibot'

import { expect, test } from '../../../../../test/fixtures'

import {
  cancelProviderLoginAttempt,
  fetchProviderAuth,
  signOutProvider,
  startProviderLogin,
  fetchProviderLoginAttempt,
} from '@/features/chat/utils/provider-auth-query'

/**
 * Every route below is driven through the real client against the real server.
 * The point is the paths themselves: a client that builds a URL the server does
 * not expose fails with a plain 404, never with the domain error asserted here.
 * Codex is the subject because it has no in-app sign-in, so each route rejects
 * before any adapter work happens — no CLI is spawned by these tests.
 */
const codex = v.parse(providerInstanceIdSchema, 'codex')
const missing = v.parse(providerInstanceIdSchema, 'not-a-provider')

async function codeOf(call: Promise<unknown>) {
  const error = await call.then(
    () => null,
    (thrown: unknown) => thrown,
  )

  return error && typeof error === 'object' && 'code' in error ? error.code : null
}

test('the auth read reaches an unknown provider instance', async ({ client }) => {
  void client

  expect(await codeOf(fetchProviderAuth(missing, getClient()))).toBe('provider.INSTANCE_NOT_FOUND')
})

test('every sign-in route resolves and reports that codex has no in-app flow', async ({
  client,
}) => {
  void client

  const codes = await Promise.all([
    codeOf(startProviderLogin(codex, 'subscription', getClient())),
    codeOf(fetchProviderLoginAttempt(codex, 'attempt-1', getClient())),
    codeOf(cancelProviderLoginAttempt(codex, 'attempt-1', getClient())),
    codeOf(signOutProvider(codex, getClient())),
  ])

  expect(codes).toEqual([
    'provider.SIGN_IN_UNSUPPORTED',
    'provider.SIGN_IN_UNSUPPORTED',
    'provider.SIGN_IN_UNSUPPORTED',
    'provider.SIGN_IN_UNSUPPORTED',
  ])
})
