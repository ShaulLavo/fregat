import { TEST_ENVIRONMENT_ID } from './factories/chat'
import { test as base } from 'vitest'

import { createControlledInProcessClient, createInProcessClient } from './client'
import { installTestClient } from './factories/client-binding'
import { makeTestServer, type TestServer } from './server'

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
    const server = await makeTestServer({ environmentId: TEST_ENVIRONMENT_ID })
    await provide(server)
    await server.cleanup()
  },
  client: async ({ server }, provide) => {
    const client = createInProcessClient(server)
    const restore = installTestClient(client)
    try {
      await provide(client)
    } finally {
      restore()
    }
  },
  controlledClient: async ({ server }, provide) => {
    const controlled = createControlledInProcessClient(server)
    const restore = installTestClient(controlled.client)
    try {
      await provide(controlled)
    } finally {
      restore()
    }
  },
})

export { expect } from 'vitest'
