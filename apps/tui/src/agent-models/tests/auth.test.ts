import { DEFAULT_PROVIDER_INSTANCE_ID } from '@workspace/contracts'
import { createEnvironmentClient } from '@workspace/client-core/transport/client'
import { createProviderAuth } from '@/agent-models/state/auth'
import { createProviderCatalog } from '@/agent-models/state/catalog'
import { test, expect } from '../../../test/fixtures'
import { makeTestServer } from '../../../test/server'
import { createInProcessClient, createControlledInProcessTransport } from '../../../test/client'
import { AccountProviderAdapter } from '../../../test/factories/provider-auth'

test('provider account starts, polls, signs out and cancels through real routes', async () => {
  const adapter = new AccountProviderAdapter()
  const server = await makeTestServer({ providerAdapter: adapter })
  const store = createProviderAuth(createInProcessClient(server), DEFAULT_PROVIDER_INSTANCE_ID)
  try {
    await store.refresh()
    expect(store.getSnapshot().auth).toMatchObject({
      supportsSignIn: true,
      auth: { status: 'unauthenticated' },
    })
    await store.start('subscription')
    expect(store.getSnapshot().attempt?.state).toBe('pending')
    adapter.completeSignIn()
    await expect.poll(() => store.getSnapshot().auth?.auth.status).toBe('authenticated')
    await store.signOut()
    expect(store.getSnapshot().auth?.auth.status).toBe('unauthenticated')
    await store.start('console')
    await store.cancel()
    expect(store.getSnapshot().attempt?.state).toBe('cancelled')
    expect(adapter.cancellations).toHaveLength(1)
  } finally {
    store.dispose()
    await server.cleanup()
  }
})

test('disposing while login acknowledgement is delayed cancels the accepted server attempt', async () => {
  const adapter = new AccountProviderAdapter()
  const server = await makeTestServer({ providerAdapter: adapter })
  const transport = createControlledInProcessTransport(server)
  const client = createEnvironmentClient({
    origin: server.origin,
    headers: () => ({ origin: server.clientOrigin }),
    fetcher: transport.fetcher,
  })
  const store = createProviderAuth(client, DEFAULT_PROVIDER_INSTANCE_ID)
  const gate = transport.pauseNextResponse('/providers/codex/auth/login')
  try {
    await store.refresh()
    const start = store.start('subscription')
    await gate.reached
    store.dispose()
    gate.release()
    await start
    expect(adapter.cancellations).toHaveLength(1)
  } finally {
    gate.release()
    store.dispose()
    await server.cleanup()
  }
})

test('a delayed old provider catalog cannot replace a refreshed catalog', async () => {
  const server = await makeTestServer({ providerAdapter: new AccountProviderAdapter() })
  const transport = createControlledInProcessTransport(server)
  const client = createEnvironmentClient({
    origin: server.origin,
    headers: () => ({ origin: server.clientOrigin }),
    fetcher: transport.fetcher,
  })
  const catalog = createProviderCatalog(client)
  const gate = transport.pauseNextResponse('/providers')
  try {
    const first = catalog.refresh()
    await gate.reached
    server.providerAdapter.probeError = 'Provider unavailable'
    await client.providers({ providerInstanceId: DEFAULT_PROVIDER_INSTANCE_ID }).auth.logout.post()
    await catalog.refresh()
    expect(catalog.getSnapshot().providers[0]?.message).toBe('Provider unavailable')
    gate.release()
    await first
    expect(catalog.getSnapshot().providers[0]?.message).toBe('Provider unavailable')
  } finally {
    gate.release()
    catalog.dispose()
    await server.cleanup()
  }
})

test('a failed cancellation after delayed login acknowledgement is observed without an unhandled rejection', async () => {
  const adapter = new AccountProviderAdapter()
  adapter.cancelFails = true
  const server = await makeTestServer({ providerAdapter: adapter })
  const transport = createControlledInProcessTransport(server)
  const client = createEnvironmentClient({
    origin: server.origin,
    headers: () => ({ origin: server.clientOrigin }),
    fetcher: transport.fetcher,
  })
  const events: Record<string, unknown>[] = []
  const store = createProviderAuth(client, DEFAULT_PROVIDER_INSTANCE_ID, (event) => {
    events.push(event)
  })
  const gate = transport.pauseNextResponse('/providers/codex/auth/login')
  try {
    await store.refresh()
    const start = store.start('subscription')
    await gate.reached
    store.dispose()
    gate.release()
    await expect(start).resolves.toBeUndefined()
    expect(events).toContainEqual(
      expect.objectContaining({
        area: 'tui.provider.auth',
        action: 'cancel',
        providerInstanceId: 'codex',
      }),
    )
  } finally {
    gate.release()
    store.dispose()
    await server.cleanup()
  }
})
