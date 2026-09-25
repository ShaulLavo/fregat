import { Elysia } from 'elysia'
import {
  providerAuthResultSchema,
  providerCommandCatalogSchema,
  providerInstanceIdSchema,
  providerListResultSchema,
  providerLoginAttemptSchema,
  providerSignInBodySchema,
  providerSignInMethodSchema,
  providerUsageHistoryQuerySchema,
  providerUsageHistorySchema,
  providerUsageResultSchema,
  trimmedNonEmptyStringSchema,
  type ProviderAuth,
  type ProviderCommandCatalog,
  type ProviderInstanceId,
  type ProviderLoginAttempt,
} from '@workspace/contracts'
import * as v from 'valibot'
import {
  recordChatPipelineInfo,
  recordChatPipelineWarning,
} from '../orchestration/orchestration-logging'
import { providerErrors } from '../observability/structured-errors'
import type { ProviderAdapterRegistry } from './provider-adapter-registry'
import type { ProviderAdapter } from './types'
import type { ProviderUsageHistoryReader } from './usage-history'
import type { ProviderUsageStore } from './usage-store'

/** Every method the provider CLI accepts; the client renders one choice per entry. */
const SIGN_IN_METHODS = providerSignInMethodSchema.options

const instanceParamsSchema = v.object({
  providerInstanceId: providerInstanceIdSchema,
})

const attemptParamsSchema = v.object({
  providerInstanceId: providerInstanceIdSchema,
  attemptId: trimmedNonEmptyStringSchema,
})

/** Skills and project commands are per-directory files, so the project's cwd selects them. */
const commandCatalogQuerySchema = v.object({
  cwd: v.optional(trimmedNonEmptyStringSchema),
})

export function providerRoutes(
  adapterRegistry: ProviderAdapterRegistry,
  usage: ProviderUsageStore,
  history: ProviderUsageHistoryReader,
) {
  return new Elysia({ name: 'provider-routes' })
    .get('/providers', () => adapterRegistry.listProviders(), {
      response: providerListResultSchema,
    })
    .get('/providers/usage', () => usage.read(), { response: providerUsageResultSchema })
    .get('/providers/usage/history', ({ query }) => history.read(query), {
      query: providerUsageHistoryQuerySchema,
      response: providerUsageHistorySchema,
    })
    .get(
      '/providers/:providerInstanceId/commands',
      ({ params, query }) =>
        readCommandCatalog(adapterRegistry, params.providerInstanceId, query.cwd),
      {
        params: instanceParamsSchema,
        query: commandCatalogQuerySchema,
        response: providerCommandCatalogSchema,
      },
    )
    .group('/providers/:providerInstanceId/auth', (auth) =>
      auth
        .get('', ({ params }) => readAuth(adapterRegistry, params.providerInstanceId), {
          params: instanceParamsSchema,
          response: providerAuthResultSchema,
        })
        .post(
          '/login',
          async ({ body, params }) => {
            const adapter = signInAdapter(adapterRegistry, params.providerInstanceId)

            return v.parse(providerLoginAttemptSchema, await adapter.signIn(body))
          },
          {
            body: providerSignInBodySchema,
            params: instanceParamsSchema,
            response: providerLoginAttemptSchema,
          },
        )
        .get(
          '/login/:attemptId',
          async ({ params }) => {
            const adapter = signInAdapter(adapterRegistry, params.providerInstanceId)
            const attempt = attemptOrThrow(await adapter.signInAttempt(params), params.attemptId)

            return settleAttempt(adapterRegistry, attempt)
          },
          {
            params: attemptParamsSchema,
            response: providerLoginAttemptSchema,
          },
        )
        // POST, not DELETE: the app's CORS layer only allows GET/POST/OPTIONS,
        // so a DELETE from the web client would fail preflight.
        .post(
          '/login/:attemptId/cancel',
          async ({ params }) => {
            const adapter = signInAdapter(adapterRegistry, params.providerInstanceId)

            return attemptOrThrow(await adapter.cancelSignIn(params), params.attemptId)
          },
          {
            params: attemptParamsSchema,
            response: providerLoginAttemptSchema,
          },
        )
        .post(
          '/logout',
          async ({ params }) => {
            const adapter = signInAdapter(adapterRegistry, params.providerInstanceId)
            await adapter.signOut()
            const snapshot = await adapterRegistry.refreshSnapshot(params.providerInstanceId)

            return authResult(params.providerInstanceId, snapshot.auth, snapshot.checkedAt)
          },
          {
            params: instanceParamsSchema,
            response: providerAuthResultSchema,
          },
        ),
    )
}

/**
 * Never fails: the catalog only fills a composer menu, so a provider that is
 * missing, cannot list, or whose CLI probe blew up all resolve to an empty
 * catalog with `supported: false`. An error here would take down the `/` and `$`
 * menus for every *other* provider the composer shows at the same time.
 */
async function readCommandCatalog(
  adapterRegistry: ProviderAdapterRegistry,
  providerInstanceId: ProviderInstanceId,
  cwd: string | undefined,
) {
  const adapter = adapterRegistry.adapter(providerInstanceId)
  if (!adapter || !supportsCommandListing(adapter)) {
    recordChatPipelineInfo('chat.pipeline.provider_commands.list', {
      commandCount: 0,
      cwd,
      installed: Boolean(adapter),
      providerInstanceId,
      skillCount: 0,
      supported: false,
    })

    return emptyCommandCatalog(providerInstanceId)
  }

  try {
    const catalog = await adapter.listCommands(cwd ? { cwd } : {})
    recordChatPipelineInfo('chat.pipeline.provider_commands.list', {
      commandCount: catalog.commands.length,
      cwd,
      installed: true,
      providerInstanceId,
      skillCount: catalog.skills.length,
      supported: true,
    })

    return v.parse(providerCommandCatalogSchema, {
      ...catalog,
      providerInstanceId,
      supported: true,
    })
  } catch (error) {
    recordChatPipelineWarning('chat.pipeline.provider_commands.list', {
      commandCount: 0,
      cwd,
      error,
      installed: true,
      providerInstanceId,
      skillCount: 0,
      supported: false,
    })

    return emptyCommandCatalog(providerInstanceId)
  }
}

function emptyCommandCatalog(providerInstanceId: ProviderInstanceId): ProviderCommandCatalog {
  return { commands: [], providerInstanceId, skills: [], supported: false }
}

/**
 * Answers for every provider, not only the ones that can sign in — the client
 * gets `supportsSignIn: false` instead of an error, so one endpoint drives the
 * whole account panel. Providers that can sign in are read live from the CLI;
 * the rest fall back to their (cached) snapshot.
 */
async function readAuth(
  adapterRegistry: ProviderAdapterRegistry,
  providerInstanceId: ProviderInstanceId,
) {
  const adapter = adapterOrThrow(adapterRegistry, providerInstanceId)
  if (supportsProviderSignIn(adapter)) {
    return authResult(providerInstanceId, await adapter.authStatus())
  }

  const snapshot = await adapterRegistry.snapshot(providerInstanceId)

  return authResult(providerInstanceId, snapshot.auth, snapshot.checkedAt, false)
}

/**
 * A finished sign-in changed the account behind a cached snapshot, so the poll
 * that observes success is also what re-probes the provider. Without this the
 * user stays "signed out" in the provider list for the rest of the cache TTL.
 */
async function settleAttempt(
  adapterRegistry: ProviderAdapterRegistry,
  attempt: ProviderLoginAttempt,
) {
  if (attempt.state === 'succeeded') {
    await adapterRegistry.refreshSnapshot(attempt.providerInstanceId)
  }

  return attempt
}

function authResult(
  providerInstanceId: ProviderInstanceId,
  auth: ProviderAuth,
  checkedAt = new Date().toISOString(),
  supportsSignIn = true,
) {
  return v.parse(providerAuthResultSchema, {
    auth,
    checkedAt,
    providerInstanceId,
    signInMethods: supportsSignIn ? SIGN_IN_METHODS : [],
    supportsSignIn,
  })
}

function attemptOrThrow(attempt: ProviderLoginAttempt | null, attemptId: string) {
  if (!attempt) throw providerErrors.LOGIN_ATTEMPT_NOT_FOUND({ attemptId })

  return v.parse(providerLoginAttemptSchema, attempt)
}

type SignInAdapter = ProviderAdapter &
  Required<
    Pick<ProviderAdapter, 'authStatus' | 'cancelSignIn' | 'signIn' | 'signInAttempt' | 'signOut'>
  >

function signInAdapter(
  adapterRegistry: ProviderAdapterRegistry,
  providerInstanceId: ProviderInstanceId,
): SignInAdapter {
  const adapter = adapterOrThrow(adapterRegistry, providerInstanceId)
  if (supportsProviderSignIn(adapter)) return adapter

  throw providerErrors.SIGN_IN_UNSUPPORTED({ providerInstanceId })
}

function adapterOrThrow(
  adapterRegistry: ProviderAdapterRegistry,
  providerInstanceId: ProviderInstanceId,
) {
  const adapter = adapterRegistry.adapter(providerInstanceId)
  if (!adapter) throw providerErrors.INSTANCE_NOT_FOUND({ providerInstanceId })

  return adapter
}

type CommandListingAdapter = ProviderAdapter & Required<Pick<ProviderAdapter, 'listCommands'>>

function supportsCommandListing(adapter: ProviderAdapter): adapter is CommandListingAdapter {
  return Boolean(adapter.capabilities.listCommands && adapter.listCommands)
}

function supportsProviderSignIn(adapter: ProviderAdapter): adapter is SignInAdapter {
  return Boolean(
    adapter.capabilities.signIn &&
    adapter.authStatus &&
    adapter.signIn &&
    adapter.signInAttempt &&
    adapter.cancelSignIn &&
    adapter.signOut,
  )
}
