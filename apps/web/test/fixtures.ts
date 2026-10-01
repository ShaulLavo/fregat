import { test as base } from 'vitest'

import type { createControlledInProcessClient, createInProcessClient } from './client'
import type { TestServer } from './server'

type TestClient = ReturnType<typeof createInProcessClient>
type ControlledTestClient = ReturnType<typeof createControlledInProcessClient>

type Fixtures = {
  /** Real in-process server bound to an isolated temp workspace. */
  server: TestServer
  /** Eden client wired to `server` — typed, real routes, zero network. */
  client: TestClient
  /** Opt-in real client whose settings SSE response can be ended deterministically. */
  controlledClient: ControlledTestClient
}

// The project's own test entry point. Tests import { test, expect } from here,
// never from 'vitest' directly, so shared setup/teardown stays in one place.
export const test = base.extend<Fixtures>({
  // eslint-disable-next-line no-empty-pattern -- Vitest fixture callbacks must destructure the context object.
  server: async ({}, provide) => {
    // Pure-logic tests use this entry point too; load the server only when its fixture is requested.
    const { TEST_ENVIRONMENT_ID } = await import('./factories/chat')
    const { makeTestServer } = await import('./server')
    const server = await makeTestServer({ environmentId: TEST_ENVIRONMENT_ID })
    await provide(server)
    await server.cleanup()
  },
  client: async ({ server }, provide) => {
    const { createInProcessClient, installInProcessSocketBridge } = await import('./client')
    const { installTestClient } = await import('./factories/client-binding')
    const client = createInProcessClient(server)
    const restore = installTestClient(client)
    const restoreSocketBridge = installInProcessSocketBridge(server)
    try {
      await provide(client)
    } finally {
      restoreSocketBridge()
      restore()
    }
  },
  controlledClient: async ({ server }, provide) => {
    const { createControlledInProcessClient, installInProcessSocketBridge } =
      await import('./client')
    const { installTestClient } = await import('./factories/client-binding')
    const controlled = createControlledInProcessClient(server)
    const restore = installTestClient(controlled.client)
    const restoreSocketBridge = installInProcessSocketBridge(server)
    try {
      await provide(controlled)
    } finally {
      restoreSocketBridge()
      restore()
    }
  },
})

export { expect } from 'vitest'
